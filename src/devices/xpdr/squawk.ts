import type { TransponderMode } from '../../sim/types';

/*
 * Squawk-code rules shared by the transponders: keypad code entry (GTX 345),
 * the VFR key, the special codes the display calls out, and when the reply
 * light shows. Pure functions only; the units turn the results into sim
 * commands.
 */

/** Factory VFR code of a US-configured unit (installer configurable on the real one). */
const VFR_CODE = '1200';

/** Digits typed so far on the keypad, at most three (the fourth completes the code). */
export interface SquawkEntry {
  readonly digits: string;
}

export interface EntryStep {
  /** The entry still in progress, or null when it finished or was cancelled. */
  readonly entry: SquawkEntry | null;
  /** A complete four-digit code to activate. */
  readonly commit: string | null;
}

/** An octal code digit key, 0 to 7. Keys 8 and 9 never enter squawk digits. */
export function typeDigit(entry: SquawkEntry | null, digit: number): EntryStep {
  if (!Number.isInteger(digit) || digit < 0 || digit > 7) return { entry, commit: null };
  const digits = `${entry?.digits ?? ''}${digit}`;
  return digits.length === 4 ? { entry: null, commit: digits } : { entry: { digits }, commit: null };
}

/**
 * CLR: the cursor steps back one digit. With the cursor already on the first
 * digit it cancels the entry and the active code stays.
 */
export function clearDigit(entry: SquawkEntry | null): SquawkEntry | null {
  if (!entry || entry.digits.length === 0) return null;
  return { digits: entry.digits.slice(0, -1) };
}

/** CLR held: the cursor goes back to the first digit (entry continues). */
export function clearAll(entry: SquawkEntry | null): SquawkEntry | null {
  return entry ? { digits: '' } : null;
}

/**
 * ENT on a partly typed code accepts it with the untyped digits as zeros.
 * Nothing typed yet: the entry is simply closed.
 */
export function completeEntry(entry: SquawkEntry | null): EntryStep {
  if (!entry || entry.digits.length === 0) return { entry: null, commit: null };
  return { entry: null, commit: entry.digits.padEnd(4, '0') };
}

/** What the code field shows: the active code, or the typed digits with blanks ("367_"). */
export function shownCode(entry: SquawkEntry | null, activeCode: string): string {
  return entry ? entry.digits.padEnd(4, '_') : activeCode;
}

export interface VfrStep {
  readonly code: string;
  /** Code to restore on the next VFR press. */
  readonly previous: string | null;
}

/**
 * VFR key: sets the VFR code; pressed again it restores the code that was
 * active before, and further presses keep toggling between the two.
 */
export function pressVfr(code: string, previous: string | null, vfrCode: string = VFR_CODE): VfrStep {
  if (code !== vfrCode) return { code: vfrCode, previous: code };
  return previous !== null && previous !== vfrCode ? { code: previous, previous } : { code, previous };
}

/** Text the GTX 345 shows under the code for the codes ATC treats specially. */
export function specialCodeText(code: string): string | null {
  if (code === '7600') return 'LOST COMM';
  if (code === '7700') return 'EMERGENCY';
  return null;
}

/** Whether a mode makes the transponder answer interrogations. */
function isReplying(mode: TransponderMode): boolean {
  return mode === 'ON' || mode === 'ALT';
}

/**
 * Reply light. There is no radar model in the trainer, so replies follow two
 * imaginary radars: a terminal radar sweeping every 4.8 s and an en-route
 * radar every 12 s, each lighting the reply indicator briefly.
 */
export function replyFlash(mode: TransponderMode, simTime: number): boolean {
  if (!isReplying(mode)) return false;
  const terminal = ((simTime % 4.8) + 4.8) % 4.8 < 0.3;
  const enroute = (((simTime + 2.1) % 12) + 12) % 12 < 0.35;
  return terminal || enroute;
}

/** Ident pulse active (the sim times the 18 s pulse). */
export function identActive(identUntil: number | null, simTime: number): boolean {
  return identUntil !== null && simTime < identUntil;
}
