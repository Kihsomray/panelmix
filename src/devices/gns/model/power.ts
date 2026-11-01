import { initialUi } from './reducer';
import type { GnsUi } from './types';

/*
 * Power. The unit runs from the avionics bus: when it loses power
 * (derived.systems.electrical.avionicsPowered false) the screen goes dark
 * and the bezel does nothing. When power returns it starts again with the
 * Garmin start-up screen and then the default NAV page. The flight plan and
 * the radios live in the simulator, so they are still there; the unit keeps
 * its stored settings (CDI and alarms, map setup, nearest airport criteria,
 * volumes) but not what was on the screen, and terrain alerts are no longer
 * inhibited.
 */

/** Seconds the start-up screen stays up after power returns. */
export const STARTUP_S = 3;

export function powerUp(ui: GnsUi): GnsUi {
  const fresh = initialUi(ui.model);
  return {
    ...fresh,
    map: { ...ui.map, pointer: null },
    navRange: ui.navRange,
    rwyRange: ui.rwyRange,
    radio: { ...fresh.radio, comVolume: ui.radio.comVolume, vlocVolume: ui.radio.vlocVolume },
    aux: { ...fresh.aux, criteria: ui.aux.criteria },
    vnav: ui.vnav,
    terrain: { ...ui.terrain, inhibited: false },
    settings: ui.settings,
  };
}

/** What the screen shows: dark without power, the start-up screen for a few seconds after it returns. */
export function screenMode(powered: boolean, poweredAt: number | null, now: number): 'off' | 'startup' | 'on' {
  if (!powered) return 'off';
  return poweredAt !== null && now - poweredAt < STARTUP_S ? 'startup' : 'on';
}
