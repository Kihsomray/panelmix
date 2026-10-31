import { angleDiff } from '../core/geo';
import { excessPowerFpm, pitchForVerticalSpeed, verticalSpeedForPitch, type FlightTargets } from './flight';
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
  readonly vorDistanceNm: number | null;
}

/** Bank command for the lateral mode. */
function lateralCommand(ap: AutopilotState, input: GuidanceInput): number {
  const { state, headingMag, trackMag, cdi } = input;
  switch (ap.lateral) {
    case 'ROL':
      return ap.rollRefDeg;
    case 'HDG':
      return clamp(ROLL_GAIN * angleDiff(state.bugs.headingMag, headingMag), -AP_MAX_BANK, AP_MAX_BANK);
    case 'NAV': {
      if (cdi.flag) return 0;
      // Convert needle deflection back to a cross-track distance so one law flies GPS and VOR.
      const xtkNm =
        cdi.fullScaleNm !== null
          ? -cdi.needle * cdi.fullScaleNm
          : -cdi.needle * 10 * Math.max(input.vorDistanceNm ?? 10, 1) * (Math.PI / 180);
      const intercept = clamp(xtkNm * XTK_GAIN_DEG_PER_NM, -MAX_INTERCEPT, MAX_INTERCEPT);
      // Flying TO a VOR the course is flown as set; FROM likewise. The needle sign handles both.
      const desiredTrack = cdi.courseMag - intercept;
      return clamp(ROLL_GAIN * angleDiff(desiredTrack, trackMag), -AP_MAX_BANK, AP_MAX_BANK);
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
