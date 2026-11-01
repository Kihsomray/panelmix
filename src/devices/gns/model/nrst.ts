import { NavDatabase } from '../../../core/navdb';
import { trafficFrequency } from './data';
import { LIST_ROWS, loadStandby, step, type PageLogic } from './page';
import { openWpt } from './wpt';
import type { PageId } from './types';

/*
 * NRST group (Section 7). With the cursor on, the large knob walks down the
 * list: on an identifier ENT opens its WPT page (with "Done?"), on a
 * frequency ENT loads it into the standby field; D-> picks up the
 * highlighted waypoint. Intersections come from the CIFP fixes.
 */

/** Nearest airports: two stops per airport, the identifier and the traffic frequency. */
const nrstApt: PageLogic = {
  stops: (_ui, ctx) => ctx.nearest.airports.length * 2,
  list: (ui, ctx) => ({ header: 0, perRow: 2, visible: LIST_ROWS[ui.model].nrstApt, rows: ctx.nearest.airports.length }),
  ent: (ui, ctx, stop) => {
    const a = ctx.nearest.airports[Math.floor(stop / 2)];
    if (!a) return null;
    if (stop % 2 === 1) {
      const f = trafficFrequency(a);
      return f ? step(ui, [loadStandby(f.khz)]) : null;
    }
    return step(openWpt(ui, ctx, 'wpt.apt', { airport: NavDatabase.toWaypoint(a) }));
  },
  dto: (_ui, ctx, stop) => {
    const a = stop === null ? undefined : ctx.nearest.airports[Math.floor(stop / 2)];
    return a ? { wp: NavDatabase.toWaypoint(a), planIndex: null } : null;
  },
};

/** Nearest VORs: identifier and frequency (ENT tunes the VLOC standby). */
const nrstVor: PageLogic = {
  stops: (_ui, ctx) => ctx.nearest.vors.length * 2,
  list: (ui, ctx) => ({ header: 0, perRow: 2, visible: LIST_ROWS[ui.model].nrstNav, rows: ctx.nearest.vors.length }),
  ent: (ui, ctx, stop) => {
    const v = ctx.nearest.vors[Math.floor(stop / 2)];
    if (!v) return null;
    if (stop % 2 === 1) return step(ui, [{ type: 'nav.setStandby', radio: 0, khz: v.freqKhz }]);
    return step(openWpt(ui, ctx, 'wpt.vor', { vor: NavDatabase.toWaypoint(v) }));
  },
  dto: (_ui, ctx, stop) => {
    const v = stop === null ? undefined : ctx.nearest.vors[Math.floor(stop / 2)];
    return v ? { wp: NavDatabase.toWaypoint(v), planIndex: null } : null;
  },
};

/** Nearest NDBs: the GNS has no ADF receiver, so only the identifier is selectable. */
const nrstNdb: PageLogic = {
  stops: (_ui, ctx) => ctx.nearest.ndbs.length,
  list: (ui, ctx) => ({ header: 0, perRow: 1, visible: LIST_ROWS[ui.model].nrstNav, rows: ctx.nearest.ndbs.length }),
  ent: (ui, ctx, stop) => {
    const n = ctx.nearest.ndbs[stop];
    return n ? step(openWpt(ui, ctx, 'wpt.ndb', { ndb: NavDatabase.toWaypoint(n) })) : null;
  },
  dto: (_ui, ctx, stop) => {
    const n = stop === null ? undefined : ctx.nearest.ndbs[stop];
    return n ? { wp: NavDatabase.toWaypoint(n), planIndex: null } : null;
  },
};

/** Nearest intersections: the identifier opens the INT page. */
const nrstInt: PageLogic = {
  stops: (_ui, ctx) => ctx.nearest.fixes.length,
  list: (ui, ctx) => ({ header: 0, perRow: 1, visible: LIST_ROWS[ui.model].nrstNav, rows: ctx.nearest.fixes.length }),
  ent: (ui, ctx, stop) => {
    const f = ctx.nearest.fixes[stop];
    return f ? step(openWpt(ui, ctx, 'wpt.int', { int: NavDatabase.toWaypoint(f) })) : null;
  },
  dto: (_ui, ctx, stop) => {
    const f = stop === null ? undefined : ctx.nearest.fixes[stop];
    return f ? { wp: NavDatabase.toWaypoint(f), planIndex: null } : null;
  },
};

/** Pages whose data (user waypoints, ARTCC, FSS, airspace) the trainer doesn't have. */
const empty: PageLogic = { stops: () => 0 };

export const NRST_LOGIC: Partial<Record<PageId, PageLogic>> = {
  'nrst.apt': nrstApt,
  'nrst.vor': nrstVor,
  'nrst.ndb': nrstNdb,
  'nrst.int': nrstInt,
  'nrst.usr': empty,
  'nrst.artcc': empty,
  'nrst.fss': empty,
  'nrst.asp': empty,
};
