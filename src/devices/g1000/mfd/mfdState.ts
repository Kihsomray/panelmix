import { entryValue, startEntry, turnLarge, turnSmall, type Completer, type IdentEntry } from '../../../ui/identEntry';
import type { DirectToState } from '../shared/directTo';
import { FPL_CURSOR_OFF, type FplCursor } from '../shared/flightPlan';
import type { Confirm, PageMenu } from '../shared/menu';
import { openProcedures, type ProcState } from '../shared/procedures';
import { MFD_PAGES_START, type MfdPages } from './mfdPages';
import { mfdKeysStart, type MfdKeys } from './mfdSoftkeys';

/*
 * What the MFD keeps on its own screen: the page, softkey level, map range
 * and pointer, pop-ups, the Direct-to panel, and the cursor of each kind of
 * page. Pure helpers for the waypoint and nearest page cursors live here.
 */

export type Popup = { readonly kind: 'menu'; readonly menu: PageMenu } | { readonly kind: 'confirm'; readonly confirm: Confirm };

/** Waypoint information pages: the identifier shown and the cursor. */
export interface WptState {
  /** Identifier shown on each kind of page ('' = the default choice). */
  readonly idents: Readonly<Record<'airport' | 'vor' | 'ndb', string>>;
  readonly entry: IdentEntry | null;
  readonly cursor: 'off' | 'ident' | 'runway' | 'freq';
  readonly runway: number;
  readonly freq: number;
  /** DP, STAR or APR softkey: the procedure frame for the airport instead of its information. */
  readonly proc: 'dp' | 'star' | 'apr' | null;
}

/** Nearest pages: the selected item and which box the cursor is in. */
export interface NrstState {
  readonly item: number | null;
  readonly section: 'list' | 'runway' | 'freq';
  readonly runway: number;
  readonly freq: number;
}

export interface ChecklistState {
  /** Cursor on the checklist (FMS push); without it the FMS knob still selects pages. */
  readonly active: boolean;
  readonly list: number;
  readonly item: number;
  readonly checked: readonly string[];
  readonly emergency: boolean;
}

export interface MfdUi {
  readonly pages: MfdPages;
  readonly keys: MfdKeys;
  readonly rangeNm: number;
  /** Map range on the waypoint information pages, which open close in on the waypoint. */
  readonly infoRangeNm: number;
  readonly pointer: { readonly x: number; readonly y: number } | null;
  readonly popup: Popup | null;
  readonly dto: { readonly dto: DirectToState; readonly planIndex: number | null } | null;
  readonly proc: ProcState;
  readonly fpl: { readonly cursor: FplCursor; readonly scroll: number };
  readonly wpt: WptState;
  readonly nrst: NrstState;
  readonly checklist: ChecklistState;
}

export const WPT_START: WptState = { idents: { airport: '', vor: '', ndb: '' }, entry: null, cursor: 'off', runway: 0, freq: 0, proc: null };
export const NRST_START: NrstState = { item: null, section: 'list', runway: 0, freq: 0 };

export function mfdUiStart(tanksGal: number): MfdUi {
  return {
    pages: MFD_PAGES_START,
    keys: mfdKeysStart(tanksGal),
    rangeNm: 40,
    infoRangeNm: 2.5,
    pointer: null,
    popup: null,
    dto: null,
    proc: openProcedures(),
    fpl: { cursor: FPL_CURSOR_OFF, scroll: 0 },
    wpt: WPT_START,
    nrst: NRST_START,
    checklist: { active: false, list: 0, item: 0, checked: [], emergency: false },
  };
}

/** A cursor, window or pop-up has the FMS knob; otherwise it selects pages. */
export function mfdCursorActive(ui: MfdUi): boolean {
  return (
    ui.popup !== null ||
    ui.dto !== null ||
    ui.pages.proc ||
    ui.fpl.cursor.index !== null ||
    ui.wpt.cursor !== 'off' ||
    ui.nrst.item !== null ||
    ui.checklist.active
  );
}

// Waypoint information pages -----------------------------------------------------

export type WptKind = keyof WptState['idents'];

/** FMS push: cursor on the identifier, or off. */
export function wptPush(w: WptState): WptState {
  return w.cursor === 'off' ? { ...w, cursor: 'ident' } : { ...w, cursor: 'off', entry: null };
}

/** Small knob on the identifier edits it; in the runway or frequency box it steps through the list. */
export function wptInner(w: WptState, steps: number, complete: Completer, current: string, counts: { runways: number; freqs: number }): WptState {
  switch (w.cursor) {
    case 'off':
    case 'ident': {
      const entry = w.entry ?? { ...startEntry(current), cursor: 0, entered: 0 };
      return { ...w, cursor: 'ident', entry: turnSmall(entry, steps, complete) };
    }
    case 'runway':
      return { ...w, runway: wrap(w.runway + steps, counts.runways) };
    case 'freq':
      return { ...w, freq: Math.min(Math.max(w.freq + steps, 0), Math.max(counts.freqs - 1, 0)) };
  }
}

const SECTIONS: readonly WptState['cursor'][] = ['ident', 'runway', 'freq'];

/** Large knob: moves the character cursor while editing, else between the boxes (airports only have runways and frequencies). */
export function wptOuter(w: WptState, steps: number, hasSections: boolean): WptState {
  if (w.entry) return { ...w, entry: turnLarge(w.entry, steps) };
  if (w.cursor === 'off' || !hasSections) return w.cursor === 'off' ? { ...w, cursor: 'ident' } : w;
  const i = SECTIONS.indexOf(w.cursor);
  return { ...w, cursor: SECTIONS[Math.min(Math.max(i + Math.sign(steps), 0), SECTIONS.length - 1)]! };
}

/** ENT: accepts a typed identifier (when the database has it). */
export function wptEnt(w: WptState, kind: WptKind, resolves: (ident: string) => boolean): WptState {
  if (!w.entry) return w;
  const ident = entryValue(w.entry);
  if (!ident || !resolves(ident)) return w;
  return { ...w, entry: null, idents: { ...w.idents, [kind]: ident }, runway: 0, freq: 0 };
}

export function wptClr(w: WptState): WptState {
  if (w.entry) return { ...w, entry: null };
  return { ...w, cursor: 'off' };
}

const wrap = (i: number, n: number) => (n <= 0 ? 0 : ((i % n) + n) % n);

// Nearest pages -------------------------------------------------------------------------

/** Cursor in the list: the first turn lands on the nearest item. */
export function nrstMove(n: NrstState, steps: number, count: number, counts: { runways: number; freqs: number }): NrstState {
  switch (n.section) {
    case 'list': {
      if (count === 0) return n;
      const item = n.item === null ? 0 : Math.min(Math.max(n.item + steps, 0), count - 1);
      return { ...n, item, runway: item === n.item ? n.runway : 0, freq: item === n.item ? n.freq : 0 };
    }
    case 'runway':
      return { ...n, runway: wrap(n.runway + steps, counts.runways) };
    case 'freq':
      return { ...n, freq: Math.min(Math.max(n.freq + steps, 0), Math.max(counts.freqs - 1, 0)) };
  }
}

/** APT / RNWY / FREQ softkeys (and the FMS push) put the cursor in a box. */
export function nrstSection(n: NrstState, section: NrstState['section']): NrstState {
  return { ...n, section, item: n.item ?? 0 };
}

export function nrstPush(n: NrstState): NrstState {
  return n.item === null ? { ...n, item: 0, section: 'list' } : { ...NRST_START };
}
