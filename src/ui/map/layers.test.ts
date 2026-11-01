import { describe, expect, it } from 'vitest';
import type { AirspaceVolume } from '../../core/airspace';
import { createAirspaceSource } from '../../core/airspaceSource';
import { destination } from '../../core/geo';
import { NavDatabase, type Airway, type Fix, type RawNavdata } from '../../core/navdb';
import type { TerrainProvider } from '../../core/terrain';
import type { RouteLeg } from '../../sim/fms/types';
import { airspaceLabelLines, fixesInBox, LabelSpace, lowAirways } from './overlays';
import { makeProjection, MAP_STYLES, paintMap, type MapOptions } from './paintMap';
import { cellSize, screenToLatLon, tawsLevel, terrainRevision, topoColor, visibleBox } from './terrainLayer';

describe('terrain layer math', () => {
  const base = { width: 600, height: 450, db: new NavDatabase({ v: 1, built: '', airports: [], navaids: [] }), ownship: null } as const;

  it('inverts the map projection, rotated or not', () => {
    for (const upTrue of [0, 37, 215]) {
      const o: MapOptions = { ...base, center: { lat: 39.7, lon: -105.1 }, rangeNm: 20, upTrue, ownshipAt: 0.6 };
      const proj = makeProjection(o);
      const frame = { width: 600, height: 450, origin: proj.origin, ox: proj.ox, oy: proj.oy, scale: proj.scale, upTrue };
      for (const [x, y] of [[0, 0], [600, 450], [123, 401], [300, 270]] as const) {
        const back = proj.toScreen(screenToLatLon(frame, x, y));
        expect(back.x).toBeCloseTo(x, 1);
        expect(back.y).toBeCloseTo(y, 1);
      }
      const box = visibleBox(frame);
      for (const [x, y] of [[0, 0], [600, 0], [0, 450], [600, 450]] as const) {
        const p = screenToLatLon(frame, x, y);
        expect(p.lat).toBeGreaterThanOrEqual(box.south);
        expect(p.lat).toBeLessThanOrEqual(box.north);
        expect(p.lon).toBeGreaterThanOrEqual(box.west);
        expect(p.lon).toBeLessThanOrEqual(box.east);
      }
    }
  });

  it('colours terrain by height relative to the airplane like Garmin TAWS', () => {
    expect(tawsLevel(6000, 5000)).toBe('red');
    expect(tawsLevel(4900, 5000)).toBe('red');
    expect(tawsLevel(4899, 5000)).toBe('yellow');
    expect(tawsLevel(4000, 5000)).toBe('yellow');
    expect(tawsLevel(3999, 5000)).toBe('none');
  });

  it('tints low ground green and high ground brown to grey', () => {
    const [r0, g0] = topoColor(0);
    expect(g0).toBeGreaterThan(r0);
    const [r1, g1, b1] = topoColor(6000);
    expect(r1).toBeGreaterThan(g1);
    expect(g1).toBeGreaterThan(b1);
    const peak = topoColor(14000);
    expect(Math.max(...peak) - Math.min(...peak)).toBeLessThan(10);
    expect(topoColor(30000)).toEqual(peak);
    // Halfway between two stops is halfway between their colours.
    expect(topoColor(250)[1]).toBeCloseTo((topoColor(0)[1] + topoColor(500)[1]) / 2, 6);
  });

  it('keeps the raster coarse: cells of 3 to 6 px', () => {
    expect(cellSize(300, 300)).toBe(3);
    expect(cellSize(600, 450)).toBe(4);
    expect(cellSize(2000, 1500)).toBe(6);
  });

  it('counts terrain updates for repaint keys, subscribing once per provider', () => {
    const listeners: (() => void)[] = [];
    const provider: TerrainProvider = {
      elevationFt: () => null,
      sample: () => null,
      prefetch: () => {},
      subscribe: (l) => {
        listeners.push(l);
        return () => {};
      },
    };
    expect(terrainRevision(provider)).toBe(0);
    listeners.forEach((l) => l());
    expect(terrainRevision(provider)).toBe(1);
    expect(listeners).toHaveLength(1);
  });
});

describe('overlay helpers', () => {
  const fixes: Fix[] = [];
  for (let i = 0; i < 400; i++) {
    const lat = 38 + ((i * 37) % 200) / 100;
    const lon = -79 + ((i * 53) % 300) / 100;
    fixes.push({ kind: 'fix', ident: `F${i}`, name: `F${i}`, lat, lon, region: i % 3 ? 'ENRT' : 'KJYO' });
  }

  it('finds exactly the fixes inside a box', () => {
    for (const box of [
      { south: 38.2, north: 38.9, west: -78.5, east: -77.1 },
      { south: 39.95, north: 41, west: -76.2, east: -70 },
      { south: 10, north: 11, west: 10, east: 11 },
    ]) {
      const want = fixes.filter((f) => f.lat >= box.south && f.lat <= box.north && f.lon >= box.west && f.lon <= box.east);
      expect(fixesInBox(fixes, box).map((f) => f.ident).sort()).toEqual(want.map((f) => f.ident).sort());
    }
  });

  it('keeps Victor and T routes only, each with its box', () => {
    const airways: Airway[] = [
      { name: 'V4', level: 'L', fixes: [{ ident: 'A', lat: 39, lon: -78 }, { ident: 'B', lat: 39.5, lon: -77 }] },
      { name: 'T289', level: 'L', fixes: [{ ident: 'C', lat: 38, lon: -76 }, { ident: 'D', lat: 38.2, lon: -76.5 }] },
      { name: 'J6', level: 'H', fixes: [{ ident: 'E', lat: 39, lon: -78 }, { ident: 'F', lat: 40, lon: -76 }] },
      { name: 'Q80', level: 'H', fixes: [{ ident: 'G', lat: 39, lon: -78 }, { ident: 'H', lat: 40, lon: -76 }] },
    ];
    const low = lowAirways(airways);
    expect(low.map((w) => w.name)).toEqual(['V4', 'T289']);
    expect(low[1]!.bbox).toEqual([-76.5, 38, -76, 38.2]);
    expect(lowAirways(airways)).toBe(low);
  });

  it('refuses labels that would overprint one already placed', () => {
    const space = new LabelSpace();
    expect(space.claim(100, 100, 40, 12)).toBe(true);
    expect(space.claim(120, 104, 40, 12)).toBe(false);
    expect(space.claim(150, 100, 40, 12)).toBe(true);
    // Reserved space (an airport's name) is taken even where it overlaps, and blocks later labels.
    space.reserve(110, 100, 10, 10);
    expect(space.claim(110, 120, 10, 10)).toBe(true);
    expect(space.claim(112, 102, 4, 4)).toBe(false);
  });

  it('writes airspace altitudes the way charts do', () => {
    const vol = (cls: 'B' | 'C' | 'D', lowerFt: number, upperFt: number): AirspaceVolume => ({ cls, name: 'X', lowerFt, upperFt, ring: [], bbox: [0, 0, 0, 0] });
    expect(airspaceLabelLines(vol('B', 3000, 10000))).toEqual(['100', '30']);
    expect(airspaceLabelLines(vol('C', 0, 4000))).toEqual(['40', 'SFC']);
    expect(airspaceLabelLines(vol('D', 0, 2500))).toEqual(['25']);
    expect(airspaceLabelLines(vol('D', 600, 2600))).toEqual(['26', '6']);
  });
});

/** A 2D context that records what is drawn and ignores everything else. */
function recordingContext() {
  const calls: { name: string; args: unknown[]; strokeStyle: unknown; fillStyle: unknown }[] = [];
  const state: Record<string, unknown> = { strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, font: '10px sans-serif' };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
      return (...args: unknown[]) => calls.push({ name: prop, args, strokeStyle: target.strokeStyle, fillStyle: target.fillStyle });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('paintMap layers', () => {
  const raw: RawNavdata = { v: 1, built: 'test', airports: [], navaids: [] };
  const center = { lat: 39.08, lon: -77.56 };
  const db = new NavDatabase(raw, {
    fixes: [['NEARX', 39.1, -77.5, 'ENRT'], ['TERMX', 39.05, -77.6, 'KJYO'], ['FARXX', 42, -70, 'ENRT']],
    airways: [['V143', 'L', [['AAA', 38.9, -77.8], ['BBB', 39.3, -77.3]]]],
  });
  const base: MapOptions = { width: 600, height: 450, db, ownship: { ...center, headingTrue: 0 }, rangeNm: 10, upTrue: 0, style: MAP_STYLES.garmin };
  const texts = (calls: ReturnType<typeof recordingContext>['calls']) => calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);

  it('draws no optional layer unless asked', () => {
    const plain = recordingContext();
    paintMap(plain.ctx, base);
    const off = recordingContext();
    paintMap(off.ctx, { ...base, terrain: null, airspace: null, fixes: false, airways: false, approach: null });
    expect(off.calls).toEqual(plain.calls);
    expect(texts(plain.calls)).not.toContain('NEARX');
  });

  it('shows fixes in view (terminal ones close in only), and none at long range', () => {
    const near = recordingContext();
    paintMap(near.ctx, { ...base, fixes: true });
    expect(texts(near.calls)).toEqual(expect.arrayContaining(['NEARX', 'TERMX']));
    expect(texts(near.calls)).not.toContain('FARXX');
    const mid = recordingContext();
    paintMap(mid.ctx, { ...base, rangeNm: 15, fixes: true });
    expect(texts(mid.calls)).toContain('NEARX');
    expect(texts(mid.calls)).not.toContain('TERMX');
    const far = recordingContext();
    paintMap(far.ctx, { ...base, rangeNm: 40, fixes: true });
    expect(texts(far.calls)).not.toContain('NEARX');
  });

  it('names airways at short range', () => {
    const r = recordingContext();
    paintMap(r.ctx, { ...base, airways: true });
    expect(texts(r.calls)).toContain('V143');
  });

  it('draws airspace in view with its altitude label, nothing for airspace elsewhere', () => {
    const ring = [-77.7, 39.0, -77.4, 39.0, -77.4, 39.2, -77.7, 39.2, -77.7, 39.0];
    const elsewhere = [-100, 30, -99.9, 30, -99.9, 30.1, -100, 30.1, -100, 30];
    const airspace = createAirspaceSource({ v: 1, items: [['B', 'TEST CLASS B', 1500, 10000, ring], ['B', 'FAR CLASS B', 0, 10000, elsewhere]] });
    const r = recordingContext();
    paintMap(r.ctx, { ...base, airspace });
    expect(texts(r.calls)).toEqual(expect.arrayContaining(['100', '15']));
    // One boundary and the rule between the label's two numbers; the far volume is not drawn.
    expect(r.calls.filter((c) => c.name === 'stroke' && c.strokeStyle === '#3d8bff')).toHaveLength(2);
    expect(r.calls.filter((c) => c.name === 'lineTo' && (c.args[0] as number) < -1000)).toHaveLength(0);
  });

  it('asks the terrain provider for the tiles in view', () => {
    const boxes: [number, number, number, number][] = [];
    const provider: TerrainProvider = { elevationFt: () => null, sample: () => null, prefetch: (...b) => boxes.push(b), subscribe: () => () => {} };
    paintMap(recordingContext().ctx, { ...base, terrain: { provider, mode: 'relative', altitudeFt: 3000 } });
    expect(boxes).toHaveLength(1);
    const [south, west, north, east] = boxes[0]!;
    expect(south).toBeLessThan(center.lat);
    expect(north).toBeGreaterThan(center.lat);
    expect(west).toBeLessThan(center.lon);
    expect(east).toBeGreaterThan(center.lon);
    // About 10 nm above and below the airplane on a 4:3 map at 10 nm range.
    expect((north - south) * 60).toBeCloseTo(20, 0);
  });

  it('draws the active approach leg magenta in place of the route\'s straight active leg', () => {
    const fafPos = destination(center, 350, 6);
    const legs: RouteLeg[] = [
      { path: 'IF', to: { kind: 'fix', ident: 'IFFIX', name: 'IFFIX', ...destination(center, 350, 9) }, segment: 'final', label: 'IFFIX' },
      { path: 'TF', to: { kind: 'fix', ident: 'FAFIX', name: 'FAFIX', ...fafPos }, segment: 'final', label: 'FAFIX' },
      { path: 'TF', to: { kind: 'fix', ident: 'RW17', name: 'RW17', ...center }, segment: 'final', label: 'RW17' },
      { path: 'CA', to: null, courseTrue: 170, altitude: { kind: 'atOrAbove', ft: 1000 }, segment: 'missed', label: '1000ft' },
    ];
    const activeLeg = { from: legs[1]!.to!, to: legs[2]!.to!, planIndex: null, isDirectTo: false, approachIndex: 2 };
    const r = recordingContext();
    paintMap(r.ctx, { ...base, route: { plan: [], activeLeg }, approach: { legs, activeIndex: 2 } });
    const magenta = r.calls.filter((c) => c.name === 'stroke' && c.strokeStyle === MAP_STYLES.garmin.routeActive);
    expect(magenta).toHaveLength(1);
    // The missed approach is dashed until it is flown.
    const dashes = r.calls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0]);
    expect(dashes).toContainEqual([8, 6]);
    expect(texts(r.calls)).toEqual(expect.arrayContaining(['IFFIX', 'FAFIX', 'RW17']));
  });
});
