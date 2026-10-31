import { NAV_CAPTURE_NEEDLE } from '../../../sim/autopilot';
import type { SimCommand } from '../../../sim/commands';
import type { AutopilotState, BugState, VerticalMode } from '../../../sim/types';

/*
 * GFC 700 mode keys and the AFCS status box, as pure functions of the shared
 * autopilot state (Pilot's Guide 190-00498-08, section 7).
 *
 * The keys are alternate action: pressing the key of the active mode reverts
 * that axis to its default (ROL or PIT), pressing it for an armed mode
 * cancels the arm. Selected Altitude Capture (ALTS) arms automatically
 * whenever PIT, VS or FLC is active. NAV and APR capture at once when the CDI
 * is within one dot (half scale); further out they arm, shown in white, and
 * the current lateral mode keeps flying until the needle comes in.
 */

export type AfcsKey = 'AP' | 'FD' | 'HDG' | 'ALT' | 'NAV' | 'VNV' | 'APR' | 'BC' | 'VS' | 'FLC' | 'NOSE_UP' | 'NOSE_DN';

/** Bezel layout, [left, right] per row from the top, as on the GDU 1044B. */
export const AFCS_LAYOUT: readonly (readonly [AfcsKey, AfcsKey])[] = [
  ['AP', 'FD'],
  ['HDG', 'ALT'],
  ['NAV', 'VNV'],
  ['APR', 'BC'],
  ['VS', 'NOSE_UP'],
  ['FLC', 'NOSE_DN'],
];

export const AFCS_KEY_NAMES: Record<AfcsKey, string> = {
  AP: 'Autopilot',
  FD: 'Flight director',
  HDG: 'Heading mode',
  ALT: 'Altitude hold',
  NAV: 'Navigation mode',
  VNV: 'Vertical navigation',
  APR: 'Approach mode',
  BC: 'Back course',
  VS: 'Vertical speed',
  FLC: 'Flight level change',
  NOSE_UP: 'Nose up',
  NOSE_DN: 'Nose down',
};

/** What drives the CDI: GPS, a VOR, or a localizer frequency. */
export type NavKind = 'GPS' | 'VOR' | 'LOC';

export function navKind(cdiLabel: string): NavKind {
  return cdiLabel.startsWith('LOC') ? 'LOC' : cdiLabel.startsWith('VOR') ? 'VOR' : 'GPS';
}

export interface AfcsContext {
  /** The selected navigation source has a usable signal or an active GPS leg. */
  readonly navValid: boolean;
  /** CDI deflection, -1..1 of full scale. */
  readonly needle: number;
  readonly source: NavKind;
  /** The NAV mode in use (active or armed) came from the APR key: VOR approach (VAPP). */
  readonly approach: boolean;
}

export interface AfcsResult {
  readonly commands: readonly SimCommand[];
  /** A mode the trainer cannot provide, annunciated instead of engaged. */
  readonly unavailable?: { readonly mode: string; readonly message: string };
  /** Set when the key decides whether the NAV mode is an approach (VAPP) or plain navigation. */
  readonly approach?: boolean;
}

const ARMS_ALTS: readonly VerticalMode[] = ['PIT', 'VS', 'IAS'];
const arm = (vertical: VerticalMode): SimCommand[] => (ARMS_ALTS.includes(vertical) ? [{ type: 'ap.armAltitude', on: true }] : []);

const NO_DATA = {
  VNV: { mode: 'VPTH', message: 'VNV unavailable: the trainer has no vertical flight plan profiles.' },
  GPS_APR: { mode: 'APR', message: 'APR unavailable: GPS approach mode needs an approach loaded, and the trainer database has none.' },
  LOC: { mode: 'APR', message: 'APR unavailable: no localizers in the trainer database.' },
  BC: { mode: 'BC', message: 'BC unavailable: no localizers in the trainer database.' },
} as const;

export function afcsPress(key: AfcsKey, ap: AutopilotState, ctx: AfcsContext): AfcsResult {
  const fdOn = ap.engaged || ap.flightDirector;
  // A mode key pressed with the director off activates it with the default pitch mode.
  const verticalAfter = fdOn ? ap.vertical : 'PIT';

  const lateral = (mode: 'HDG'): AfcsResult =>
    fdOn && ap.lateral === mode
      ? { commands: [{ type: 'ap.lateral', mode: 'ROL' }] }
      : { commands: [{ type: 'ap.lateral', mode }, ...arm(verticalAfter)] };

  /** NAV and APR fly the same course logic; APR is the VOR approach mode (VAPP). */
  const navigation = (approach: boolean): AfcsResult => {
    const active = fdOn && ap.lateral === 'NAV';
    const armed = ap.lateralArmed === 'NAV';
    if (active || armed) {
      // The other key switches between VOR and VAPP on the same course; the same key cancels.
      if (ctx.approach !== approach) return { commands: [], approach };
      return { commands: [active ? { type: 'ap.lateral', mode: 'ROL' } : { type: 'ap.armNav', on: false }], approach: false };
    }
    // Without a valid course to fly the key does nothing (Table 7-1).
    if (!ctx.navValid) return { commands: [] };
    const director: SimCommand[] = fdOn ? [] : [{ type: 'ap.flightDirector', on: true }, ...arm('PIT')];
    const capture: SimCommand =
      Math.abs(ctx.needle) < NAV_CAPTURE_NEEDLE ? { type: 'ap.lateral', mode: 'NAV' } : { type: 'ap.armNav', on: true };
    return { commands: [...director, capture], approach };
  };

  const vertical = (mode: 'ALT' | 'VS' | 'IAS'): AfcsResult =>
    fdOn && ap.vertical === mode
      ? { commands: [{ type: 'ap.vertical', mode: 'PIT' }, ...arm('PIT')] }
      : { commands: [{ type: 'ap.vertical', mode }, ...arm(mode)] };

  const nudge = (direction: 1 | -1): AfcsResult =>
    fdOn && ARMS_ALTS.includes(ap.vertical) ? { commands: [{ type: 'ap.nudge', direction }] } : { commands: [] };

  switch (key) {
    case 'AP':
      return ap.engaged
        ? { commands: [{ type: 'ap.engage', on: false }] }
        : { commands: [{ type: 'ap.engage', on: true }, ...arm(verticalAfter)] };
    case 'FD':
      // Disabled while the autopilot flies: the director has to stay on.
      if (ap.engaged) return { commands: [] };
      // Turning the director off clears its modes, armed ones included.
      return ap.flightDirector
        ? {
            commands: [
              { type: 'ap.flightDirector', on: false },
              { type: 'ap.armNav', on: false },
              { type: 'ap.armAltitude', on: false },
            ],
            approach: false,
          }
        : { commands: [{ type: 'ap.flightDirector', on: true }, ...arm('PIT')] };
    case 'HDG':
      return lateral('HDG');
    case 'NAV':
      return navigation(false);
    case 'APR':
      // Only the VOR approach mode exists in the trainer: no GPS approaches, no localizers.
      if (ctx.source === 'GPS') return { commands: [], unavailable: NO_DATA.GPS_APR };
      if (ctx.source === 'LOC') return { commands: [], unavailable: NO_DATA.LOC };
      return navigation(true);
    case 'ALT':
      return vertical('ALT');
    case 'VS':
      return vertical('VS');
    case 'FLC':
      return vertical('IAS');
    case 'NOSE_UP':
      return nudge(1);
    case 'NOSE_DN':
      return nudge(-1);
    case 'VNV':
      return { commands: [], unavailable: NO_DATA.VNV };
    case 'BC':
      return { commands: [], unavailable: NO_DATA.BC };
  }
}

// AFCS status box ----------------------------------------------------------------

export interface AfcsAnnunciation {
  /** Armed lateral mode, white, left of the active one. */
  readonly lateralArmed: string;
  readonly lateralActive: string;
  readonly verticalActive: string;
  /** Altitude, vertical speed or airspeed reference shown next to the active vertical mode. */
  readonly verticalRef: string;
  readonly verticalArmed: string;
}

/** What the status box shows; null when neither the director nor the autopilot is on. */
export function afcsAnnunciation(
  ap: AutopilotState,
  bugs: Pick<BugState, 'verticalSpeedFpm' | 'airspeedKt'>,
  cdiLabel: string,
  approach: boolean,
): AfcsAnnunciation | null {
  if (!ap.engaged && !ap.flightDirector) return null;
  const kind = navKind(cdiLabel);
  const nav = kind === 'VOR' && approach ? 'VAPP' : kind;
  let verticalActive: string = ap.vertical;
  let verticalRef = '';
  switch (ap.vertical) {
    case 'ALT':
      verticalRef = `${Math.round(ap.altitudeRefFt / 10) * 10}FT`;
      break;
    case 'VS': {
      const fpm = bugs.verticalSpeedFpm;
      verticalRef = `${fpm > 0 ? '↑' : fpm < 0 ? '↓' : ''}${Math.abs(fpm)}FPM`;
      break;
    }
    case 'IAS':
      verticalActive = 'FLC';
      verticalRef = `${bugs.airspeedKt}KT`;
      break;
    case 'PIT':
      break;
  }
  return {
    lateralArmed: ap.lateralArmed === 'NAV' && ap.lateral !== 'NAV' ? nav : '',
    lateralActive: ap.lateral === 'NAV' ? nav : ap.lateral,
    verticalActive,
    verticalRef,
    verticalArmed: ap.altitudeArmed && ap.vertical !== 'ALT' ? 'ALTS' : '',
  };
}
