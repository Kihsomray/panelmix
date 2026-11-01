import { NO_AIRSPACE, ringContains, type AirspaceClass, type AirspaceSource, type AirspaceVolume } from './airspace';

/*
 * public/data/airspace.json, written by scripts/build-airspace.mjs:
 *
 *   { v: 1, effective: "2026-10-29", items: [[cls, name, lowerFt, upperFt, ring, label], ...] }
 *
 * - `ring` is a flat [lon, lat, ...] array: the outer boundary, closed (its
 *   first point repeated at the end), then any holes, each closed the same
 *   way. `ringContains` (even-odd) handles the holes as they are; drawing code
 *   starts a new sub-path after each closing point (`ringParts`).
 * - `label` is [lon, lat] where the altitude label goes: inside the volume,
 *   clear of its airport and of the smaller volumes of the same airspace.
 * - Items come largest first within each class (B, C, D), so drawing them in
 *   order puts small volumes and their labels on top.
 */
export type RawAirspaceItem = [string, string, number, number, number[], [number, number]?];

export interface RawAirspace {
  readonly v: 1;
  /** First day of the FAA cycle the data comes from (YYYY-MM-DD). */
  readonly effective?: string | null;
  readonly items: readonly RawAirspaceItem[];
}

/** The volumes `createAirspaceSource` makes carry a label position too. */
export interface LabeledAirspaceVolume extends AirspaceVolume {
  /** Where the altitude label goes, [lon, lat]. */
  readonly label: readonly [number, number];
}

/** A volume's label position: the one from the data, or the middle of its box. */
export function airspaceLabel(v: AirspaceVolume): readonly [number, number] {
  if ('label' in v) return (v as LabeledAirspaceVolume).label;
  return [(v.bbox[0] + v.bbox[2]) / 2, (v.bbox[1] + v.bbox[3]) / 2];
}

/** The closed rings in a volume's ring array (the outer boundary first, then holes), as [start, end) index pairs. */
export function ringParts(ring: readonly number[]): [number, number][] {
  const parts: [number, number][] = [];
  let start = 0;
  for (let i = 2; i < ring.length; i += 2) {
    if (i - start >= 6 && ring[i] === ring[start] && ring[i + 1] === ring[start + 1]) {
      parts.push([start, i + 2]);
      start = i + 2;
      i += 2;
    }
  }
  if (start < ring.length) parts.push([start, ring.length]);
  return parts;
}

const CLASSES: readonly AirspaceClass[] = ['B', 'C', 'D'];
/** Grid cell size for the spatial index, degrees. */
const CELL_DEG = 0.5;

const cellKey = (ilat: number, ilon: number) => (ilat + 200) * 1000 + (ilon + 400);

function bboxOf(ring: readonly number[]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const lon = ring[i]!;
    const lat = ring[i + 1]!;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

/** Shoelace area, square degrees: only used to order nested volumes. */
function areaOf(ring: readonly number[]): number {
  let a = 0;
  for (let i = 2; i < ring.length; i += 2) a += ring[i - 2]! * ring[i + 1]! - ring[i]! * ring[i - 1]!;
  return Math.abs(a / 2);
}

/** Builds the airspace query structure: volumes in a 0.5-degree grid of their bounding boxes. */
export function createAirspaceSource(raw: RawAirspace | null): AirspaceSource {
  if (!raw || raw.v !== 1 || raw.items.length === 0) return NO_AIRSPACE;
  const volumes: LabeledAirspaceVolume[] = [];
  for (const [cls, name, lowerFt, upperFt, ring, label] of raw.items) {
    if (!CLASSES.includes(cls as AirspaceClass) || ring.length < 8) continue;
    const bbox = bboxOf(ring);
    volumes.push({
      cls: cls as AirspaceClass,
      name,
      lowerFt,
      upperFt,
      ring,
      bbox,
      label: label ?? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    });
  }
  const areas = volumes.map((v) => areaOf(v.ring));
  const grid = new Map<number, number[]>();
  volumes.forEach((v, index) => {
    const [west, south, east, north] = v.bbox;
    for (let la = Math.floor(south / CELL_DEG); la <= Math.floor(north / CELL_DEG); la++) {
      for (let lo = Math.floor(west / CELL_DEG); lo <= Math.floor(east / CELL_DEG); lo++) {
        const key = cellKey(la, lo);
        const list = grid.get(key);
        if (list) list.push(index);
        else grid.set(key, [index]);
      }
    }
  });
  // Query stamps: a volume found in several cells is reported once.
  const seen = new Uint32Array(volumes.length);
  let stamp = 0;

  const overlaps = (v: AirspaceVolume, south: number, west: number, north: number, east: number) =>
    v.bbox[3] >= south && v.bbox[1] <= north && v.bbox[2] >= west && v.bbox[0] <= east;

  return {
    volumes,
    inBox(south, west, north, east) {
      const rows = Math.floor(north / CELL_DEG) - Math.floor(south / CELL_DEG) + 1;
      const cols = Math.floor(east / CELL_DEG) - Math.floor(west / CELL_DEG) + 1;
      // A box bigger than the data is quicker to answer by scanning everything.
      if (rows * cols > volumes.length) return volumes.filter((v) => overlaps(v, south, west, north, east));
      stamp++;
      const found: number[] = [];
      for (let la = Math.floor(south / CELL_DEG); la <= Math.floor(north / CELL_DEG); la++) {
        for (let lo = Math.floor(west / CELL_DEG); lo <= Math.floor(east / CELL_DEG); lo++) {
          for (const i of grid.get(cellKey(la, lo)) ?? []) {
            if (seen[i] === stamp) continue;
            seen[i] = stamp;
            if (overlaps(volumes[i]!, south, west, north, east)) found.push(i);
          }
        }
      }
      // Data order (largest first per class) is the drawing order.
      return found.sort((a, b) => a - b).map((i) => volumes[i]!);
    },
    containing(lat, lon, altitudeFt) {
      const cell = grid.get(cellKey(Math.floor(lat / CELL_DEG), Math.floor(lon / CELL_DEG)));
      if (!cell) return [];
      const hits = cell.filter((i) => {
        const v = volumes[i]!;
        return (
          altitudeFt >= v.lowerFt &&
          altitudeFt <= v.upperFt &&
          lon >= v.bbox[0] &&
          lon <= v.bbox[2] &&
          lat >= v.bbox[1] &&
          lat <= v.bbox[3] &&
          ringContains(v.ring, lat, lon)
        );
      });
      // Innermost (smallest) first.
      return hits.sort((a, b) => areas[a]! - areas[b]!).map((i) => volumes[i]!);
    },
  };
}
