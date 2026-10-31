/*
 * KAP 140 altitude alerter (independent of the autopilot): ALERT lights
 * 1,000 ft before the selected altitude, goes out 200 ft before it, blinks
 * on once when the altitude is reached, and flashes if the airplane then
 * leaves the 200 ft "safe band", until it is 1,000 ft away.
 */

export type AlertLamp = 'off' | 'on' | 'flash';

export interface AlerterState {
  /** The selection being tracked; a new selection starts a new approach. */
  readonly selectedFt: number;
  readonly reached: boolean;
  /** Real time the "reached" blink ends. */
  readonly blinkUntil: number;
}

const ACQUIRE_FT = 1000;
const SAFE_BAND_FT = 200;
/** Close enough to call the altitude reached. */
const REACHED_FT = 40;
const BLINK_S = 1.5;

export function initialAlerter(selectedFt: number): AlerterState {
  return { selectedFt, reached: false, blinkUntil: 0 };
}

export function stepAlerter(prev: AlerterState, altitudeFt: number, selectedFt: number, now: number): { state: AlerterState; lamp: AlertLamp } {
  let s = prev.selectedFt === selectedFt ? prev : initialAlerter(selectedFt);
  const dev = Math.abs(altitudeFt - selectedFt);
  if (!s.reached) {
    if (dev <= REACHED_FT) {
      s = { ...s, reached: true, blinkUntil: now + BLINK_S };
      return { state: s, lamp: 'on' };
    }
    return { state: s, lamp: dev <= ACQUIRE_FT && dev > SAFE_BAND_FT ? 'on' : 'off' };
  }
  if (dev >= ACQUIRE_FT) return { state: initialAlerter(selectedFt), lamp: 'off' };
  if (dev > SAFE_BAND_FT) return { state: s, lamp: 'flash' };
  return { state: s, lamp: now < s.blinkUntil ? 'on' : 'off' };
}
