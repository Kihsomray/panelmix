/*
 * Transponder code entry from the PFD (Pilot's Guide 4.4): the 0-7 digit
 * softkeys fill the code left to right and BKSP steps back. The next digit
 * must come within 10 seconds or the entry is abandoned and the old code
 * kept; five seconds after the fourth digit the new code becomes active.
 * The FMS knob can also enter it two digits at a time (small knob sets the
 * pair, large knob moves to the next pair, ENT finishes).
 */

export const CODE_IDLE_MS = 10_000;
export const CODE_COMMIT_MS = 5_000;

export interface CodeEntry {
  /** Digits entered so far, 0 to 4 octal characters. */
  readonly digits: string;
  /** Pair the FMS knob is setting: 0 = first two digits, 1 = last two. */
  readonly pair: 0 | 1;
  /** When the last digit was entered (ms). */
  readonly at: number;
}

export function startCode(now: number): CodeEntry {
  return { digits: '', pair: 0, at: now };
}

export function codeDigit(e: CodeEntry, digit: number, now: number): CodeEntry {
  if (e.digits.length >= 4 || digit < 0 || digit > 7) return e;
  const digits = e.digits + String(digit);
  return { digits, pair: digits.length >= 2 ? 1 : 0, at: now };
}

export function codeBackspace(e: CodeEntry, now: number): CodeEntry {
  const digits = e.digits.slice(0, -1);
  return { digits, pair: digits.length > 2 ? 1 : 0, at: now };
}

/** Small FMS knob: steps the current pair through 00..77 (octal). */
export function codeKnobInner(e: CodeEntry, steps: number, now: number): CodeEntry {
  const start = e.pair * 2;
  const current = e.digits.slice(start, start + 2).padEnd(2, '0');
  const value = (((parseInt(current, 8) + steps) % 64) + 64) % 64;
  const head = e.digits.slice(0, start).padEnd(start, '0');
  return { ...e, digits: head + value.toString(8).padStart(2, '0'), at: now };
}

/** Large FMS knob: moves between the two pairs. */
export function codeKnobOuter(e: CodeEntry, steps: number, now: number): CodeEntry {
  const pair = steps > 0 ? 1 : steps < 0 ? 0 : e.pair;
  // Moving on fills the first pair so the second one lands in place.
  const digits = pair === 1 ? e.digits.padEnd(2, '0') : e.digits;
  return { ...e, pair, digits, at: now };
}

export function codeComplete(e: CodeEntry): boolean {
  return e.digits.length === 4;
}

/** ENT finishes knob entry: missing digits become zeros. */
export function codeFinish(e: CodeEntry): string | null {
  return e.digits.length === 0 ? null : e.digits.padEnd(4, '0');
}

export type CodeTimer = 'commit' | 'expire' | null;

/** What is due at `now`: a complete code is committed, a stalled one abandoned. */
export function codeDue(e: CodeEntry, now: number): CodeTimer {
  if (codeComplete(e)) return now - e.at >= CODE_COMMIT_MS ? 'commit' : null;
  return now - e.at >= CODE_IDLE_MS ? 'expire' : null;
}

/** The code field while entering: typed digits, then dashes. */
export function codeDisplay(e: CodeEntry): string {
  return e.digits.padEnd(4, '_');
}
