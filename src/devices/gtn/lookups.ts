import { useMemo } from 'preact/hooks';
import { bearing, distanceNm, type LatLon } from '../../core/geo';
import type { Airport, AirportFrequency, AnyWaypoint, Navaid, NavDatabase, NearestResult, Waypoint } from '../../core/navdb';
import type { RadioBand } from './keypad';

/*
 * Database queries the GTN pages need, kept off the per-frame path: nearest
 * lists are recomputed only when the airplane has moved about a mile (the real
 * unit refreshes them every 30 seconds), and bearings and distances are then
 * refreshed live from the cached set.
 */

/** Grid size for re-running nearest queries, degrees (about 1.2 nm). */
const NEAREST_GRID_DEG = 0.02;
const NEAREST_COUNT = 25;
const NEAREST_RADIUS_NM = 200;

export interface NearestLists {
  readonly airports: readonly Airport[];
  readonly vors: readonly Navaid[];
  readonly ndbs: readonly Navaid[];
}

const items = <T,>(r: readonly NearestResult<T>[]) => r.map((x) => x.item);

export function useNearestLists(db: NavDatabase, pos: LatLon): NearestLists {
  const ky = Math.round(pos.lat / NEAREST_GRID_DEG);
  const kx = Math.round(pos.lon / NEAREST_GRID_DEG);
  return useMemo(() => {
    const at = { lat: ky * NEAREST_GRID_DEG, lon: kx * NEAREST_GRID_DEG };
    return {
      airports: items(db.nearestAirports(at, NEAREST_COUNT, {}, NEAREST_RADIUS_NM)),
      vors: items(db.nearestNavaids(at, NEAREST_COUNT, 'vor', NEAREST_RADIUS_NM)),
      ndbs: items(db.nearestNavaids(at, NEAREST_COUNT, 'ndb', NEAREST_RADIUS_NM)),
    };
  }, [db, ky, kx]);
}

export interface Ranged<T> {
  readonly item: T;
  readonly distanceNm: number;
  readonly bearingTrue: number;
}

/** Live distance and bearing from the airplane, closest first. */
export function ranged<T extends LatLon>(list: readonly T[], pos: LatLon): Ranged<T>[] {
  return list
    .map((item) => ({ item, distanceNm: distanceNm(pos, item), bearingTrue: bearing(pos, item) }))
    .sort((a, b) => a.distanceNm - b.distanceNm);
}

/** Frequency types a pilot most often wants from a nearest-airport line. */
const PREFERRED: readonly AirportFrequency['type'][] = ['TWR', 'CTAF', 'UNICOM', 'MULTI', 'AWOS', 'ASOS', 'ATIS', 'GND'];

export function primaryFrequency(a: Airport): AirportFrequency | null {
  for (const t of PREFERRED) {
    const f = a.frequencies.find((x) => x.type === t);
    if (f) return f;
  }
  return a.frequencies[0] ?? null;
}

/** Only frequencies a VHF COM can tune. */
export function comFrequencies(a: Airport): AirportFrequency[] {
  return a.frequencies.filter((f) => f.khz >= 118000 && f.khz <= 136975);
}

/**
 * Reverse frequency look-up for the radio windows ("KJYO CTAF", "MRB VOR"):
 * the nearest facility using the frequency. "+" marks more than one use.
 */
export function frequencyLookup(band: RadioBand, khz: number, lists: NearestLists): string {
  if (band === 'nav') {
    const v = lists.vors.find((n) => n.freqKhz === khz);
    return v ? `${v.ident} VOR` : '';
  }
  for (const a of lists.airports) {
    const uses = a.frequencies.filter((f) => f.khz === khz);
    if (uses.length > 0) return `${a.ident} ${uses[0]!.type}${uses.length > 1 ? '+' : ''}`;
  }
  return '';
}

/** Memoised per frequency and nearest set, so the radio bar does no work per frame. */
export function useFrequencyLookup(band: RadioBand, khz: number, lists: NearestLists): string {
  return useMemo(() => frequencyLookup(band, khz, lists), [band, khz, lists]);
}

/** The database record behind a plan waypoint (plans store plain waypoints). */
export function recordOf(db: NavDatabase, w: Waypoint): AnyWaypoint | undefined {
  return db.find(w.ident).find((r) => r.kind === w.kind && Math.abs(r.lat - w.lat) < 0.01 && Math.abs(r.lon - w.lon) < 0.01) ?? db.get(w.ident, w);
}

export function isAirport(w: AnyWaypoint | undefined): w is Airport {
  return w?.kind === 'airport';
}

export function isNavaid(w: AnyWaypoint | undefined): w is Navaid {
  return w?.kind === 'vor' || w?.kind === 'ndb';
}
