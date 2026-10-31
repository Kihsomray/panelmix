import { NavDatabase, type AnyWaypoint, type Waypoint } from '../../../core/navdb';
import type { FmsState } from '../../../sim/types';
import { startEntry, turnSmall } from '../../../ui/identEntry';
import { airportOf, completer, defaultWaypoint, frequencyRows, navaidOf } from './data';
import { LIST_ROWS, loadStandby, step, type PageLogic } from './page';
import { MAP_RANGES_NM, PAGES } from './pages';
import type { GnsCtx, GnsUi, PageId, WptKind, WptSelection } from './types';

/*
 * WPT group: information pages for any airport, VOR or NDB. The identifier
 * field at the top takes spell-ahead entry; frequencies auto-tune with ENT.
 * Opened from a NRST list, the pages show "Done?" to go back.
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
type WptCtx = Pick<GnsCtx, 'state' | 'nearest' | 'db'>;

/** The waypoint a WPT page shows. */
export function wptWaypoint(ui: GnsUi, ctx: Pick<GnsCtx, 'state' | 'nearest'>, kind: WptKind): Waypoint | null {
  switch (kind) {
    case 'airport':
      return ui.wpt.airport ?? defaultWaypoint(ctx, 'airport');
    case 'vor':
      return ui.wpt.vor ?? defaultWaypoint(ctx, 'vor');
    case 'ndb':
      return ui.wpt.ndb ?? defaultWaypoint(ctx, 'ndb');
    default:
      // No intersections or user waypoints in the trainer database.
      return null;
  }
}

/** Stops between the identifier and "Done?" on each page. */
function middleStops(page: PageId, ui: GnsUi, ctx: WptCtx): number {
  if (page === 'wpt.rwy' || page === 'wpt.freq') {
    const a = airportOf(ctx.db, wptWaypoint(ui, ctx, 'airport'));
    if (!a) return 0;
    return page === 'wpt.rwy' ? (a.runways.length > 0 ? 1 : 0) : frequencyRows(a).length;
  }
  if (page === 'wpt.vor') return navaidOf(ctx.db, wptWaypoint(ui, ctx, 'vor'), 'vor') ? 1 : 0;
  return 0;
}

export function wptStops(page: PageId, ui: GnsUi, ctx: WptCtx): number {
  return 1 + middleStops(page, ui, ctx) + (ui.wptReturn ? 1 : 0);
}

const isDone = (page: PageId, ui: GnsUi, ctx: GnsCtx, stop: number) => ui.wptReturn !== null && stop === wptStops(page, ui, ctx) - 1;

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
  const wpt = kind === 'vor' ? { ...ui.wpt, vor: plain } : kind === 'ndb' ? { ...ui.wpt, ndb: plain } : { ...ui.wpt, airport: plain, runway: 0 };
  return { ...ui, wpt, entry: null, cursor: 0 };
}

function wptLogic(page: PageId): PageLogic {
  const kind = WPT_KIND[page]!;
  return {
    stops: (ui, ctx) => wptStops(page, ui, ctx),
    first: (ui, ctx) => (ui.wptReturn ? wptStops(page, ui, ctx) - 1 : 0),
    ...(page === 'wpt.freq' && {
      list: (ui: GnsUi, ctx: GnsCtx) => ({ header: 1, perRow: 1, visible: LIST_ROWS[ui.model].freq, rows: middleStops(page, ui, ctx) }),
    }),
    small: (ui, ctx, stop, steps) => {
      if (stop === 0) {
        const current = wptWaypoint(ui, ctx, kind)?.ident ?? '';
        const e = turnSmall(startEntry(current), steps, completer(ctx.db, kind));
        return step({ ...ui, entry: { target: { kind: 'wpt', what: kind }, e } });
      }
      if (page === 'wpt.rwy' && !isDone(page, ui, ctx, stop)) {
        const n = airportOf(ctx.db, wptWaypoint(ui, ctx, 'airport'))?.runways.length ?? 0;
        if (n === 0) return null;
        return step({ ...ui, wpt: { ...ui.wpt, runway: (((ui.wpt.runway + steps) % n) + n) % n } });
      }
      return null;
    },
    ent: (ui, ctx, stop) => {
      if (isDone(page, ui, ctx, stop)) return step(returnFromWpt(ui));
      if (page === 'wpt.freq' && stop >= 1) {
        const a = airportOf(ctx.db, wptWaypoint(ui, ctx, 'airport'));
        const row = a ? frequencyRows(a)[stop - 1] : undefined;
        return row ? step(ui, [loadStandby(row.khz)]) : null;
      }
      if (page === 'wpt.vor' && stop === 1) {
        const v = navaidOf(ctx.db, wptWaypoint(ui, ctx, 'vor'), 'vor');
        return v ? step(ui, [{ type: 'nav.setStandby', radio: 0, khz: v.freqKhz }]) : null;
      }
      return null;
    },
    clr: (ui) => (ui.wptReturn ? step(returnFromWpt(ui)) : null),
    dto: (ui, ctx) => {
      const wp = wptWaypoint(ui, ctx, kind);
      return wp ? { wp, planIndex: planIndexOf(ctx.state.fms, wp) } : null;
    },
    ...(page === 'wpt.rwy' && {
      range: (ui: GnsUi, delta: number) => ({ ...ui, rwyRange: Math.min(Math.max(ui.rwyRange + delta, 0), MAP_RANGES_NM.length - 1) }),
    }),
  };
}

export const WPT_LOGIC: Partial<Record<PageId, PageLogic>> = Object.fromEntries(
  Object.keys(WPT_KIND).map((p) => [p, wptLogic(p as PageId)]),
);
