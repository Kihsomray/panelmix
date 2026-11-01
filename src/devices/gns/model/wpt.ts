import { NavDatabase, type AnyWaypoint, type Waypoint } from '../../../core/navdb';
import type { FmsState } from '../../../sim/types';
import { startEntry, turnSmall } from '../../../ui/identEntry';
import { airportOf, completer, defaultWaypoint, frequencyRows, navaidOf } from './data';
import { LIST_ROWS, loadStandby, step, type ListShape, type PageLogic } from './page';
import { MAP_RANGES_NM, PAGES } from './pages';
import {
  approachRequest,
  chooseField,
  flowButtons,
  loadTerminal,
  openField,
  PAGE_FIELDS,
  procMiddleStops,
  procPageMenu,
  proceduresOf,
  hasProcedures,
  requestApproach,
  type ProcPageKind,
} from './proc';
import type { GnsCtx, GnsUi, MenuItem, PageId, Step, WptKind, WptSelection } from './types';

/*
 * WPT group: information pages for any airport, VOR, NDB or intersection.
 * The identifier field at the top takes spell-ahead entry (only that kind
 * of waypoint); frequencies auto-tune with ENT. Opened from a NRST list, the
 * pages show "Done?" to go back. Each page adds its own fields between the
 * identifier and "Done?".
 */

export const WPT_KIND: Partial<Record<PageId, WptKind>> = {
  'wpt.apt': 'airport',
  'wpt.rwy': 'airport',
  'wpt.freq': 'airport',
  'wpt.apr': 'airport',
  'wpt.arvl': 'airport',
  'wpt.dep': 'airport',
  'wpt.int': 'int',
  'wpt.ndb': 'ndb',
  'wpt.vor': 'vor',
  'wpt.usr': 'usr',
};

/** The part of the reducer context the WPT pages read (the screen passes the same). */
type WptCtx = Pick<GnsCtx, 'state' | 'nearest' | 'db' | 'procedures'>;

/** The waypoint a WPT page shows. */
export function wptWaypoint(ui: GnsUi, ctx: Pick<GnsCtx, 'state' | 'nearest'>, kind: WptKind): Waypoint | null {
  switch (kind) {
    case 'airport':
      return ui.wpt.airport ?? defaultWaypoint(ctx, 'airport');
    case 'vor':
      return ui.wpt.vor ?? defaultWaypoint(ctx, 'vor');
    case 'ndb':
      return ui.wpt.ndb ?? defaultWaypoint(ctx, 'ndb');
    case 'int':
      return ui.wpt.int ?? defaultWaypoint(ctx, 'fix');
    case 'usr':
      // No user waypoints in the trainer.
      return null;
  }
}

/** A page's own fields between the identifier and "Done?"; `i` counts from 0 at the first of them. */
interface WptMiddle {
  count(ui: GnsUi, ctx: WptCtx): number;
  small?(ui: GnsUi, ctx: GnsCtx, i: number, steps: number): Step | null;
  ent?(ui: GnsUi, ctx: GnsCtx, i: number): Step | null;
  menu?(ui: GnsUi, ctx: GnsCtx): readonly MenuItem[];
  /** A scrolling list of the fields (the frequency page). */
  list?(ui: GnsUi, ctx: WptCtx): Omit<ListShape, 'header'>;
}

const airportShown = (ui: GnsUi, ctx: WptCtx) => airportOf(ctx.db, wptWaypoint(ui, ctx, 'airport'));

const runways: WptMiddle = {
  count: (ui, ctx) => ((airportShown(ui, ctx)?.runways.length ?? 0) > 0 ? 1 : 0),
  small: (ui, ctx, _i, steps) => {
    const n = airportShown(ui, ctx)?.runways.length ?? 0;
    if (n === 0) return null;
    return step({ ...ui, wpt: { ...ui.wpt, runway: (((ui.wpt.runway + steps) % n) + n) % n } });
  },
};

const frequencies: WptMiddle = {
  count: (ui, ctx) => {
    const a = airportShown(ui, ctx);
    return a ? frequencyRows(a).length : 0;
  },
  ent: (ui, ctx, i) => {
    const a = airportShown(ui, ctx);
    const row = a ? frequencyRows(a)[i] : undefined;
    return row ? step(ui, [loadStandby(row.khz)]) : null;
  },
  list: (ui, ctx) => ({ perRow: 1, visible: LIST_ROWS[ui.model].freq, rows: frequencies.count(ui, ctx) }),
};

const vorFrequency: WptMiddle = {
  count: (ui, ctx) => (navaidOf(ctx.db, wptWaypoint(ui, ctx, 'vor'), 'vor') ? 1 : 0),
  ent: (ui, ctx) => {
    const v = navaidOf(ctx.db, wptWaypoint(ui, ctx, 'vor'), 'vor');
    return v ? step(ui, [{ type: 'nav.setStandby', radio: 0, khz: v.freqKhz }]) : null;
  },
};

/** The approach, arrival and departure pages: procedure fields with their windows, then "Load?" (and "Activate?"). */
function procedureFields(kind: ProcPageKind): WptMiddle {
  const fields = PAGE_FIELDS[kind];
  return {
    count: (ui, ctx) => procMiddleStops(kind, ui, ctx, wptWaypoint(ui, ctx, 'airport')),
    small: (ui, ctx, i) => {
      const airport = wptWaypoint(ui, ctx, 'airport');
      const field = fields[i];
      return airport && field ? step(openField(ui, ctx, field, airport)) : null;
    },
    ent: (ui, ctx, i) => {
      const airport = wptWaypoint(ui, ctx, 'airport');
      if (!airport) return null;
      // ENT on a field moves on to the next one ("The cursor moves to the transitions field").
      if (i < fields.length) return step({ ...ui, cursor: 1 + Math.min(i + 1, fields.length - 1 + (ui.proc.flow === kind ? 1 : 0)) });
      const button = flowButtons(kind)[i - fields.length];
      if (kind === 'approach') {
        const load = approachRequest(ui, ctx, airport, button === 'activate' ? 'activate' : 'load');
        return load ? requestApproach(ui, ctx, load) : null;
      }
      return loadTerminal(ui, ctx, kind, airport);
    },
    menu: (ui, ctx) => procPageMenu(kind, hasProcedures(kind, proceduresOf(ctx, wptWaypoint(ui, ctx, 'airport')))),
  };
}

const MIDDLES: Partial<Record<PageId, WptMiddle>> = {
  'wpt.rwy': runways,
  'wpt.freq': frequencies,
  'wpt.vor': vorFrequency,
  'wpt.apr': procedureFields('approach'),
  'wpt.arvl': procedureFields('arrival'),
  'wpt.dep': procedureFields('departure'),
};

const middleStops = (page: PageId, ui: GnsUi, ctx: WptCtx) => MIDDLES[page]?.count(ui, ctx) ?? 0;

export function wptStops(page: PageId, ui: GnsUi, ctx: WptCtx): number {
  return 1 + middleStops(page, ui, ctx) + (ui.wptReturn ? 1 : 0);
}

const isDone = (page: PageId, ui: GnsUi, ctx: WptCtx, stop: number) => ui.wptReturn !== null && stop === wptStops(page, ui, ctx) - 1;

/** Back to the list the WPT page was opened from ("Done?" or CLR). */
export function returnFromWpt(ui: GnsUi): GnsUi {
  const r = ui.wptReturn;
  if (!r) return ui;
  return { ...ui, group: r.group, pages: { ...ui.pages, [r.group]: r.page }, cursor: r.cursor, scroll: r.scroll, wptReturn: null, fn: null };
}

/** Shows a WPT page for a waypoint picked from a list, with "Done?" highlighted. */
export function openWpt(ui: GnsUi, ctx: GnsCtx, page: PageId, patch: Partial<WptSelection>): GnsUi {
  const back = { group: ui.group, page: ui.pages[ui.group], cursor: ui.cursor ?? 0, scroll: ui.scroll };
  const next: GnsUi = {
    ...ui,
    fn: null,
    group: 'WPT',
    pages: { ...ui.pages, WPT: Math.max(PAGES[ui.model].WPT.indexOf(page), 0) },
    wpt: { ...ui.wpt, ...patch, runway: 0 },
    wptReturn: back,
    scroll: 0,
    cursor: 0,
  };
  return { ...next, cursor: wptStops(page, next, ctx) - 1 };
}

/** Where a waypoint sits in the active flight plan, preferring the part still to fly. */
export function planIndexOf(fms: FmsState, wp: Waypoint): number | null {
  const same = (w: Waypoint) => w.ident === wp.ident && w.kind === wp.kind;
  const from = fms.activeLeg?.planIndex ?? 0;
  for (let i = from; i < fms.plan.length; i++) if (same(fms.plan[i]!)) return i;
  const i = fms.plan.findIndex(same);
  return i >= 0 ? i : null;
}

/** ENT after spelling an identifier on a WPT page. */
export function acceptWpt(ui: GnsUi, kind: WptKind, wp: AnyWaypoint): GnsUi {
  const plain = NavDatabase.toWaypoint(wp);
  const wpt: WptSelection =
    kind === 'vor'
      ? { ...ui.wpt, vor: plain }
      : kind === 'ndb'
        ? { ...ui.wpt, ndb: plain }
        : kind === 'int'
          ? { ...ui.wpt, int: plain }
          : { ...ui.wpt, airport: plain, runway: 0 };
  return { ...ui, wpt, entry: null, cursor: 0 };
}

/** ENT in an approach / arrival / departure window. */
export function chooseInWindow(ui: GnsUi, ctx: GnsCtx, field: Parameters<typeof chooseField>[4], value: string | null): GnsUi {
  const page = PAGES[ui.model].WPT[ui.pages.WPT];
  const kind: ProcPageKind = page === 'wpt.arvl' ? 'arrival' : page === 'wpt.dep' ? 'departure' : 'approach';
  const airport = wptWaypoint(ui, ctx, 'airport');
  return airport ? chooseField(ui, ctx, kind, airport, field, value) : { ...ui, popup: null };
}

function wptLogic(page: PageId): PageLogic {
  const kind = WPT_KIND[page]!;
  const middle = MIDDLES[page];
  const listOf = middle?.list;
  return {
    stops: (ui, ctx) => wptStops(page, ui, ctx),
    first: (ui, ctx) => (ui.wptReturn ? wptStops(page, ui, ctx) - 1 : 0),
    ...(listOf && { list: (ui: GnsUi, ctx: GnsCtx) => ({ header: 1, ...listOf(ui, ctx) }) }),
    small: (ui, ctx, stop, steps) => {
      if (stop === 0) {
        const current = wptWaypoint(ui, ctx, kind)?.ident ?? '';
        const e = turnSmall(startEntry(current), steps, completer(ctx.db, kind));
        return step({ ...ui, entry: { target: { kind: 'wpt', what: kind }, e } });
      }
      if (isDone(page, ui, ctx, stop)) return null;
      return middle?.small?.(ui, ctx, stop - 1, steps) ?? null;
    },
    ent: (ui, ctx, stop) => {
      if (isDone(page, ui, ctx, stop)) return step(returnFromWpt(ui));
      if (stop === 0) return null;
      return middle?.ent?.(ui, ctx, stop - 1) ?? null;
    },
    clr: (ui) => (ui.wptReturn ? step(returnFromWpt(ui)) : null),
    dto: (ui, ctx) => {
      const wp = wptWaypoint(ui, ctx, kind);
      return wp ? { wp, planIndex: planIndexOf(ctx.state.fms, wp) } : null;
    },
    ...(middle?.menu && { menu: middle.menu }),
    ...(page === 'wpt.rwy' && {
      range: (ui: GnsUi, delta: number) => ({ ...ui, rwyRange: Math.min(Math.max(ui.rwyRange + delta, 0), MAP_RANGES_NM.length - 1) }),
    }),
  };
}

export const WPT_LOGIC: Partial<Record<PageId, PageLogic>> = Object.fromEntries(
  Object.keys(WPT_KIND).map((p) => [p, wptLogic(p as PageId)]),
);
