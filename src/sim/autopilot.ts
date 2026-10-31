import { angleDiff } from '../core/geo';
import { excessPowerFpm, pitchForVerticalSpeed, verticalSpeedForPitch, type FlightTargets } from './flight';
import type { GpsSolution } from './fms';
import type { CdiSolution } from './radionav';
import type { AutopilotState, SimState } from './types';

/*
 * Guidance laws shared by every autopilot device (KAP 140, GFC 500, the
 * G1000's GFC 700) and by hand flying. An autopilot device only chooses
 * modes and references; the laws here turn them into a bank angle and a
 * vertical speed for the flight model.
 */

const AP_MAX_BANK = 22;
const AP_MAX_VS = 1500;
/** Bank per degree of heading or track error. */
const ROLL_GAIN = 1.6;
/** Intercept angle per nm of cross-track error (GPS) before limiting. */
const XTK_GAIN_DEG_PER_NM = 35;
const MAX_INTERCEPT = 45;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export interface GuidanceInput {
  readonly state: SimState;
  readonly headingMag: number;
  readonly trackMag: number;
  readonly sigma: number;
  readonly cdi: CdiSolution;
  /** The GPS solution, for GPS steering whatever the CDI source. */
  readonly gps: GpsSolution;
  readonly vorDistanceNm: number | null;
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
  // Convert needle deflection back to a cross-track distance so one law flies GPS and VOR.
  const xtkNm =
    cdi.fullScaleNm !== null
      ? -cdi.needle * cdi.fullScaleNm
      : -cdi.needle * 10 * Math.max(vorDistanceNm ?? 10, 1) * (Math.PI / 180);
  return { courseMag: cdi.courseMag, xtkNm };
}

function trackFromGps(gps: GpsSolution): Track | null {
  if (!gps.active || gps.dtkMag === null) return null;
  return { courseMag: gps.dtkMag, xtkNm: gps.crossTrackNm };
}

/** Intercept-and-track law: bank toward a desired track that closes on the course. */
function steer(track: Track, trackMag: number): number {
  const intercept = clamp(track.xtkNm * XTK_GAIN_DEG_PER_NM, -MAX_INTERCEPT, MAX_INTERCEPT);
  const desiredTrack = track.courseMag - intercept;
  return clamp(ROLL_GAIN * angleDiff(desiredTrack, trackMag), -AP_MAX_BANK, AP_MAX_BANK);
}

/** Bank command for the lateral mode. */
function lateralCommand(ap: AutopilotState, input: GuidanceInput): number {
  const { state, headingMag, trackMag, cdi } = input;
  switch (ap.lateral) {
    case 'ROL':
      return ap.rollRefDeg;
    case 'HDG': {
      // GPS steering: a heading-only autopilot fed GPS roll steering follows the GPS course.
      const gpss = ap.gpss ? trackFromGps(input.gps) : null;
      if (gpss) return steer(gpss, trackMag);
      return clamp(ROLL_GAIN * angleDiff(state.bugs.headingMag, headingMag), -AP_MAX_BANK, AP_MAX_BANK);
    }
    case 'NAV': {
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

export function guidance(input: GuidanceInput): GuidanceOutput {
  const { state } = input;
  let ap = state.ap;
  const a = state.aircraft;

  // NAV capture: once the needle comes within half scale, the armed NAV becomes active.
  if (ap.lateralArmed && (ap.engaged || ap.flightDirector) && ap.lateral !== 'NAV') {
    if (!input.cdi.flag && Math.abs(input.cdi.needle) <= NAV_CAPTURE_NEEDLE) {
      ap = { ...ap, lateral: 'NAV', lateralArmed: null };
    }
  }

  if (ap.altitudeArmed && (ap.engaged || ap.flightDirector) && ap.vertical !== 'ALT') {
    const toGo = state.bugs.altitudeFt - a.altitudeFt;
    const closing = Math.sign(toGo) === Math.sign(a.verticalSpeedFpm) || Math.abs(toGo) < 20;
    if (closing && Math.abs(toGo) <= captureBand(a.verticalSpeedFpm)) {
      ap = { ...ap, vertical: 'ALT', altitudeRefFt: state.bugs.altitudeFt, altitudeArmed: false };
    }
  }

  const active = ap.engaged || ap.flightDirector;
  const apBank = active ? lateralCommand(ap, input) : 0;
  const apVs = active ? verticalCommand(ap, input) : 0;
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
