import { entryValue, startEntry, turnLarge, turnSmall, type Completer, type IdentEntry } from '../../../ui/identEntry';

/*
 * The Direct-to window (a small window on the PFD, a page panel on the
 * MFD). The identifier field opens pre-filled with the waypoint under the
 * cursor or the active waypoint. Turning the small FMS knob clockwise edits
 * it with spell-ahead; counter-clockwise opens the waypoint submenu (flight
 * plan and nearest airport lists, Pilot's Guide Figure 5-53). ENT accepts
 * and moves the cursor to ACTIVATE?; ENT again flies direct. CLR first
 * closes a list or abandons an edit, then closes the window.
 */

export type DirectToField = 'ident' | 'activate';
export type WaypointList = 'FPL' | 'NRST';

export interface DirectToLists {
  readonly FPL: readonly string[];
  readonly NRST: readonly string[];
}

export interface DirectToState {
  readonly entry: IdentEntry;
  /** Knob entry in progress: the field shows the character cursor. */
  readonly editing: boolean;
  /** What the field showed before editing; CLR goes back to it. */
  readonly previous: string;
  readonly field: DirectToField;
  /** Waypoint submenu open on a list, with the highlighted row. */
  readonly list: { readonly kind: WaypointList; readonly index: number } | null;
}

export interface DirectToResult {
  /** Null when the window closes. */
  readonly state: DirectToState | null;
  /** Identifier to fly direct to. */
  readonly activate?: string;
}

/** True when the identifier names a waypoint in the database. */
export type Resolver = (ident: string) => boolean;

export function openDirectTo(prefill: string): DirectToState {
  return { entry: startEntry(prefill), editing: false, previous: prefill.trim().toUpperCase(), field: 'ident', list: null };
}

export function directToIdent(s: DirectToState): string {
  return entryValue(s.entry);
}

const LIST_ORDER: readonly WaypointList[] = ['FPL', 'NRST'];

/**
 * Small FMS knob. Clockwise edits the identifier from its first character;
 * counter-clockwise opens the waypoint submenu on the flight plan list (or
 * the nearest list when there is no plan). With the submenu open it steps
 * between the lists.
 */
export function directToInner(s: DirectToState, steps: number, complete: Completer, lists?: DirectToLists): DirectToState {
  if (s.list && lists) {
    const i = LIST_ORDER.indexOf(s.list.kind);
    const kind = LIST_ORDER[Math.min(Math.max(i + Math.sign(steps), 0), LIST_ORDER.length - 1)]!;
    return kind === s.list.kind ? s : { ...s, list: { kind, index: 0 } };
  }
  if (steps < 0 && !s.editing && lists) {
    return { ...s, field: 'ident', list: { kind: lists.FPL.length > 0 ? 'FPL' : 'NRST', index: 0 } };
  }
  const entry = s.editing ? s.entry : { ...s.entry, cursor: 0, entered: 0 };
  return { ...s, editing: true, field: 'ident', list: null, entry: turnSmall(entry, steps, complete) };
}

/** Large FMS knob: scrolls the open list, moves the character cursor while editing, otherwise steps between the fields. */
export function directToOuter(s: DirectToState, steps: number, resolves: Resolver, lists?: DirectToLists): DirectToState {
  if (s.list && lists) {
    const count = lists[s.list.kind].length;
    return { ...s, list: { ...s.list, index: Math.min(Math.max(s.list.index + steps, 0), Math.max(count - 1, 0)) } };
  }
  if (s.editing) return { ...s, entry: turnLarge(s.entry, steps) };
  if (steps > 0 && s.field === 'ident' && resolves(directToIdent(s))) return { ...s, field: 'activate' };
  if (steps < 0 && s.field === 'activate') return { ...s, field: 'ident' };
  return s;
}

/** The identifier highlighted in the open waypoint list. */
export function listSelection(s: DirectToState, lists: DirectToLists): string | null {
  return s.list ? (lists[s.list.kind][s.list.index] ?? null) : null;
}

export function directToEnt(s: DirectToState, resolves: Resolver, lists?: DirectToLists): DirectToResult {
  const picked = lists ? listSelection(s, lists) : null;
  if (s.list) {
    if (!picked) return { state: { ...s, list: null } };
    return { state: { entry: startEntry(picked), editing: false, previous: picked, field: 'activate', list: null } };
  }
  const ident = directToIdent(s);
  if (s.field === 'activate') return resolves(ident) ? { state: null, activate: ident } : { state: { ...s, field: 'ident' } };
  if (!resolves(ident)) return { state: s };
  // Accepting the identifier: the field settles and the cursor moves on to ACTIVATE?.
  return { state: { entry: startEntry(ident), editing: false, previous: ident, field: 'activate', list: null } };
}

export function directToClr(s: DirectToState): DirectToResult {
  if (s.list) return { state: { ...s, list: null } };
  if (s.editing) return { state: { ...s, editing: false, entry: startEntry(s.previous) } };
  return { state: null };
}

/**
 * Where a direct-to joins the flight plan: going direct to a waypoint that
 * is in the plan resumes the plan after it. Prefers the row it was picked
 * from, then the first match at or after the active waypoint.
 */
export function planIndexFor(
  plan: readonly { readonly ident: string }[],
  ident: string,
  preferred: number | null,
  activeIndex: number | null,
): number | null {
  if (preferred !== null && plan[preferred]?.ident === ident) return preferred;
  const from = activeIndex ?? 0;
  for (let i = from; i < plan.length; i++) if (plan[i]!.ident === ident) return i;
  const any = plan.findIndex((w) => w.ident === ident);
  return any >= 0 ? any : null;
}
