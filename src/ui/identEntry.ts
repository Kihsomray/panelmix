/*
 * Garmin knob entry for identifiers, shared by every knob-driven unit
 * (GNS 430/530, G1000, the G5-era navigators):
 *
 *   - the small knob changes the character under the cursor
 *   - the large knob moves the cursor
 *   - after each change the rest of the field "spells ahead" to the first
 *     database identifier that starts with what has been entered
 *
 * Pure state; the device renders it (cursor character highlighted).
 */

/** The order the small knob steps through: blank, A-Z, 0-9. */
export const IDENT_CHARS = [' ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
export const MAX_IDENT = 6;

export interface IdentEntry {
  /** What the field shows, including spelled-ahead characters. */
  readonly text: string;
  readonly cursor: number;
  /** Number of characters the pilot has set (the rest are spell-ahead). */
  readonly entered: number;
}

export type Completer = (prefix: string) => string | undefined;

export function startEntry(initial = ''): IdentEntry {
  return { text: initial.toUpperCase().slice(0, MAX_IDENT), cursor: 0, entered: 0 };
}

/** Small knob: change the character under the cursor, then spell ahead. */
export function turnSmall(e: IdentEntry, steps: number, complete: Completer): IdentEntry {
  const current = e.text[e.cursor] ?? ' ';
  const i = IDENT_CHARS.indexOf(current);
  const n = IDENT_CHARS.length;
  // Starting from a blank, the first clockwise click lands on 'A', counter-clockwise on '9'.
  const next = IDENT_CHARS[(((i < 0 ? 0 : i) + steps) % n + n) % n]!;
  const prefix = (e.text.slice(0, e.cursor) + next).trimEnd();
  const completed = prefix ? complete(prefix) : undefined;
  return { text: completed ?? prefix, cursor: e.cursor, entered: e.cursor + 1 };
}

/** Large knob: move the cursor; it can sit one place past the end to add a character. */
export function turnLarge(e: IdentEntry, steps: number): IdentEntry {
  const max = Math.min(e.text.trimEnd().length, MAX_IDENT - 1);
  const cursor = Math.min(Math.max(e.cursor + steps, 0), max);
  return { ...e, cursor, entered: Math.max(e.entered, cursor) };
}

/** Typed on a keyboard (desktop convenience): replaces from the cursor and spells ahead. */
export function typeChar(e: IdentEntry, ch: string, complete: Completer): IdentEntry {
  const c = ch.toUpperCase();
  if (!/^[A-Z0-9]$/.test(c) || e.cursor >= MAX_IDENT) return e;
  const prefix = e.text.slice(0, e.cursor) + c;
  const completed = complete(prefix);
  return { text: completed ?? prefix, cursor: Math.min(e.cursor + 1, MAX_IDENT - 1), entered: e.cursor + 1 };
}

/** Backspace (desktop convenience). */
export function backspace(e: IdentEntry, complete: Completer): IdentEntry {
  if (e.cursor === 0 && e.entered === 0) return { text: '', cursor: 0, entered: 0 };
  const cursor = Math.max(e.cursor - (e.entered > e.cursor ? 0 : 1), 0);
  const prefix = e.text.slice(0, cursor);
  const completed = prefix ? complete(prefix) : undefined;
  return { text: completed ?? prefix, cursor, entered: cursor };
}

export function entryValue(e: IdentEntry): string {
  return e.text.trim();
}
