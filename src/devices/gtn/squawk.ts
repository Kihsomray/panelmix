/*
 * Squawk code entry on the GTN XPDR page. Keys 0-7 type from the left and the
 * digits not entered yet show as underscores; Backspace (or the large knob)
 * moves the cursor back, the small knob rolls the digit under the cursor.
 * Nothing changes on the transponder until Enter (or ENT+ID) with all four
 * digits in place.
 */

export interface SquawkEntry {
  /** Four characters: octal digits, "_" where nothing is entered yet. */
  readonly code: string;
  /** Next position to type into, 0-4 (4 = all four entered). */
  readonly cursor: number;
  /** False until the pilot changes something: the field shows the active code. */
  readonly editing: boolean;
}

const BLANK = '_';

export function startSquawk(active: string): SquawkEntry {
  return { code: active, cursor: 0, editing: false };
}

const put = (code: string, at: number, ch: string) => code.slice(0, at) + ch + code.slice(at + 1);

export function pressDigit(e: SquawkEntry, digit: string): SquawkEntry {
  if (!/^[0-7]$/.test(digit)) return e;
  if (!e.editing) return { code: `${digit}${BLANK.repeat(3)}`, cursor: 1, editing: true };
  if (e.cursor >= 4) return e;
  return { code: put(e.code, e.cursor, digit), cursor: e.cursor + 1, editing: true };
}

export function backspace(e: SquawkEntry): SquawkEntry {
  if (!e.editing) return { code: put(e.code, 3, BLANK), cursor: 3, editing: true };
  if (e.cursor === 0) return e;
  return { code: put(e.code, e.cursor - 1, BLANK), cursor: e.cursor - 1, editing: true };
}

/** Large knob: moves the cursor over the four digits. */
export function moveCursor(e: SquawkEntry, steps: number): SquawkEntry {
  return { ...e, editing: true, cursor: Math.min(Math.max(Math.min(e.cursor, 3) + steps, 0), 3) };
}

/** Small knob: rolls the digit under the cursor through 0-7. */
export function rollDigit(e: SquawkEntry, steps: number): SquawkEntry {
  const at = Math.min(e.cursor, 3);
  const ch = e.code[at] ?? BLANK;
  const current = ch === BLANK ? (steps > 0 ? -1 : 0) : Number(ch);
  const next = (((current + steps) % 8) + 8) % 8;
  return { code: put(e.code, at, String(next)), cursor: at, editing: true };
}

/** The code Enter would set, or null while digits are missing or nothing changed. */
export function completeCode(e: SquawkEntry): string | null {
  return e.editing && /^[0-7]{4}$/.test(e.code) ? e.code : null;
}
