import { bearing, distanceNm, type LatLon } from '../../../core/geo';
import type { MagneticModel } from '../../../core/magvar';
import type { Airport, AirportFrequency, AnyWaypoint, FrequencyType, Navaid, NavDatabase, Runway, Waypoint, WaypointKind } from '../../../core/navdb';
import { NavDatabase as Db } from '../../../core/navdb';
import type { FmsState } from '../../../sim/types';
import type { GnsCtx, NearestCriteria, NearestLists, WptKind } from './types';

/*
 * Database look-ups the pages and the reducer share: nearest lists, the
 * frequencies and runways the way a GNS labels them, spell-ahead restricted
 * to one kind of waypoint, and which waypoint a page shows by default.
 */

/** "detailed information on the 25 nearest airports, VORs, NDBs ... within 200 NM". */
export const NEAREST_COUNT = 25;
export const NEAREST_RANGE_NM = 200;
/** The D-> page NRST field "showing up to nine nearby airports". */
export const DTO_NEAREST_COUNT = 9;

export const DEFAULT_CRITERIA: NearestCriteria = { surface: 'any', minLengthFt: 0 };

export function nearestLists(db: NavDatabase, pos: LatLon, criteria: NearestCriteria): NearestLists {
  return {
    airports: db
      .nearestAirports(pos, NEAREST_COUNT, { minRunwayFt: criteria.minLengthFt, surface: criteria.surface }, NEAREST_RANGE_NM)
      .map((r) => r.item),
    vors: db.nearestNavaids(pos, NEAREST_COUNT, 'vor', NEAREST_RANGE_NM).map((r) => r.item),
    ndbs: db.nearestNavaids(pos, NEAREST_COUNT, 'ndb', NEAREST_RANGE_NM).map((r) => r.item),
  };
}

/** Memo key for the nearest lists: about a mile of movement, or a criteria change. */
export function nearestKey(pos: LatLon, criteria: NearestCriteria): string {
  return `${Math.round(pos.lat / 0.02)}:${Math.round(pos.lon / 0.02)}:${criteria.surface}:${criteria.minLengthFt}`;
}

/** Live bearing (magnetic) and distance to a waypoint. */
export function bearingDistance(mag: MagneticModel, pos: LatLon, to: LatLon): { brg: number; dis: number } {
  return { brg: mag.toMagnetic(bearing(pos, to), pos.lat, pos.lon), dis: distanceNm(pos, to) };
}

export const isNavKhz = (khz: number) => khz >= 108000 && khz <= 117950;

/** The common traffic frequency shown on the nearest airport page ("twr 127.650", "uni 122.800"). */
export function trafficFrequency(a: Airport): { tag: 'twr' | 'ctf' | 'uni' | 'mul'; khz: number } | null {
  const order: [FrequencyType, 'twr' | 'ctf' | 'uni' | 'mul'][] = [
    ['TWR', 'twr'],
    ['CTAF', 'ctf'],
    ['UNICOM', 'uni'],
    ['MULTI', 'mul'],
  ];
  for (const [type, tag] of order) {
    const f = a.frequencies.find((x) => x.type === type);
    if (f) return { tag, khz: f.khz };
  }
  return null;
}

const FREQ_LABEL: Record<FrequencyType, string> = {
  ATIS: 'ATIS',
  AWOS: 'AWOS',
  ASOS: 'ASOS',
  CLNC: 'Clearance',
  GND: 'Ground',
  TWR: 'Tower',
  CTAF: 'CTAF',
  UNICOM: 'Unicom',
  MULTI: 'Multicom',
  APP: 'Approach',
  DEP: 'Departure',
  CTR: 'Center',
  FSS: 'FSS',
  AFIS: 'AFIS',
  RCO: 'RCO',
};

const FREQ_ORDER: readonly FrequencyType[] = ['ATIS', 'AWOS', 'ASOS', 'CLNC', 'GND', 'TWR', 'CTAF', 'UNICOM', 'MULTI', 'APP', 'DEP', 'CTR', 'FSS', 'AFIS', 'RCO'];

export interface FreqRow {
  readonly label: string;
  readonly khz: number;
  /** Weather broadcasts: receive only ("Rx" beside the frequency). */
  readonly receiveOnly: boolean;
}

export function frequencyRows(a: Airport): FreqRow[] {
  const rank = (f: AirportFrequency) => FREQ_ORDER.indexOf(f.type);
  return [...a.frequencies]
    .sort((x, y) => rank(x) - rank(y) || x.khz - y.khz)
    .map((f) => ({ label: FREQ_LABEL[f.type], khz: f.khz, receiveOnly: f.type === 'ATIS' || f.type === 'AWOS' || f.type === 'ASOS' }));
}

/** "07L-25R" */
export const runwayName = (r: Runway) => r.name.replace('/', '-');

export const SURFACE_LABEL: Record<Runway['surface'], string> = { hard: 'HARD', soft: 'TURF', water: 'WATER' };

/** VOR class from the service volume, as the VOR page shows it. */
export function vorClass(n: Navaid): string {
  return n.power === 'HIGH' ? 'High Alt.' : n.power === 'LOW' ? 'Terminal' : 'Low Alt.';
}

const KIND_OF: Record<WptKind, WaypointKind | null> = { airport: 'airport', vor: 'vor', ndb: 'ndb', int: null, usr: 'user' };

/**
 * Spell-ahead completion. With a kind (WPT pages) only that kind of waypoint
 * completes; the D-> page and flight plans accept anything.
 */
export function completer(db: NavDatabase, kind: WptKind | null): (prefix: string) => string | undefined {
  if (kind === null) return (prefix) => db.complete(prefix)?.ident;
  const wanted = KIND_OF[kind];
  return (prefix) => (wanted ? db.search(prefix, 400).find((w) => w.kind === wanted)?.ident : undefined);
}

/** The waypoint an identifier names: the nearest one when several share it. */
export function findWaypoint(db: NavDatabase, ident: string, kind: WptKind | null, near: LatLon): AnyWaypoint | undefined {
  const wanted = kind === null ? null : KIND_OF[kind];
  // Intersections are not in the trainer database.
  if (kind !== null && wanted === null) return undefined;
  const all = db.find(ident).filter((w) => wanted === null || w.kind === wanted);
  if (all.length <= 1) return all[0];
  return all.reduce((best, w) => (distanceNm(near, w) < distanceNm(near, best) ? w : best));
}

export const isAirportRecord = (w: AnyWaypoint): w is Airport => w.kind === 'airport' && 'runways' in w;
export const isNavaidRecord = (w: AnyWaypoint): w is Navaid => (w.kind === 'vor' || w.kind === 'ndb') && 'freqKhz' in w;

export function airportOf(db: NavDatabase, wp: Waypoint | null): Airport | undefined {
  return wp && wp.kind === 'airport' ? db.airport(wp.ident) : undefined;
}

export function navaidOf(db: NavDatabase, wp: Waypoint | null, kind: 'vor' | 'ndb'): Navaid | undefined {
  if (!wp || wp.kind !== kind) return undefined;
  return db.find(wp.ident).find((w): w is Navaid => w.kind === kind && Math.abs(w.lat - wp.lat) < 1e-4 && Math.abs(w.lon - wp.lon) < 1e-4);
}

const activeTo = (fms: FmsState) => fms.activeLeg?.to ?? null;

/**
 * What the WPT pages show until the pilot picks something: the active
 * waypoint when it is of the right kind, then the flight plan destination
 * (airports), then the nearest one.
 */
export function defaultWaypoint(ctx: Pick<GnsCtx, 'state' | 'nearest'>, kind: 'airport' | 'vor' | 'ndb'): Waypoint | null {
  const to = activeTo(ctx.state.fms);
  if (to?.kind === kind) return to;
  if (kind === 'airport') {
    const dest = [...ctx.state.fms.plan].reverse().find((w) => w.kind === 'airport');
    if (dest) return dest;
  }
  const list = kind === 'airport' ? ctx.nearest.airports : kind === 'vor' ? ctx.nearest.vors : ctx.nearest.ndbs;
  const first = list[0];
  return first ? Db.toWaypoint(first) : null;
}

/**
 * Airports for the NAVCOM page: departure, en route and arrival airports of
 * the flight plan; with a direct-to off the plan, the nearest airport and the
 * destination.
 */
export function navcomAirports(ctx: Pick<GnsCtx, 'state' | 'nearest'>): { role: 'DEPARTURE' | 'EN ROUTE' | 'ARRIVAL'; wp: Waypoint }[] {
  const plan = ctx.state.fms.plan;
  const leg = ctx.state.fms.activeLeg;
  if (plan.length > 0 && (!leg || leg.planIndex !== null)) {
    const airports = plan.map((w, i) => ({ w, i })).filter((x) => x.w.kind === 'airport');
    return airports.map(({ w, i }) => ({
      role: i === 0 ? 'DEPARTURE' : i === plan.length - 1 ? 'ARRIVAL' : 'EN ROUTE',
      wp: w,
    }));
  }
  const out: { role: 'DEPARTURE' | 'EN ROUTE' | 'ARRIVAL'; wp: Waypoint }[] = [];
  const near = ctx.nearest.airports[0];
  if (near) out.push({ role: 'DEPARTURE', wp: Db.toWaypoint(near) });
  if (leg?.to.kind === 'airport') out.push({ role: 'ARRIVAL', wp: leg.to });
  return out;
}

/**
 * The airport, VOR or NDB under the map pointer: the closest one within
 * `toleranceNm` (a few pixels at the current scale), or undefined.
 */
export function waypointAt(db: NavDatabase, pos: LatLon, toleranceNm: number): Airport | Navaid | undefined {
  const apt = db.nearestAirports(pos, 1, {}, toleranceNm)[0];
  const nav = db.nearestNavaids(pos, 1, undefined, toleranceNm)[0];
  if (apt && nav) return apt.distanceNm <= nav.distanceNm ? apt.item : nav.item;
  return apt?.item ?? nav?.item;
}

/** City and state line for an airport ("HAGERSTOWN MD"). */
export const cityLine = (a: Airport) => [a.city, a.state].filter(Boolean).join(' ').toUpperCase();

/** The facility and city lines of the identifier windows (VORs and NDBs show their type). */
export function facilityLines(w: AnyWaypoint | undefined): { name: string; city: string } {
  if (!w) return { name: '', city: '' };
  if (isAirportRecord(w)) return { name: w.name.toUpperCase(), city: cityLine(w) };
  if (isNavaidRecord(w)) return { name: w.name.toUpperCase(), city: w.type };
  return { name: w.name.toUpperCase(), city: '' };
}
