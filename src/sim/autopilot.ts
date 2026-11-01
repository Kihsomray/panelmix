import { angleDiff, norm360 } from '../core/geo';
import { excessPowerFpm, pitchForVerticalSpeed, verticalSpeedForPitch, type FlightTargets } from './flight';
import type { GpsSolution } from './fms';
import { arcBankDeg } from './fms/geometry';
import type { CdiSolution } from './radionav';
import type { AutopilotState, FmsSteering, SimState, VerticalDerived } from './types';

/*
 * Guidance laws shared by every autopilot device (KAP 140, GFC 500, the
 * G1000's GFC 700) and by hand flying. An autopilot device only chooses
 * modes and references; the laws here turn them into a bank angle and a
 * vertical speed for the flight model.
 *
 * NAV on a GPS source follows the FMS steering for the active leg (courses,
 * headings, arcs and holds); on a VOR or localizer it tracks the needle. GS
 * flies the active vertical path, ILS glideslope or GPS glidepath alike.
 */

const AP_MAX_BANK = 22;
const AP_MAX_VS = 1500;
/** Bank per degree of heading or track error. */
const ROLL_GAIN = 1.6;
/** Intercept angle per nm of cross-track error (GPS) before limiting. */
const XTK_GAIN_DEG_PER_NM = 35;
const MAX_INTERCEPT = 45;
/** Glidepath tracking: vertical speed correction per foot of deviation (fpm/ft), and its limit. */
const GS_GAIN = 4;
const GS_MAX_CORRECTION_FPM = 500;
const FPM_PER_KT = 101.269;

/** GS / GP capture window: from below within about a dot (half scale), or nearly centered from above. */
export const GS_CAPTURE_BELOW = 0.5;
export const GS_CAPTURE_ABOVE = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export interface GuidanceInput {
  readonly state: SimState;
  readonly headingMag: number;
  readonly trackMag: number;
  readonly sigma: number;
  readonly cdi: CdiSolution;
  /** The GPS solution, for GPS steering whatever the CDI source. */
  readonly gps: GpsSolution;
  /** Distance to the VOR or localizer the CDI shows, for converting its needle to a distance off course. */
  readonly vorDistanceNm: number | null;
  /** What the FMS asks NAV / GPSS to fly on the active leg (`derived.steering`). */
  readonly steering?: FmsSteering | null;
  /** Vertical path for GS mode (`derived.vertical`). */
  readonly vertical?: VerticalDerived | null;
}

/** NAV captures once the needle is within half scale (one dot of two on an HSI). */
export const NAV_CAPTURE_NEEDLE = 0.5;

/** The course to fly and the cross-track error, from a CDI-like source. */
interface Track {
  readonly courseMag: number;
  readonly xtkNm: number;
}

function trackFromCdi(cdi: CdiSolution, vorDistanceNm: number | null): Track | null {
  if (cdi.flag) return null;
  // Convert needle deflection back to a cross-track distance so one law flies GPS, VOR and localizer.
  const xtkNm =
    cdi.fullScaleNm !== null
      ? -cdi.needle * cdi.fullScaleNm
      : -cdi.needle * (cdi.fullScaleDeg ?? 10) * Math.max(vorDistanceNm ?? 10, 1) * (Math.PI / 180);
  return { courseMag: cdi.courseMag, xtkNm };
}

function trackFromGps(gps: GpsSolution): Track | null {
  if (!gps.active || gps.valid === false || gps.dtkMag === null) return null;
  return { courseMag: gps.dtkMag, xtkNm: gps.crossTrackNm };
}

/** Intercept-and-track law: bank toward a desired track that closes on the course. */
function steer(track: Track, trackMag: number): number {
  const intercept = clamp(track.xtkNm * XTK_GAIN_DEG_PER_NM, -MAX_INTERCEPT, MAX_INTERCEPT);
  const desiredTrack = track.courseMag - intercept;
  return clamp(ROLL_GAIN * angleDiff(desiredTrack, trackMag), -AP_MAX_BANK, AP_MAX_BANK);
}

/**
 * Bank toward a heading. A forced direction holds full bank that way while
 * more than 150 degrees remain; a small overshoot past the heading is taken
 * out the short way rather than starting another circle.
 */
function turnToHeading(target: number, headingMag: number, turn: 'L' | 'R' | undefined): number {
  if (turn) {
    const remaining = turn === 'R' ? norm360(target - headingMag) : norm360(headingMag - target);
    if (remaining > 150 && remaining < 330) return turn === 'R' ? AP_MAX_BANK : -AP_MAX_BANK;
  }
  return clamp(ROLL_GAIN * angleDiff(target, headingMag), -AP_MAX_BANK, AP_MAX_BANK);
}

/** Bank that flies the FMS steering. Arcs add the bank the curve itself needs at this ground speed. */
function followSteering(st: FmsSteering, input: GuidanceInput): number {
  switch (st.kind) {
    case 'track':
      return steer({ courseMag: st.courseMag, xtkNm: st.crossTrackNm }, input.trackMag);
    case 'heading':
      return turnToHeading(st.headingMag, input.headingMag, st.turn);
    case 'arc': {
      const ff = (st.turn === 'R' ? 1 : -1) * arcBankDeg(input.state.aircraft.groundSpeedKt, st.radiusNm);
      return clamp(ff + steer({ courseMag: st.courseMag, xtkNm: st.crossTrackNm }, input.trackMag), -AP_MAX_BANK, AP_MAX_BANK);
    }
  }
}

/** Bank command for the lateral mode. */
function lateralCommand(ap: AutopilotState, input: GuidanceInput): number {
  const { state, headingMag, trackMag, cdi } = input;
  switch (ap.lateral) {
    case 'ROL':
      return ap.rollRefDeg;
    case 'HDG': {
      // GPS steering: a heading-only autopilot fed GPS roll steering follows the GPS course.
      if (ap.gpss) {
        if (input.steering) return followSteering(input.steering, input);
        const gpss = trackFromGps(input.gps);
        if (gpss) return steer(gpss, trackMag);
      }
      return clamp(ROLL_GAIN * angleDiff(state.bugs.headingMag, headingMag), -AP_MAX_BANK, AP_MAX_BANK);
    }
    case 'NAV': {
      if (cdi.source === 'GPS' && input.steering && !cdi.flag) return followSteering(input.steering, input);
      const track = trackFromCdi(cdi, input.vorDistanceNm);
      return track ? steer(track, trackMag) : 0;
    }
  }
}

/** Vertical speed command for the vertical mode. */
function verticalCommand(ap: AutopilotState, input: GuidanceInput): number {
  const { state, sigma } = input;
  const a = state.aircraft;
  switch (ap.vertical) {
    case 'PIT':
      return verticalSpeedForPitch(ap.pitchRefDeg, a.iasKt, a.tasKt, a.bankDeg);
    case 'VS':
      return state.bugs.verticalSpeedFpm;
    case 'ALT':
      return clamp(4 * (ap.altitudeRefFt - a.altitudeFt), -800, 800);
    case 'IAS': {
      // Flight level change: pitch for the speed bug; the excess power sets the climb or descent.
      const ps = excessPowerFpm(state.bugs.airspeedKt, a.engine.throttle, sigma);
      return clamp(ps + 150 * (a.iasKt - state.bugs.airspeedKt), -2000, AP_MAX_VS);
    }
    case 'GS': {
      const v = input.vertical;
      if (!v) return a.verticalSpeedFpm;
      // The path's own descent rate at this ground speed, plus a correction toward it.
      const pathRate = -a.groundSpeedKt * FPM_PER_KT * Math.tan((v.angleDeg * Math.PI) / 180);
      const vs = pathRate + clamp(-GS_GAIN * v.deviationFt, -GS_MAX_CORRECTION_FPM, GS_MAX_CORRECTION_FPM);
      // Below the path the airplane waits for it rather than climbing up to it.
      return v.deviationFt < 0 ? Math.min(vs, 0) : vs;
    }
  }
}

export interface GuidanceOutput {
  readonly targets: FlightTargets;
  /** The autopilot state after any mode transition (altitude capture). */
  readonly ap: AutopilotState;
  /** Flight director command bars, when the director is on. */
  readonly flightDirector: { readonly bankDeg: number; readonly pitchDeg: number } | null;
}

/** Altitude preselect: within this band of the target, switch to altitude hold. */
function captureBand(vsFpm: number): number {
  return Math.max(60, Math.abs(vsFpm) * 0.12);
}

/** A vertical path the autopilot can fly (not advisory, inside its service volume). */
const coupleable = (v: VerticalDerived | null | undefined): v is VerticalDerived => !!v && v.valid && !v.advisory;

export function guidance(input: GuidanceInput): GuidanceOutput {
  const { state } = input;
  let ap = state.ap;
  const a = state.aircraft;
  const on = ap.engaged || ap.flightDirector;

  // NAV capture: once the needle comes within half scale, the armed NAV becomes active.
  if (ap.lateralArmed && on && ap.lateral !== 'NAV') {
    if (!input.cdi.flag && Math.abs(input.cdi.needle) <= NAV_CAPTURE_NEEDLE) {
      ap = { ...ap, lateral: 'NAV', lateralArmed: null };
    }
  }

  // GS / GP capture: armed, NAV tracking the course, and the path within the window.
  if (ap.verticalArmed === 'GS' && on && ap.vertical !== 'GS' && ap.lateral === 'NAV') {
    const v = input.vertical;
    if (coupleable(v) && v.needle <= GS_CAPTURE_BELOW && v.needle >= -GS_CAPTURE_ABOVE) {
      ap = { ...ap, vertical: 'GS', verticalArmed: null };
    }
  }
  // Losing the path (past the MAP, out of the glideslope's coverage) drops GS for pitch hold.
  if (ap.vertical === 'GS' && on && !coupleable(input.vertical)) {
    ap = { ...ap, vertical: 'PIT', pitchRefDeg: a.pitchDeg };
  }

  if (ap.altitudeArmed && on && ap.vertical !== 'ALT' && ap.vertical !== 'GS') {
    const toGo = state.bugs.altitudeFt - a.altitudeFt;
    const closing = Math.sign(toGo) === Math.sign(a.verticalSpeedFpm) || Math.abs(toGo) < 20;
    if (closing && Math.abs(toGo) <= captureBand(a.verticalSpeedFpm)) {
      ap = { ...ap, vertical: 'ALT', altitudeRefFt: state.bugs.altitudeFt, altitudeArmed: false };
    }
  }

  const apBank = on ? lateralCommand(ap, input) : 0;
  const apVs = on ? verticalCommand(ap, input) : 0;
  const flightDirector = ap.flightDirector
    ? { bankDeg: apBank, pitchDeg: pitchForVerticalSpeed(apVs, a.iasKt, a.tasKt, apBank) }
    : null;

  if (ap.engaged) {
    return { targets: { bankDeg: apBank, verticalSpeedFpm: clamp(apVs, -2000, AP_MAX_VS) }, ap, flightDirector };
  }
  // Hand flying: the airplane holds the attitude it is trimmed to.
  const hold = state.attitudeHold;
  return {
    targets: {
      bankDeg: hold.bankDeg,
      verticalSpeedFpm: verticalSpeedForPitch(hold.pitchDeg, a.iasKt, a.tasKt, hold.bankDeg),
    },
    ap,
    flightDirector,
  };
}
