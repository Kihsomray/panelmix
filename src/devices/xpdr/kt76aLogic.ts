import type { TransponderMode } from '../../sim/types';
import { identActive, replyFlash } from './squawk';

/*
 * KT 76A rules: the five-position function selector, the four mechanical
 * code drums and the reply lamp. Pure functions; the component wires them
 * to the knobs and the simulator.
 */

/** Selector positions, counter-clockwise to clockwise. TST is spring-loaded. */
export const SELECTOR = ['OFF', 'SBY', 'ON', 'ALT', 'TST'] as const;
export type SelectorPosition = (typeof SELECTOR)[number];

/** Pointer angle of each position, degrees clockwise from straight up. */
export const SELECTOR_ANGLE: Readonly<Record<SelectorPosition, number>> = { OFF: -100, SBY: -50, ON: 0, ALT: 50, TST: 100 };

/** How long the trainer holds TST before the spring returns the knob to ALT. */
export const TEST_HOLD_S = 1.5;
/** Warm-up after switching on: no replies until it is over (the real unit needs 45 to 50 s). */
export const WARM_UP_S = 45;

/** The selector has stops at OFF and TST. */
export function turnSelector(position: SelectorPosition, steps: number): SelectorPosition {
  const i = Math.min(Math.max(SELECTOR.indexOf(position) + Math.trunc(steps), 0), SELECTOR.length - 1);
  return SELECTOR[i]!;
}

/** The transponder mode a position selects. TST tests the unit while it keeps operating as in ALT. */
export function selectorMode(position: SelectorPosition): TransponderMode {
  switch (position) {
    case 'OFF':
      return 'OFF';
    case 'SBY':
      return 'STBY';
    case 'ON':
      return 'ON';
    case 'ALT':
    case 'TST':
      return 'ALT';
  }
}

/** Where the knob points for a mode set elsewhere (or restored from a saved session). */
export function selectorFor(mode: TransponderMode): SelectorPosition {
  switch (mode) {
    case 'OFF':
      return 'OFF';
    case 'STBY':
    case 'GND':
      return 'SBY';
    case 'ON':
      return 'ON';
    case 'ALT':
      return 'ALT';
  }
}

/** Turns one code drum. Each drum carries 0 to 7 and turns round continuously. */
export function turnCodeDigit(code: string, index: number, steps: number): string {
  const digits = code.padStart(4, '0').slice(-4).split('');
  const d = Number(digits[index] ?? 0);
  digits[index] = String((((d + Math.trunc(steps)) % 8) + 8) % 8);
  return digits.join('');
}

export interface LampInput {
  readonly position: SelectorPosition;
  readonly mode: TransponderMode;
  readonly simTime: number;
  readonly identUntil: number | null;
  /** Sim time the warm-up ends. */
  readonly warmUntil: number;
}

/**
 * Reply lamp: lit steadily during the test and while the ident pulse is
 * transmitted, flashing with each reply otherwise. Dark when off, in
 * standby and while warming up.
 */
export function lampLit(i: LampInput): boolean {
  if (i.position === 'OFF' || i.simTime < i.warmUntil) return false;
  if (i.position === 'TST') return true;
  if (identActive(i.identUntil, i.simTime) && (i.mode === 'ON' || i.mode === 'ALT')) return true;
  return replyFlash(i.mode, i.simTime);
}
