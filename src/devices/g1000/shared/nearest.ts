import { bearing, distanceNm, type LatLon } from '../../../core/geo';
import type { Airport, AirportFrequency, FrequencyType, Navaid, NavDatabase } from '../../../core/navdb';

/*
 * Nearest-airport and nearest-navaid lists for the PFD NRST window and the
 * MFD NRST pages. The database search runs only when the airplane has moved
 * about a mile (a coarse position key, shared by both displays); bearing,
 * distance and order are recomputed from the cached candidates every frame,
 * which is cheap for 25 items.
 */

const KEY_DEG = 0.02;
const MAX_ENTRIES = 12;
const cache = new Map<string, readonly (Airport | Navaid)[]>();

function cached<T extends Airport | Navaid>(key: string, search: () => readonly T[]): readonly T[] {
  const hit = cache.get(key);
  if (hit) return hit as readonly T[];
  const items = search();
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, items);
  return items;
}

const posKey = (pos: LatLon) => `${Math.round(pos.lat / KEY_DEG)}:${Math.round(pos.lon / KEY_DEG)}`;

export interface Nearby<T> {
  readonly item: T;
  readonly distanceNm: number;
  readonly bearingTrue: number;
}

function measure<T extends LatLon>(items: readonly T[], pos: LatLon): Nearby<T>[] {
  return items
    .map((item) => ({ item, distanceNm: distanceNm(pos, item), bearingTrue: bearing(pos, item) }))
    .sort((a, b) => a.distanceNm - b.distanceNm);
}

/** The 25 nearest airports within 200 nm (the Garmin limits). */
export function nearestAirports(db: NavDatabase, pos: LatLon, count = 25): Nearby<Airport>[] {
  const items = cached(`apt:${count}:${posKey(pos)}`, () => db.nearestAirports(pos, count + 3, {}, 200).map((r) => r.item));
  return measure(items, pos).slice(0, count);
}

export function nearestNavaids(db: NavDatabase, pos: LatLon, kind: 'vor' | 'ndb', count = 25): Nearby<Navaid>[] {
  const items = cached(`${kind}:${count}:${posKey(pos)}`, () => db.nearestNavaids(pos, count + 3, kind, 200).map((r) => r.item));
  return measure(items, pos).slice(0, count);
}

/** Garmin names for the frequency types in the database. */
export const FREQ_NAMES: Record<FrequencyType, string> = {
  ATIS: 'ATIS',
  AWOS: 'AWOS',
  ASOS: 'ASOS',
  CLNC: 'CLEARANCE',
  GND: 'GROUND',
  TWR: 'TOWER',
  CTAF: 'CTAF',
  UNICOM: 'UNICOM',
  MULTI: 'MULTICOM',
  APP: 'APPROACH',
  DEP: 'DEPARTURE',
  CTR: 'CENTER',
  FSS: 'FSS',
  AFIS: 'AFIS',
  RCO: 'RCO',
};

const COM_PRIORITY: readonly FrequencyType[] = ['TWR', 'CTAF', 'UNICOM', 'MULTI', 'AFIS', 'AWOS', 'ASOS', 'ATIS', 'GND'];

/** The frequency the Nearest Airports window offers for an airport: tower, else CTAF/UNICOM... */
export function primaryCom(a: Airport): AirportFrequency | null {
  for (const type of COM_PRIORITY) {
    const f = a.frequencies.find((x) => x.type === type);
    if (f) return f;
  }
  return a.frequencies[0] ?? null;
}

export const SURFACE_NAMES: Record<Airport['runways'][number]['surface'], string> = {
  hard: 'HARD SURFACE',
  soft: 'SOFT SURFACE',
  water: 'WATER',
};
