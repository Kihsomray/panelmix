import { COM, NAV, stepChannel, stepMhz } from '../../../core/frequency';
import type { GnsCtx, GnsUi, RadioUi, Step } from './types';

/*
 * The left side of the bezel: COM and VLOC windows, the tuning cursor, the
 * flip-flop keys and the two volume knobs (Section 1 and 8 of the guide).
 */

/** "When the tuning cursor is in the VLOC window, it will automatically return to the COM window after 30 seconds of inactivity." */
export const VLOC_CURSOR_TIMEOUT_S = 30;
/** How long the volume readout stays after the knob stops. */
export const VOLUME_SHOWN_S = 1.5;
export const EMERGENCY_KHZ = 121500;
const VOLUME_STEP = 5;

export const INITIAL_RADIO: RadioUi = {
  tuning: 'COM',
  tunedAt: 0,
  squelchOff: false,
  comVolume: 50,
  vlocVolume: 50,
  volumeShown: null,
};

/** Where the tuning cursor is now, after the VLOC timeout. */
export function tuningTarget(radio: RadioUi, now: number): 'COM' | 'VLOC' {
  return radio.tuning === 'VLOC' && now - radio.tunedAt > VLOC_CURSOR_TIMEOUT_S ? 'COM' : radio.tuning;
}

/** Large left knob tunes MHz, small left knob kHz, of the standby frequency under the cursor. */
export function tune(ui: GnsUi, ctx: GnsCtx, ring: 'outer' | 'inner', steps: number): Step {
  const target = tuningTarget(ui.radio, ctx.now);
  if (target === 'COM') {
    const khz = ctx.state.radios.com[0].standbyKhz;
    const next = ring === 'outer' ? stepMhz(COM, khz, steps) : stepChannel(COM, khz, steps);
    return { ui: { ...ui, radio: { ...ui.radio, tuning: 'COM' } }, cmds: [{ type: 'com.setStandby', radio: 0, khz: next }] };
  }
  const khz = ctx.state.radios.nav[0].standbyKhz;
  const next = ring === 'outer' ? stepMhz(NAV, khz, steps) : stepChannel(NAV, khz, steps);
  return { ui: { ...ui, radio: { ...ui.radio, tunedAt: ctx.now } }, cmds: [{ type: 'nav.setStandby', radio: 0, khz: next }] };
}

/** Small left knob pushed: the tuning cursor toggles between the COM and VLOC windows. */
export function toggleTuning(ui: GnsUi, ctx: GnsCtx): Step {
  const tuning = tuningTarget(ui.radio, ctx.now) === 'COM' ? 'VLOC' : 'COM';
  return { ui: { ...ui, radio: { ...ui.radio, tuning, tunedAt: ctx.now } }, cmds: [] };
}

export function adjustVolume(ui: GnsUi, ctx: GnsCtx, knob: 'com' | 'vloc', steps: number): Step {
  const key = knob === 'com' ? 'comVolume' : 'vlocVolume';
  const value = Math.min(Math.max(ui.radio[key] + steps * VOLUME_STEP, 0), 100);
  return { ui: { ...ui, radio: { ...ui.radio, [key]: value, volumeShown: { knob, at: ctx.now } } }, cmds: [] };
}

/** COM knob pushed: automatic squelch off/on. VLOC knob pushed: Morse ident audio on/off. */
export function pushVolume(ui: GnsUi, ctx: GnsCtx, knob: 'com' | 'vloc'): Step {
  if (knob === 'com') return { ui: { ...ui, radio: { ...ui.radio, squelchOff: !ui.radio.squelchOff } }, cmds: [] };
  return { ui, cmds: [{ type: 'nav.ident', radio: 0, on: !ctx.state.radios.navIdent[0] }] };
}

export function volumeReadout(radio: RadioUi, now: number): { knob: 'com' | 'vloc'; percent: number } | null {
  const shown = radio.volumeShown;
  if (!shown || now - shown.at > VOLUME_SHOWN_S) return null;
  return { knob: shown.knob, percent: shown.knob === 'com' ? radio.comVolume : radio.vlocVolume };
}
