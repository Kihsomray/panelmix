import { COM, NAV, stepChannel, stepMhz } from '../../../core/frequency';
import type { Radio, SimCommand } from '../../../sim/commands';

/*
 * The radio side of the G1000 that is not in the simulator: which NAV and
 * COM the cyan tuning boxes are on, audio volumes and squelch. Both displays
 * show the same frequency boxes, so this state is shared by the PFD and the
 * MFD (see store.ts). Pure functions only.
 */

export type RadioKind = 'nav' | 'com';

export interface RadioPanel {
  readonly navTuned: Radio;
  readonly comTuned: Radio;
  /** Audio level, percent. */
  readonly navVolume: readonly [number, number];
  readonly comVolume: readonly [number, number];
  /** Automatic squelch overridden (white SQ next to the COM frequency). */
  readonly squelchOff: readonly [boolean, boolean];
  /** A volume level shown in place of a standby frequency until `until` (ms). */
  readonly volumeShown: { readonly kind: RadioKind; readonly radio: Radio; readonly until: number } | null;
}

export const INITIAL_RADIO_PANEL: RadioPanel = {
  navTuned: 0,
  comTuned: 0,
  navVolume: [50, 50],
  comVolume: [70, 70],
  squelchOff: [false, false],
  volumeShown: null,
};

/** The level stays on screen this long after the knob stops (Pilot's Guide, 4.2). */
export const VOLUME_SHOW_MS = 2000;
const VOLUME_STEP = 5;

export function toggleTuning(p: RadioPanel, kind: RadioKind): RadioPanel {
  return kind === 'nav' ? { ...p, navTuned: p.navTuned === 0 ? 1 : 0 } : { ...p, comTuned: p.comTuned === 0 ? 1 : 0 };
}

export function setNavTuned(p: RadioPanel, radio: Radio): RadioPanel {
  return p.navTuned === radio ? p : { ...p, navTuned: radio };
}

export function adjustVolume(p: RadioPanel, kind: RadioKind, steps: number, now: number): RadioPanel {
  const radio = kind === 'nav' ? p.navTuned : p.comTuned;
  const levels: [number, number] = [...(kind === 'nav' ? p.navVolume : p.comVolume)];
  levels[radio] = Math.min(Math.max(levels[radio] + steps * VOLUME_STEP, 0), 100);
  const volumeShown = { kind, radio, until: now + VOLUME_SHOW_MS };
  return kind === 'nav' ? { ...p, navVolume: levels, volumeShown } : { ...p, comVolume: levels, volumeShown };
}

export function toggleSquelch(p: RadioPanel): RadioPanel {
  const squelchOff: [boolean, boolean] = [...p.squelchOff];
  squelchOff[p.comTuned] = !squelchOff[p.comTuned];
  return { ...p, squelchOff };
}

/** The volume level to show in place of this radio's standby frequency, or null. */
export function shownVolume(p: RadioPanel, kind: RadioKind, radio: Radio, now: number): number | null {
  const v = p.volumeShown;
  if (!v || v.kind !== kind || v.radio !== radio || now >= v.until) return null;
  return (kind === 'nav' ? p.navVolume : p.comVolume)[radio];
}

/** Large knob steps MHz, small knob steps channels, each wrapping on its own. */
export function tuneStandby(kind: RadioKind, radio: Radio, standbyKhz: number, knob: 'outer' | 'inner', steps: number): SimCommand {
  const band = kind === 'nav' ? NAV : COM;
  const khz = knob === 'outer' ? stepMhz(band, standbyKhz, steps) : stepChannel(band, standbyKhz, steps);
  return kind === 'nav' ? { type: 'nav.setStandby', radio, khz } : { type: 'com.setStandby', radio, khz };
}

export const EMERGENCY_KHZ = 121500;
