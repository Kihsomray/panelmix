import type { CdiSolution } from '../../sim/radionav';
import type { AutopilotState, BugState } from '../../sim/types';

/*
 * The GFC 500 status box across the top of the G5 PFD page (Pilot's Guide
 * 3.2.6): lateral modes on the left, autopilot status in the middle,
 * vertical modes on the right; active modes green, armed modes white, with
 * the reference next to ALT, VS and IAS.
 */

export interface AfcsBox {
  /** Armed lateral mode (NAV armed: GPS, VOR or LOC by the CDI source), white. */
  readonly lateralArmed: string | null;
  readonly lateralActive: string | null;
  readonly status: 'AP' | 'FD' | null;
  readonly verticalActive: string | null;
  readonly verticalRef: { readonly value: string; readonly unit: string } | null;
  readonly verticalArmed: string | null;
}

const EMPTY: AfcsBox = { lateralArmed: null, lateralActive: null, status: null, verticalActive: null, verticalRef: null, verticalArmed: null };

/** NAV mode is annunciated by what it tracks: GPS, VOR or LOC. */
function navModeName(cdi: Pick<CdiSolution, 'source' | 'label'>): string {
  if (cdi.source === 'GPS') return 'GPS';
  return cdi.label.startsWith('LOC') ? 'LOC' : 'VOR';
}

export function afcsBox(
  ap: AutopilotState,
  cdi: Pick<CdiSolution, 'source' | 'label'>,
  bugs: Pick<BugState, 'verticalSpeedFpm' | 'airspeedKt'>,
): AfcsBox {
  if (!ap.engaged && !ap.flightDirector) return EMPTY;
  const lateralActive = ap.lateral === 'NAV' ? navModeName(cdi) : ap.lateral;
  let verticalRef: AfcsBox['verticalRef'] = null;
  if (ap.vertical === 'ALT') verticalRef = { value: String(Math.round(ap.altitudeRefFt)), unit: 'FT' };
  else if (ap.vertical === 'VS') {
    const v = Math.round(bugs.verticalSpeedFpm);
    verticalRef = { value: v > 0 ? `+${v}` : String(v), unit: 'FPM' };
  } else if (ap.vertical === 'IAS') verticalRef = { value: String(Math.round(bugs.airspeedKt)), unit: 'KT' };
  return {
    lateralArmed: ap.lateralArmed === 'NAV' && ap.lateral !== 'NAV' ? navModeName(cdi) : null,
    lateralActive,
    status: ap.engaged ? 'AP' : 'FD',
    verticalActive: ap.vertical,
    verticalRef,
    verticalArmed: ap.altitudeArmed && ap.vertical !== 'ALT' ? 'ALTS' : null,
  };
}

/**
 * Transitions the status box calls attention to: a disconnect flashes a
 * yellow AP for 5 seconds, and an armed mode becoming active (ALTS to ALT,
 * armed NAV capturing) flashes the new active mode for 10 seconds.
 */
export interface AfcsWatch {
  readonly engaged: boolean;
  readonly lateral: AutopilotState['lateral'];
  readonly lateralArmed: AutopilotState['lateralArmed'];
  readonly vertical: AutopilotState['vertical'];
  readonly altitudeArmed: boolean;
  readonly disconnectedAt: number | null;
  /** Altitude capture time. */
  readonly capturedAt: number | null;
  /** NAV capture time. */
  readonly navCapturedAt: number | null;
}

export const DISCONNECT_FLASH_S = 5;
export const CAPTURE_FLASH_S = 10;

export function initialWatch(ap: AutopilotState): AfcsWatch {
  return {
    engaged: ap.engaged,
    lateral: ap.lateral,
    lateralArmed: ap.lateralArmed,
    vertical: ap.vertical,
    altitudeArmed: ap.altitudeArmed,
    disconnectedAt: null,
    capturedAt: null,
    navCapturedAt: null,
  };
}

export function watchAfcs(prev: AfcsWatch, ap: AutopilotState, time: number): AfcsWatch {
  if (
    prev.engaged === ap.engaged &&
    prev.lateral === ap.lateral &&
    prev.lateralArmed === ap.lateralArmed &&
    prev.vertical === ap.vertical &&
    prev.altitudeArmed === ap.altitudeArmed
  ) {
    return prev;
  }
  const disconnected = prev.engaged && !ap.engaged;
  const captured = prev.altitudeArmed && prev.vertical !== 'ALT' && ap.vertical === 'ALT';
  const navCaptured = prev.lateralArmed === 'NAV' && prev.lateral !== 'NAV' && ap.lateral === 'NAV';
  return {
    engaged: ap.engaged,
    lateral: ap.lateral,
    lateralArmed: ap.lateralArmed,
    vertical: ap.vertical,
    altitudeArmed: ap.altitudeArmed,
    disconnectedAt: disconnected ? time : ap.engaged ? null : prev.disconnectedAt,
    capturedAt: captured ? time : ap.vertical === 'ALT' ? prev.capturedAt : null,
    navCapturedAt: navCaptured ? time : ap.lateral === 'NAV' ? prev.navCapturedAt : null,
  };
}

export const flashing = (since: number | null, seconds: number, time: number): boolean =>
  since !== null && time >= since && time - since < seconds;
