import { NavDatabase } from '../../../core/navdb';
import { airportOf, frequencyRows, navcomAirports, waypointAt } from './data';
import { item, LIST_ROWS, loadStandby, step, type PageLogic } from './page';
import { MAP_RANGES_NM, NAV_MAP_RANGES_NM } from './pages';
import type { GnsCtx, GnsUi, MapUi, PageId, TerrainUi, VnavUi } from './types';
import { openWpt, planIndexOf } from './wpt';

/*
 * NAV group pages (Default NAV, Map, TERRAIN, NAVCOM, Position, Satellite,
 * VNAV) plus the MSG and VNAV function pages. The PROC page is in proc.ts.
 */

const clampIndex = (i: number, n: number) => Math.min(Math.max(i, 0), n - 1);

/** Factory map setup: 10 nm, no declutter, data fields on the 430W and off on the 530W. */
export function defaultMap(model: GnsUi['model']): MapUi {
  return { range: MAP_RANGES_NM.indexOf(10), declutter: 0, fields: model === '430', pointer: null };
}

/** How far one knob click moves the panning pointer, as a share of the map scale (about 5 pixels). */
const PAN_STEP = 1 / 24;
/**
 * A waypoint within this share of the map scale is "under" the pointer. It
 * is more than half a click diagonally, so the pointer can reach any point.
 */
const POINTER_TOLERANCE = PAN_STEP;

const mapRangeNm = (ui: GnsUi) => MAP_RANGES_NM[ui.map.range] ?? 10;

/** The airport or navaid under the panning pointer. */
export function pointedWaypoint(ui: GnsUi, db: GnsCtx['db']) {
  const p = ui.map.pointer;
  return p ? waypointAt(db, p, mapRangeNm(ui) * POINTER_TOLERANCE) : undefined;
}

function pan(ui: GnsUi, northSteps: number, eastSteps: number): GnsUi {
  const p = ui.map.pointer;
  if (!p) return ui;
  const nm = mapRangeNm(ui) * PAN_STEP;
  const lat = Math.min(Math.max(p.lat + (northSteps * nm) / 60, -85), 85);
  const lon = p.lon + (eastSteps * nm) / (60 * Math.max(Math.cos((p.lat * Math.PI) / 180), 0.05));
  return { ...ui, map: { ...ui.map, pointer: { lat, lon } } };
}

const defaultNav: PageLogic = {
  stops: () => 0,
  // Only the 530W default NAV page carries a map.
  range: (ui, delta) => (ui.model === '530' ? { ...ui, navRange: clampIndex(ui.navRange + delta, NAV_MAP_RANGES_NM.length) } : null),
  menu: (ui) =>
    ui.model === '530'
      ? [item('Crossfill?', 'none', false), item('Change Fields?', 'none', false), item('Enable Auto Zoom?', 'none', false), item('Restore Defaults?', 'nav.restore')]
      : [item('Crossfill?', 'none', false), item('Change Fields?', 'none', false), item('Restore Defaults?', 'nav.restore')],
};

/**
 * Map page. CRSR shows the panning pointer: the small knob moves it north
 * and south, the large knob east and west. ENT on a waypoint opens its WPT
 * page; D-> flies to it, or to a "+MAP" waypoint at the pointer.
 */
const map: PageLogic = {
  stops: () => 1,
  cursorOn: (ui, ctx) => ({ ...ui, map: { ...ui.map, pointer: { lat: ctx.state.aircraft.lat, lon: ctx.state.aircraft.lon } } }),
  small: (ui, _ctx, _stop, steps) => step(pan(ui, steps, 0)),
  large: (ui, _ctx, _stop, steps) => step(pan(ui, 0, steps)),
  ent: (ui, ctx) => {
    const w = pointedWaypoint(ui, ctx.db);
    if (!w) return null;
    const plain = NavDatabase.toWaypoint(w);
    if (w.kind === 'airport') return step(openWpt(ui, ctx, 'wpt.apt', { airport: plain }));
    return step(openWpt(ui, ctx, w.kind === 'vor' ? 'wpt.vor' : 'wpt.ndb', w.kind === 'vor' ? { vor: plain } : { ndb: plain }));
  },
  dto: (ui, ctx, stop) => {
    if (stop === null || !ui.map.pointer) return null;
    const w = pointedWaypoint(ui, ctx.db);
    if (w) {
      const plain = NavDatabase.toWaypoint(w);
      return { wp: plain, planIndex: planIndexOf(ctx.state.fms, plain) };
    }
    const p = ui.map.pointer;
    return { wp: { kind: 'user', ident: '+MAP', name: 'Map pointer', lat: p.lat, lon: p.lon }, planIndex: null };
  },
  range: (ui, delta) => ({ ...ui, map: { ...ui.map, range: clampIndex(ui.map.range + delta, MAP_RANGES_NM.length) } }),
  // "press the CLR key (repeatedly) until the desired detail is depicted": four levels.
  clr: (ui, _ctx, stop) => (stop === null ? step({ ...ui, map: { ...ui.map, declutter: (ui.map.declutter + 1) % 4 } }) : null),
  menu: (ui) => [
    item('Setup Map?', 'none', false),
    item('Measure Dist?', 'none', false),
    item(ui.map.fields ? 'Data Fields Off?' : 'Data Fields On?', 'map.fields'),
    item('Change Fields?', 'none', false),
    item('Restore Defaults?', 'map.restore'),
  ],
};

/** The frequencies listed on the NAVCOM page for the selected flight plan airport. */
export function navcomRows(ui: GnsUi, ctx: Pick<GnsCtx, 'state' | 'nearest' | 'db'>) {
  const airports = navcomAirports(ctx);
  const chosen = airports[Math.min(ui.navcomAirport, airports.length - 1)];
  const a = chosen ? airportOf(ctx.db, chosen.wp) : undefined;
  return { airports, chosen: chosen ?? null, rows: a ? frequencyRows(a) : [] };
}

const navcom: PageLogic = {
  stops: (ui, ctx) => {
    const { airports, rows } = navcomRows(ui, ctx);
    return airports.length > 0 ? 1 + rows.length : 0;
  },
  list: (ui, ctx) => ({ header: 1, perRow: 1, visible: LIST_ROWS[ui.model].freq, rows: navcomRows(ui, ctx).rows.length }),
  small: (ui, ctx, stop) => {
    if (stop !== 0) return null;
    const { airports } = navcomRows(ui, ctx);
    return step({ ...ui, popup: { kind: 'list', purpose: 'navcom.airport', items: airports.map((x) => x.wp), index: Math.min(ui.navcomAirport, airports.length - 1) } });
  },
  ent: (ui, ctx, stop) => {
    const row = navcomRows(ui, ctx).rows[stop - 1];
    return stop >= 1 && row ? step(ui, [loadStandby(row.khz)]) : null;
  },
};

export const DEFAULT_VNAV: VnavUi = { altitudeFt: 1000, aboveWpt: true, offsetNm: 4, before: true, profileFpm: 400 };
export const VNAV_STOP = { altitude: 0, reference: 1, offset: 2, beforeAfter: 3, profile: 4 } as const;

/** Vertical navigation: target altitude and position relative to the active waypoint, and the profile. */
const vnav: PageLogic = {
  stops: () => 5,
  small: (ui, _ctx, stop, steps) => {
    const v = ui.vnav;
    let next: VnavUi;
    switch (stop) {
      case VNAV_STOP.altitude:
        next = { ...v, altitudeFt: Math.min(Math.max(v.altitudeFt + steps * 100, -1000), 25000) };
        break;
      case VNAV_STOP.reference:
        next = { ...v, aboveWpt: !v.aboveWpt };
        break;
      case VNAV_STOP.offset:
        next = { ...v, offsetNm: Math.min(Math.max(Math.round((v.offsetNm + steps * 0.5) * 10) / 10, 0), 99) };
        break;
      case VNAV_STOP.beforeAfter:
        next = { ...v, before: !v.before };
        break;
      default:
        next = { ...v, profileFpm: Math.min(Math.max(v.profileFpm + steps * 50, 100), 2000) };
    }
    return step({ ...ui, vnav: next });
  },
  menu: () => [item('VNAV Messages On?', 'none', false), item('Restore Defaults?', 'vnav.restore')],
};

/** TERRAIN page display ranges: "1 NM, 2 NM, 5 NM, 10 NM, 25 NM, 50 NM, 100 NM". */
export const TERRAIN_RANGES_NM: readonly number[] = [1, 2, 5, 10, 25, 50, 100];

export const DEFAULT_TERRAIN: TerrainUi = { view: 360, range: TERRAIN_RANGES_NM.indexOf(10), aviation: false, inhibited: false };

/**
 * TERRAIN page: RNG changes the range, CLR shows or hides aviation data,
 * MENU inhibits alerts, switches the 360 and 120 degree views and the
 * aviation data.
 */
const terrain: PageLogic = {
  stops: () => 0,
  range: (ui, delta) => ({ ...ui, terrain: { ...ui.terrain, range: clampIndex(ui.terrain.range + delta, TERRAIN_RANGES_NM.length) } }),
  clr: (ui, _ctx, stop) => (stop === null ? step({ ...ui, terrain: { ...ui.terrain, aviation: !ui.terrain.aviation } }) : null),
  menu: (ui) => [
    item(ui.terrain.inhibited ? 'Enable Terrain?' : 'Inhibit Terrain?', 'terrain.inhibit'),
    item(ui.terrain.view === 360 ? 'View 120°?' : 'View 360°?', 'terrain.view'),
    item(ui.terrain.aviation ? 'Hide Aviation Data?' : 'Show Aviation Data?', 'terrain.aviation'),
  ],
};

const none: PageLogic = { stops: () => 0 };

export const NAV_LOGIC: Partial<Record<PageId, PageLogic>> = {
  'nav.default': defaultNav,
  'nav.map': map,
  'nav.terrain': terrain,
  'nav.navcom': navcom,
  'nav.position': none,
  'nav.satellite': none,
  'nav.vnav': vnav,
  vnav,
  msg: none,
};
