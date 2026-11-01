import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_AIRSPACE, ringContains } from './airspace';
import { airspaceLabel, createAirspaceSource, ringParts, type RawAirspace, type RawAirspaceItem } from './airspaceSource';

/** A closed square ring, flat [lon, lat, ...], counter-clockwise. */
function square(west: number, south: number, size: number): number[] {
  return [west, south, west + size, south, west + size, south + size, west, south + size, west, south];
}

describe('airspace source (synthetic)', () => {
  // A Class C shelf with a hole over the airport, the surface core filling the hole, and a Class D next door.
  const shelf: RawAirspaceItem = ['C', 'TEST CLASS C', 1200, 4000, [...square(-78, 39, 1), ...square(-77.75, 39.25, 0.5)]];
  const core: RawAirspaceItem = ['C', 'TEST CLASS C', 0, 4000, square(-77.75, 39.25, 0.5), [-77.6, 39.6]];
  const delta: RawAirspaceItem = ['D', 'OTHER CLASS D', 0, 2500, square(-76.5, 39.2, 0.2)];
  const raw: RawAirspace = { v: 1, items: [shelf, core, delta] };
  const src = createAirspaceSource(raw);

  it('builds volumes with bounding boxes', () => {
    expect(src.volumes).toHaveLength(3);
    expect(src.volumes[0]!.bbox).toEqual([-78, 39, -77, 40]);
    expect(src.volumes[2]!.bbox[0]).toBeCloseTo(-76.5);
    expect(src.volumes[2]!.bbox[3]).toBeCloseTo(39.4);
  });

  it('finds volumes whose box overlaps a query box, once each, in data order', () => {
    expect(src.inBox(39.1, -77.9, 39.2, -77.8).map((v) => v.name)).toEqual(['TEST CLASS C']);
    expect(src.inBox(38, -79, 41, -75)).toHaveLength(3);
    expect(src.inBox(30, -100, 31, -99)).toHaveLength(0);
    // A box spanning many grid cells (the whole shelf) still reports the shelf once.
    expect(src.inBox(39.01, -77.99, 39.99, -77.01).filter((v) => v.lowerFt === 1200)).toHaveLength(1);
    // A box larger than the data takes the scan path and agrees.
    expect(src.inBox(-80, -170, 80, 170)).toHaveLength(3);
  });

  it('answers point-in-volume queries with floors, ceilings and holes', () => {
    // Under the shelf: below its floor, inside it, above its ceiling.
    expect(src.containing(39.1, -77.9, 1000)).toHaveLength(0);
    expect(src.containing(39.1, -77.9, 1200).map((v) => v.lowerFt)).toEqual([1200]);
    expect(src.containing(39.1, -77.9, 4000)).toHaveLength(1);
    expect(src.containing(39.1, -77.9, 4001)).toHaveLength(0);
    // Over the airport the shelf has a hole: only the core.
    expect(src.containing(39.5, -77.5, 2000).map((v) => v.lowerFt)).toEqual([0]);
    expect(src.containing(39.3, -76.4, 2500).map((v) => v.cls)).toEqual(['D']);
    expect(src.containing(39.3, -76.4, 2600)).toHaveLength(0);
  });

  it('lists nested volumes innermost (smallest) first', () => {
    const nested = createAirspaceSource({
      v: 1,
      items: [
        ['B', 'BIG', 0, 10000, square(-78, 39, 2)],
        ['D', 'SMALL', 0, 2500, square(-77.2, 39.8, 0.3)],
      ],
    });
    expect(nested.containing(39.9, -77.1, 2000).map((v) => v.name)).toEqual(['SMALL', 'BIG']);
  });

  it('splits rings into the outer boundary and its holes', () => {
    expect(ringParts(shelf[4])).toEqual([
      [0, 10],
      [10, 20],
    ]);
    expect(ringParts(delta[4])).toEqual([[0, 10]]);
    // The even-odd rule in airspace.ts handles the hole without knowing about it.
    expect(ringContains(shelf[4], 39.5, -77.5)).toBe(false);
    expect(ringContains(shelf[4], 39.1, -77.9)).toBe(true);
  });

  it('uses the label position from the data, else the middle of the box', () => {
    const [shelfVol, coreVol] = src.volumes;
    expect(airspaceLabel(coreVol!)).toEqual([-77.6, 39.6]);
    expect(airspaceLabel(shelfVol!)).toEqual([-77.5, 39.5]);
  });

  it('is empty without data', () => {
    expect(createAirspaceSource(null)).toBe(NO_AIRSPACE);
    expect(createAirspaceSource({ v: 1, items: [] })).toBe(NO_AIRSPACE);
  });
});

describe('generated airspace.json', () => {
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, '../../public/data/airspace.json'), 'utf8')) as RawAirspace;
  const src = createAirspaceSource(raw);
  const names = (lat: number, lon: number, alt: number) => src.containing(lat, lon, alt).map((v) => `${v.name} ${v.lowerFt}-${v.upperFt}`);

  it('holds US Class B, C and D with closed rings and labels inside them', () => {
    const counts = { B: 0, C: 0, D: 0 };
    for (const v of src.volumes) counts[v.cls]++;
    expect(counts.B).toBeGreaterThan(300);
    expect(counts.C).toBeGreaterThan(300);
    expect(counts.D).toBeGreaterThan(500);
    for (const v of src.volumes) {
      for (const [start, end] of ringParts(v.ring)) {
        expect(v.ring[start]).toBe(v.ring[end - 2]);
        expect(v.ring[start + 1]).toBe(v.ring[end - 1]);
      }
      expect(v.upperFt).toBeGreaterThan(v.lowerFt);
      const [lon, lat] = airspaceLabel(v);
      expect(ringContains(v.ring, lat, lon)).toBe(true);
    }
  });

  it('puts Reagan National and Dulles in the Washington Class B, and Leesburg under its 1,500 ft shelf', () => {
    expect(names(38.8521, -77.0377, 500)).toEqual(['WASHINGTON-TRI AREA CLASS B 0-10000']);
    expect(names(38.9445, -77.4558, 800)).toEqual(['WASHINGTON-TRI AREA CLASS B 0-10000']);
    expect(names(39.078, -77.5575, 1000)).toEqual([]);
    expect(names(39.078, -77.5575, 1500)).toEqual(['WASHINGTON-TRI AREA CLASS B 1500-10000']);
    expect(names(39.078, -77.5575, 10500)).toEqual([]);
  });

  it('knows the Class D towers around Leesburg', () => {
    expect(names(39.4176, -77.3743, 1500)).toEqual(['FREDERICK CLASS D 0-2800']);
    expect(names(38.7214, -77.5154, 1500)).toEqual(['MANASSAS CLASS D 0-2000']);
    expect(names(39.4019, -77.9846, 1500)).toEqual(['MARTINSBURG CLASS D 0-3100']);
  });

  it('keeps the holes of the Kansas City Class B shelves', () => {
    // Over the airport at 2,500 ft only the surface area applies; the 2,400 ft shelf around it has a hole there.
    expect(names(39.3017, -94.71389, 2500)).toEqual(['KANSAS CITY CLASS B 0-8000']);
    expect(names(39.3017, -94.95, 3500)).toEqual(['KANSAS CITY CLASS B 3000-8000']);
  });
});
