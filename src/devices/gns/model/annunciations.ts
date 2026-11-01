import type { Derived } from '../../../sim/simulator';
import type { ApproachMode, SimState } from '../../../sim/types';
import { hasUnread } from './messages';
import type { GnsUi } from './types';

/*
 * The unit's annunciations, from the guide's captures:
 *
 * Lower left, three boxes under the frequency windows: terrain status
 * ("TERRAIN" yellow during an alert, "TER INHB" or "TER N/A" in white), the
 * CDI scale or flight phase (ENR, TERM, DPRT, MAPR in green; on an active
 * approach the service level LPV, LP, LP +V, L/VNAV, LNAV+V or LNAV in
 * inverse green), and "INTEG" in yellow when the GPS position fails
 * integrity.
 *
 * Bottom row: GPS (green) or VLOC (white) above the CDI key, OBS or SUSP
 * (green) above the OBS key, MSG (flashing yellow) above the MSG key.
 */

export type BoxStyle = 'green' | 'inverse' | 'white' | 'yellow';

export interface BoxAnnun {
  readonly text: string;
  readonly style: BoxStyle;
}

export interface Annunciations {
  readonly terrain: BoxAnnun | null;
  readonly mode: BoxAnnun;
  readonly integ: BoxAnnun | null;
  readonly cdi: 'GPS' | 'VLOC' | '';
  readonly obs: 'OBS' | 'SUSP' | null;
  readonly msg: boolean;
}

/** The GPS service level annunciated on an approach; ground-based approaches show the GPS's LNAV scaling. */
const MODE_LABEL: Record<ApproachMode, string> = {
  LPV: 'LPV',
  LP: 'LP',
  'LP+V': 'LP +V',
  'L/VNAV': 'L/VNAV',
  'LNAV+V': 'LNAV+V',
  LNAV: 'LNAV',
  ILS: 'LNAV',
  LOC: 'LNAV',
  VOR: 'LNAV',
  NDB: 'LNAV',
};

export function annunciations(ui: GnsUi, state: SimState, derived: Derived): Annunciations {
  const gpsValid = derived.systems.gpsValid;
  const t = derived.systems.terrain;
  const terrain: BoxAnnun | null = !gpsValid
    ? { text: 'TER N/A', style: 'white' }
    : ui.terrain.inhibited
      ? { text: 'TER INHB', style: 'white' }
      : t.alert !== 'none' && !t.suppressed
        ? { text: 'TERRAIN', style: 'yellow' }
        : null;

  const gps = derived.gps;
  const phase = gps.phase ?? gps.scale;
  const appr = derived.approach;
  const mode: BoxAnnun =
    phase === 'APR' && appr?.activated && appr.mode ? { text: MODE_LABEL[appr.mode], style: 'inverse' } : { text: phase, style: 'green' };

  const source = state.nav.cdiSource;
  const fms = state.fms;
  return {
    terrain,
    mode,
    integ: gpsValid ? null : { text: 'INTEG', style: 'yellow' },
    cdi: source === 'GPS' ? 'GPS' : source === 'NAV1' ? 'VLOC' : '',
    obs: fms.suspended && !fms.obsMode ? 'SUSP' : fms.obsMode ? 'OBS' : null,
    msg: hasUnread(state.messages),
  };
}
