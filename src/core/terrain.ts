/*
 * Terrain elevation for the flight model floor, TAWS-style alerting and the
 * terrain / topo map layers.
 *
 * Tiles (built by scripts/build-terrain.mjs) cover 1 x 1 degree at 30 arc
 * seconds: 121 x 121 samples including both edges, as RGB PNGs at
 * public/terrain/{N|S}{lat:2}{E|W}{lon:3}.png named after the south-west
 * corner (N39W078.png covers 39..40 N, 78..77 W). Elevation in feet is
 * R * 256 + G - 1000; B is 1 over water. public/terrain/index.json lists the
 * tiles that exist, so ocean areas are never requested.
 */

export interface TerrainSample {
  readonly elevationFt: number;
  readonly water: boolean;
}

export interface TerrainProvider {
  /**
   * Elevation at a point, interpolated between samples. Null when the tile
   * is not loaded yet (the call starts loading it) or there is no data.
   */
  elevationFt(lat: number, lon: number): number | null;
  sample(lat: number, lon: number): TerrainSample | null;
  /** Starts loading the tiles that cover a box, for maps about to be drawn. */
  prefetch(south: number, west: number, north: number, east: number): void;
  /** Calls `listener` whenever a tile finishes loading. */
  subscribe(listener: () => void): () => void;
}

/** A provider with no data, for tests and before terrain is available. */
export const NO_TERRAIN: TerrainProvider = {
  elevationFt: () => null,
  sample: () => null,
  prefetch: () => {},
  subscribe: () => () => {},
};

export function tileName(lat: number, lon: number): string {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const ns = la >= 0 ? 'N' : 'S';
  const ew = lo >= 0 ? 'E' : 'W';
  return `${ns}${String(Math.abs(la)).padStart(2, '0')}${ew}${String(Math.abs(lo)).padStart(3, '0')}`;
}
