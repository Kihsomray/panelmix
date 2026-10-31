import { C172_SPEEDS } from '../../ui/instruments/palette';

/*
 * Pilot options the Aspen keeps in its menu (Pilot's Guide chapter 5).
 * Values persist for the session; the menu pages edit them.
 */

export type MapFeature = 'fpl' | 'apt' | 'vor' | 'ndb';

export interface MapSettings {
  /** 0 hides the basemap; 4 shows everything (the default). */
  readonly declutter: number;
  /** Feature groups: AUTO shows them by range, OFF never. */
  readonly show: Readonly<Record<MapFeature, boolean>>;
}

export interface VSpeeds {
  readonly enabled: boolean;
  readonly vx: number;
  readonly va: number;
  readonly vy: number;
  readonly vbg: number;
  readonly vlo: number;
  readonly vref: number;
  readonly vle: number;
  readonly vr: number;
}

export interface AspenSettings {
  /** Airspeed and altitude tapes shown (installations that keep the analog ASI and altimeter). */
  readonly tapes: boolean;
  /** Auto Course Select: CRS follows the GPS desired track. */
  readonly autoCrs: boolean;
  /** ARC compass format: full HSI or a CDI along the bottom. */
  readonly arcMode: 'HSI' | 'CDI';
  readonly baroUnits: 'IN' | 'MB';
  readonly oatUnits: 'C' | 'F';
  readonly autoRange: boolean;
  readonly map360: MapSettings;
  readonly mapArc: MapSettings;
  readonly vspeeds: VSpeeds;
}

const MAP_DEFAULT: MapSettings = { declutter: 4, show: { fpl: true, apt: true, vor: true, ndb: true } };

/** Factory defaults with Cessna 172S V-speeds; zero removes a marker (fixed gear has no Vlo or Vle). */
export const DEFAULT_SETTINGS: AspenSettings = {
  tapes: true,
  autoCrs: true,
  arcMode: 'HSI',
  baroUnits: 'IN',
  oatUnits: 'C',
  autoRange: false,
  map360: MAP_DEFAULT,
  mapArc: MAP_DEFAULT,
  vspeeds: {
    enabled: true,
    vx: C172_SPEEDS.vx,
    va: 105,
    vy: C172_SPEEDS.vy,
    vbg: C172_SPEEDS.vg,
    vlo: 0,
    vref: 65,
    vle: 0,
    vr: C172_SPEEDS.vr,
  },
};

/** Map ranges, nm from the ownship to the edge of the compass scale. */
export const RANGES_NM = [2, 3, 5, 10, 15, 20, 30, 40, 60, 80, 100, 200] as const;
export const DEFAULT_RANGE_NM = 15;

export function stepRange(current: number, dir: number): number {
  const i = Math.max(RANGES_NM.findIndex((r) => r >= current), 0);
  return RANGES_NM[Math.min(Math.max(i + dir, 0), RANGES_NM.length - 1)]!;
}

/** Auto Range: the smallest range that keeps the active waypoint on the display. */
export function autoRangeFor(distanceNm: number | null, fallback: number): number {
  if (distanceNm === null) return fallback;
  return RANGES_NM.find((r) => r >= distanceNm) ?? RANGES_NM[RANGES_NM.length - 1]!;
}

export const INHG_PER_MB = 1 / 33.8639;
