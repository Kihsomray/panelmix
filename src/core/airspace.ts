/*
 * Class B, C and D airspace from the FAA's Class Airspace dataset (public
 * domain), simplified into public/data/airspace.json by
 * scripts/build-airspace.mjs.
 */

export type AirspaceClass = 'B' | 'C' | 'D';

export interface AirspaceVolume {
  readonly cls: AirspaceClass;
  /** "WASHINGTON CLASS B", "LEESBURG CLASS D" */
  readonly name: string;
  /** Floor and ceiling, ft MSL (surface floors are 0; AGL limits converted with the field elevation). */
  readonly lowerFt: number;
  readonly upperFt: number;
  /** Outer ring as flat [lon, lat, lon, lat, ...]. */
  readonly ring: readonly number[];
  /** Bounding box for quick rejection: [west, south, east, north]. */
  readonly bbox: readonly [number, number, number, number];
}

export interface AirspaceSource {
  readonly volumes: readonly AirspaceVolume[];
  /** Volumes whose box overlaps the given box. */
  inBox(south: number, west: number, north: number, east: number): readonly AirspaceVolume[];
  /** Volumes containing the point laterally and vertically. */
  containing(lat: number, lon: number, altitudeFt: number): readonly AirspaceVolume[];
}

export const NO_AIRSPACE: AirspaceSource = {
  volumes: [],
  inBox: () => [],
  containing: () => [],
};

/** Ray-casting point-in-polygon on a flat [lon, lat, ...] ring. */
export function ringContains(ring: readonly number[], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!;
    const yi = ring[i + 1]!;
    const xj = ring[j]!;
    const yj = ring[j + 1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
