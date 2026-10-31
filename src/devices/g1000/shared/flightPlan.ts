import { entryValue, startEntry, turnLarge, turnSmall, type Completer, type IdentEntry } from '../../../ui/identEntry';

/*
 * Cursor editing of the active flight plan, shared by the PFD Flight Plan
 * window and the MFD Active Flight Plan page.
 *
 * Rows are the plan's waypoints plus an empty line at the end. The large
 * FMS knob moves the cursor; turning the small knob starts entering an
 * identifier that ENT inserts above the cursor row (the data insertion
 * pointer); CLR on a waypoint asks "Remove XXXXX?".
 */

export interface FplCursor {
  /** Row under the cursor (plan.length = the empty line), or null when the cursor is off. */
  readonly index: number | null;
  /** Identifier being entered for insertion above `index`. */
  readonly entry: IdentEntry | null;
}

export const FPL_CURSOR_OFF: FplCursor = { index: null, entry: null };

/** Turning the cursor on puts it on the active waypoint, or the empty line of an inactive plan. */
export function fplCursorOn(planLength: number, activeIndex: number | null): FplCursor {
  return { index: activeIndex !== null && activeIndex < planLength ? activeIndex : planLength, entry: null };
}

/** Keeps the cursor on a real row after the plan changed elsewhere. */
export function fplClamp(c: FplCursor, planLength: number): FplCursor {
  if (c.index === null || c.index <= planLength) return c;
  return { ...c, index: planLength };
}

export function fplOuter(c: FplCursor, steps: number, planLength: number): FplCursor {
  if (c.index === null) return c;
  if (c.entry) return { ...c, entry: turnLarge(c.entry, steps) };
  return { ...c, index: Math.min(Math.max(c.index + steps, 0), planLength) };
}

export function fplInner(c: FplCursor, steps: number, complete: Completer): FplCursor {
  if (c.index === null) return c;
  return { ...c, entry: turnSmall(c.entry ?? startEntry(''), steps, complete) };
}

export interface FplEntResult {
  readonly cursor: FplCursor;
  /** Insert this identifier before plan[index]. */
  readonly insert?: { readonly index: number; readonly ident: string };
}

export function fplEnt(c: FplCursor, resolves: (ident: string) => boolean): FplEntResult {
  if (c.index === null || !c.entry) return { cursor: c };
  const ident = entryValue(c.entry);
  if (!ident || !resolves(ident)) return { cursor: c };
  // The cursor follows the row it was on, now one lower, ready for the next entry.
  return { cursor: { index: c.index + 1, entry: null }, insert: { index: c.index, ident } };
}

export interface FplClrResult {
  readonly cursor: FplCursor;
  /** Ask to remove plan[remove]. */
  readonly remove?: number;
}

export function fplClr(c: FplCursor, planLength: number): FplClrResult {
  if (c.entry) return { cursor: { ...c, entry: null } };
  if (c.index !== null && c.index < planLength) return { cursor: c, remove: c.index };
  return { cursor: c };
}

/** First visible row so that `index` stays inside a window of `rows` lines. */
export function scrollToShow(scroll: number, index: number | null, rows: number, total: number): number {
  const maxScroll = Math.max(total - rows, 0);
  let s = Math.min(Math.max(scroll, 0), maxScroll);
  if (index === null) return s;
  if (index < s) s = index;
  if (index >= s + rows) s = index - rows + 1;
  return Math.min(Math.max(s, 0), maxScroll);
}
