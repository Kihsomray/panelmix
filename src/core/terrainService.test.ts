import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tileName } from './terrain';
import { createTerrainService, decodePng, decodeTerrainPixels, gridSample, TILE_SAMPLES, type TerrainGrid } from './terrainService';

/** The build script's PNG writer and water rules, loaded at run time (it is plain JavaScript). */
interface TerrainScript {
  encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array;
  decodePng(buf: Uint8Array): { width: number; height: number; channels: number; data: Uint8Array };
  encodeTileRgb(feet: ArrayLike<number>, water: ArrayLike<number>): Uint8Array;
  classifyWater(mosaic: { w: number; h: number; m: Float32Array }, inBasin?: boolean): { mask: Uint8Array; level: Float32Array };
  tileName(lat: number, lon: number): string;
}
const SCRIPT_PATH = '../../scripts/build-terrain.mjs';
const script = (await import(/* @vite-ignore */ SCRIPT_PATH)) as TerrainScript;

const PUBLIC = path.resolve(__dirname, '../../public');
const readPublic = async (p: string) => new Uint8Array(await readFile(path.join(PUBLIC, p)));

/** A synthetic tile: a plane rising 10 ft per sample east and north, water in the north-west quarter. */
function syntheticGrid(): { feet: number[]; water: number[] } {
  const feet: number[] = [];
  const water: number[] = [];
  for (let r = 0; r < TILE_SAMPLES; r++) {
    for (let c = 0; c < TILE_SAMPLES; c++) {
      feet.push(10 * c + 10 * (TILE_SAMPLES - 1 - r));
      water.push(r < 60 && c < 60 ? 1 : 0);
    }
  }
  return { feet, water };
}

describe('terrain tile format', () => {
  it('round-trips a tile through the build script PNG writer and the runtime decoder', async () => {
    const { feet, water } = syntheticGrid();
    const png = script.encodePng(TILE_SAMPLES, TILE_SAMPLES, script.encodeTileRgb(feet, water));
    const img = await decodePng(png);
    expect([img.width, img.height, img.channels]).toEqual([TILE_SAMPLES, TILE_SAMPLES, 3]);
    const grid = decodeTerrainPixels(39, -78, img);
    expect(Array.from(grid.feet)).toEqual(feet);
    expect(Array.from(grid.water!)).toEqual(water);
    // The script's own reader agrees byte for byte.
    expect(Buffer.from(script.decodePng(Buffer.from(png)).data)).toEqual(Buffer.from(img.data));
  });

  it('encodes elevation as feet + 1000 in R and G, water in B', () => {
    const rgb = script.encodeTileRgb([-282, 0, 14115], [0, 1, 0]);
    expect(Array.from(rgb)).toEqual([2, 206, 0, 3, 232, 1, 59, 11, 0]);
  });

  it('names tiles after the south-west corner like terrain.ts', () => {
    for (const [lat, lon] of [[39, -78], [-1, 5], [0, -1], [21, -158]] as const) {
      expect(script.tileName(lat, lon)).toBe(tileName(lat + 0.5, lon + 0.5));
    }
    expect(tileName(39.99, -77.01)).toBe('N39W078');
  });
});

describe('grid interpolation', () => {
  const { feet, water } = syntheticGrid();
  const grid: TerrainGrid = { lat: 39, lon: -78, size: TILE_SAMPLES, feet: Int16Array.from(feet), water: Uint8Array.from(water) };

  it('returns the samples at grid points, corners and edges included', () => {
    // Row 0 is the north edge: elevation there is 10 * 120 + 10 * column.
    expect(gridSample(grid, 40, -78).elevationFt).toBeCloseTo(1200);
    expect(gridSample(grid, 39, -78).elevationFt).toBeCloseTo(0);
    expect(gridSample(grid, 39, -77).elevationFt).toBeCloseTo(1200);
    expect(gridSample(grid, 40, -77).elevationFt).toBeCloseTo(2400);
    expect(gridSample(grid, 39.5, -77.5).elevationFt).toBeCloseTo(1200);
  });

  it('interpolates bilinearly between samples', () => {
    // A plane is reproduced exactly, between samples too.
    const lat = 39 + 37.3 / 120;
    const lon = -78 + 81.6 / 120;
    expect(gridSample(grid, lat, lon).elevationFt).toBeCloseTo(10 * 37.3 + 10 * 81.6, 6);
    // A single raised sample spreads linearly to its neighbours.
    const bump: TerrainGrid = { ...grid, feet: new Int16Array(TILE_SAMPLES * TILE_SAMPLES), water: null };
    bump.feet[60 * TILE_SAMPLES + 60] = 1000;
    expect(gridSample(bump, 39.5, -77.5).elevationFt).toBeCloseTo(1000);
    expect(gridSample(bump, 39.5, -77.5 + 0.25 / 120).elevationFt).toBeCloseTo(750);
    expect(gridSample(bump, 39.5 + 0.5 / 120, -77.5 + 0.5 / 120).elevationFt).toBeCloseTo(250);
  });

  it('takes water from the nearest sample', () => {
    expect(gridSample(grid, 39.9, -77.9).water).toBe(true);
    expect(gridSample(grid, 39.1, -77.1).water).toBe(false);
    expect(gridSample({ ...grid, water: null }, 39.9, -77.9).water).toBe(false);
  });
});

describe('water rules of the build', () => {
  const SEA = 1;
  const LAKE = 2;
  /** Columns of terrain types side by side, 20 rows. */
  function mosaic(columns: ((x: number, y: number) => number)[], width = 10) {
    const w = columns.length * width;
    const h = 20;
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = columns[Math.floor(x / width)]!(x, y);
    return { w, h, m };
  }
  const bathymetry = (x: number) => -12.37 - (x % 10) * 0.11;
  const hills = (x: number, y: number) => 150 + ((x * 7 + y * 13) % 5);

  it('makes bathymetry and anything deeper than the lowest land sea, and flat surfaces lakes', () => {
    // Shelf sea floor stored in whole meters, as on the Florida shelf and Georges Bank.
    const shelf = (x: number, y: number) => -60 - ((x + y) % 4);
    const mos = mosaic([bathymetry, hills, () => 1282, shelf]);
    const { mask, level } = script.classifyWater(mos);
    const at = (x: number) => ({ mask: mask[10 * mos.w + x], level: level[10 * mos.w + x] });
    expect(at(4)).toEqual({ mask: SEA, level: 0 });
    expect(at(15)).toEqual({ mask: 0, level: hills(15, 10) });
    expect(at(25)).toEqual({ mask: LAKE, level: 1282 });
    expect(at(21).mask).toBe(LAKE);
    expect(at(35)).toEqual({ mask: SEA, level: 0 });
  });

  it('in the basins, keeps land below sea level and a lake with bathymetry at its shore level (the Salton Sea)', () => {
    const shore = (x: number, y: number) => -70 - ((x * 3 + y) % 3);
    const lake = (x: number, y: number) => (y > 4 && y < 15 ? -75.3 - (x % 10) * 0.21 : shore(x, y));
    const { mask, level } = script.classifyWater(mosaic([shore, lake, shore]), true);
    expect(mask[10 * 30 + 15]).toBe(LAKE);
    expect(level[10 * 30 + 15]).toBeGreaterThanOrEqual(-72);
    expect(level[10 * 30 + 15]).toBeLessThanOrEqual(-70);
    expect(mask[10 * 30 + 5]).toBe(0);
    expect(level[10 * 30 + 5]).toBe(shore(5, 10));
  });
});

describe('terrain service', () => {
  const load = (p: string) => readPublic(p);

  it('answers no data before the index arrives and for areas outside the regions', async () => {
    const t = createTerrainService('/', { load });
    expect(t.elevationFt(39.078, -77.5575)).toBeNull();
    await t.load(39, -78);
    expect(t.sample(10, -100)).toBeNull();
    expect(t.elevationFt(45, -150)).toBeNull();
  });

  it('treats a missing tile inside a region as open sea', async () => {
    const t = createTerrainService('/', { load });
    await t.load(0, 0);
    // The Atlantic east of Delaware Bay and the Gulf of Mexico.
    expect(t.sample(37.5, -71.5)).toEqual({ elevationFt: 0, water: true });
    expect(t.sample(26.5, -91.5)).toEqual({ elevationFt: 0, water: true });
  });

  it('knows real elevations', async () => {
    const t = createTerrainService('/', { load });
    const at = async (lat: number, lon: number) => {
      await t.load(lat, lon);
      return t.sample(lat, lon)!;
    };
    // Leesburg Executive (KJYO) 389 ft. Denver International's 5,434 ft is its highest runway
    // point; the field slopes about 100 ft, and the reference point sits lower.
    expect((await at(39.078, -77.5575)).elevationFt).toBeGreaterThan(330);
    expect((await at(39.078, -77.5575)).elevationFt).toBeLessThan(450);
    expect(Math.abs((await at(39.8617, -104.6731)).elevationFt - 5434)).toBeLessThan(100);
    // Pikes Peak (14,115 ft) at 30 arc seconds is lower than the summit, but well above its flanks.
    expect((await at(38.8405, -105.0442)).elevationFt).toBeGreaterThan(13000);
    // The Badwater Basin salt pan, Death Valley (-282 ft at its lowest): land below sea level, not water.
    const badwater = await at(36.25, -116.8167);
    expect(badwater.elevationFt).toBeLessThan(-250);
    expect(badwater.water).toBe(false);
    // The Salton Sea is a lake 230 ft below sea level; Lake Michigan's surface is about 580 ft.
    const salton = await at(33.3, -115.85);
    expect(salton.water).toBe(true);
    expect(Math.abs(salton.elevationFt - -233)).toBeLessThan(30);
    const michigan = await at(43.5, -87.0);
    expect(michigan.water).toBe(true);
    expect(Math.abs(michigan.elevationFt - 577)).toBeLessThan(20);
    // Chesapeake Bay: sea surface.
    expect(await at(38.6, -76.4)).toEqual({ elevationFt: 0, water: true });
  });

  it('loads what a query or a prefetch asks for and notifies once per burst of tiles', async () => {
    const t = createTerrainService('/', { load });
    await t.load(0, 0);
    let calls = 0;
    const off = t.subscribe(() => calls++);
    // A query for a tile not loaded yet answers null and starts loading it.
    expect(t.elevationFt(39.5, -104.5)).toBeNull();
    t.prefetch(38.2, -105.8, 39.8, -104.2);
    await new Promise((r) => setTimeout(r, 500));
    expect(t.elevationFt(39.5, -104.5)).not.toBeNull();
    expect(t.elevationFt(38.5, -105.5)).not.toBeNull();
    expect(t.revision).toBe(5);
    // Four tiles arrived close together: listeners hear about them once or twice, not four times.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
    off();
  });

  it('keeps only `maxTiles` decoded, dropping the least recently used', async () => {
    const t = createTerrainService('/', { load, maxTiles: 2 });
    await t.load(39.5, -104.5);
    await t.load(39.5, -105.5);
    expect(t.elevationFt(39.5, -104.5)).not.toBeNull();
    await t.load(38.5, -105.5);
    expect(t.elevationFt(39.5, -104.5)).not.toBeNull();
    expect(t.elevationFt(38.5, -105.5)).not.toBeNull();
    // N39W106 was used longest ago, so it went; asking for it again reloads it.
    expect(t.elevationFt(39.5, -105.5)).toBeNull();
    await t.load(39.5, -105.5);
    expect(t.elevationFt(39.5, -105.5)).not.toBeNull();
  });
});

describe('generated terrain', () => {
  it('lists every tile it ships, and the tiles decode to 121 x 121 samples', async () => {
    const index = JSON.parse(new TextDecoder().decode(await readPublic('terrain/index.json'))) as { tiles: string[]; regions: number[][] };
    expect(index.tiles.length).toBeGreaterThan(1000);
    expect(index.regions[0]).toEqual([22, -128, 51, -64]);
    for (const name of ['N39W078', 'N38W106', 'N21W158', 'N58W135']) {
      expect(index.tiles).toContain(name);
      const img = await decodePng(await readPublic(`terrain/${name}.png`));
      expect([img.width, img.height]).toEqual([TILE_SAMPLES, TILE_SAMPLES]);
    }
  });
});
