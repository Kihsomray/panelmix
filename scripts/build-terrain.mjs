#!/usr/bin/env node
/*
 * Builds the terrain tiles described in src/core/terrain.ts into public/terrain/.
 *
 *   node scripts/build-terrain.mjs [--only N39W106,N38W106] [--concurrency 8]
 *
 * Source: AWS Terrain Tiles (Mapzen terrarium PNGs, public dataset on the AWS
 * Registry of Open Data; US land from USGS 3DEP/SRTM, oceans from ETOPO1),
 * elevation meters = R * 256 + G + B / 256 - 32768, Web Mercator 256 px tiles.
 * They are fetched at build time (the bucket sends no CORS headers, so the
 * browser could not read them) and cached in .cache/terrain-src/.
 *
 * Output: one RGB PNG per 1 x 1 degree, 121 x 121 samples at 30 arc seconds
 * including both edges, row 0 at the north edge and column 0 at the west edge.
 * Feet = R * 256 + G - 1000 (to the nearest 10 ft); B = 1 over water. Sea
 * samples are 0 ft (the surface, not the bottom). public/terrain/index.json
 * lists the tiles and the regions they were built for: inside a region, a
 * missing tile is open sea. The PNG reader and writer are below (node:zlib only).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'terrain-src');
const OUT = path.join(ROOT, 'public', 'terrain');
const SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// ---------------------------------------------------------------------------
// PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decodes an 8-bit, non-interlaced greyscale, RGB or RGBA PNG.
 * Returns { width, height, channels, data } with `data` row-major, unfiltered.
 */
export function decodePng(buf) {
  if (!PNG_SIGNATURE.equals(buf.subarray(0, 8))) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color] ?? 0;
      if (depth !== 8 || !channels || body[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, color ${color}, interlace ${body[12]})`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= channels ? data[row + x - channels] : 0;
      const b = y > 0 ? data[prev + x] : 0;
      const c = x >= channels && y > 0 ? data[prev + x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      data[row + x] = out & 0xff;
    }
  }
  return { width, height, channels, data };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Filters one row with PNG filter `type` (bpp = bytes per pixel). */
function filterRow(type, data, row, stride, bpp, out, at) {
  out[at] = type;
  for (let x = 0; x < stride; x++) {
    const v = data[row + x];
    const a = x >= bpp ? data[row + x - bpp] : 0;
    const b = row > 0 ? data[row - stride + x] : 0;
    const c = x >= bpp && row > 0 ? data[row - stride + x - bpp] : 0;
    const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[at + 1 + x] = (v - pred) & 0xff;
  }
}

/**
 * Encodes 8-bit RGB pixels as a PNG. Several filter choices (each fixed
 * filter, and the usual per-row minimum-sum heuristic) and two deflate
 * strategies are tried and the smallest result is kept: terrain tiles are
 * small, so this is cheap.
 */
export function encodePng(width, height, rgb) {
  const bpp = 3;
  const stride = width * bpp;
  const candidates = [];
  for (const filter of [0, 1, 2, 3, 4, 'adaptive']) {
    const raw = Buffer.alloc(height * (stride + 1));
    const trial = Buffer.alloc(stride + 1);
    for (let y = 0; y < height; y++) {
      const at = y * (stride + 1);
      if (filter !== 'adaptive') {
        filterRow(filter, rgb, y * stride, stride, bpp, raw, at);
        continue;
      }
      let best = Infinity;
      for (let type = 0; type <= 4; type++) {
        filterRow(type, rgb, y * stride, stride, bpp, trial, 0);
        let sum = 0;
        for (let x = 1; x <= stride; x++) sum += trial[x] < 128 ? trial[x] : 256 - trial[x];
        if (sum < best) {
          best = sum;
          trial.copy(raw, at);
        }
      }
    }
    for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
      candidates.push(zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy }));
    }
  }
  const idat = candidates.reduce((a, b) => (b.length < a.length ? b : a));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Source tiles

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Web Mercator pixel coordinates (256 px tiles) of a position at zoom z. */
export function mercatorPixel(lat, lon, z) {
  const size = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

async function fetchTile(z, x, y) {
  const file = path.join(CACHE, String(z), String(x), `${y}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    // Not cached yet.
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${SOURCE}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buf);
      return buf;
    } catch (err) {
      if (attempt >= 5) throw new Error(`terrarium ${z}/${x}/${y}: ${err instanceof Error ? err.message : err}`);
      await sleep(1000 * attempt);
    }
  }
}

/** Decoded terrarium tile as meters, Float32Array(256 * 256). */
export function terrariumMeters(png) {
  const { width, height, channels, data } = decodePng(png);
  if (width !== 256 || height !== 256 || channels < 3) throw new Error('unexpected terrarium tile');
  const m = new Float32Array(256 * 256);
  for (let i = 0; i < m.length; i++) {
    const p = i * channels;
    m[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Output tiles

/**
 * Source zoom: at z8 a pixel is 470 m at 40 N (610 m at the equator), finer
 * than the 30 arc-second output grid (926 m north-south, 710 m east-west at
 * 40 N), so every output sample interpolates real source pixels.
 */
export const ZOOM = 8;
export const SAMPLES = 121;
const STEP = 1 / (SAMPLES - 1);
const FT_PER_M = 3.28084;
/** Feet offset in the R/G encoding, so terrain below sea level stays positive. */
const OFFSET_FT = 1000;
/**
 * Elevations are stored to the nearest 10 ft. The source is whole meters
 * with several meters of vertical error, and 30 arc-second sampling misses
 * far more than that in hilly terrain; dropping the last digit shrinks a
 * tile by about a third (PNG predicts each byte from its neighbours, so
 * every bit of noise in the low byte costs space).
 */
export const QUANTUM_FT = 10;

/**
 * Areas built, [south, west, north, east] in whole degrees. The contiguous US
 * box (24..50 N, 125..66 W) is widened to the nearby coasts of Canada, Mexico,
 * Cuba and the Bahamas so topo maps of border and coastal airports do not end
 * at a straight line close by; the extra sea costs nothing (all-sea tiles are
 * skipped). Hawaii and southeast Alaska are small.
 */
export const REGIONS = [
  [22, -128, 51, -64],
  [18, -161, 23, -154],
  [54, -141, 60, -129],
];

export function tileName(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${ns}${String(Math.abs(lat)).padStart(2, '0')}${ew}${String(Math.abs(lon)).padStart(3, '0')}`;
}

function* regionTiles(regions) {
  const seen = new Set();
  for (const [s, w, n, e] of regions) {
    // North to south: consecutive rows share source tiles, which stay in the decode cache.
    for (let lat = n - 1; lat >= s; lat--) {
      for (let lon = w; lon < e; lon++) {
        const key = `${lat},${lon}`;
        if (seen.has(key)) continue;
        seen.add(key);
        yield { lat, lon };
      }
    }
  }
}

/**
 * Mosaic margin in source pixels: the 7 x 7 sea window, the flatness window
 * and the bilinear neighbours at the tile's edges need it, and with it the
 * water rules give the same answer on both sides of a tile boundary.
 */
const MARGIN = 4;

/** Source pixel bounds (inclusive) of a 1-degree tile plus margin. */
function pixelBounds(lat, lon) {
  const nw = mercatorPixel(lat + 1, lon, ZOOM);
  const se = mercatorPixel(lat, lon + 1, ZOOM);
  return {
    x0: Math.floor(nw.x) - MARGIN,
    y0: Math.floor(nw.y) - MARGIN,
    x1: Math.ceil(se.x) + MARGIN,
    y1: Math.ceil(se.y) + MARGIN,
  };
}

function sourceTilesFor(b) {
  const out = [];
  const max = 2 ** ZOOM;
  for (let ty = Math.floor(b.y0 / 256); ty <= Math.floor(b.y1 / 256); ty++) {
    for (let tx = Math.floor(b.x0 / 256); tx <= Math.floor(b.x1 / 256); tx++) {
      out.push({ x: ((tx % max) + max) % max, y: Math.min(Math.max(ty, 0), max - 1) });
    }
  }
  return out;
}

/** Decoded source tiles, most recently used last. */
const decoded = new Map();
const DECODE_CACHE = 160;

async function sourceMeters(x, y) {
  const key = `${x}/${y}`;
  let m = decoded.get(key);
  if (m) {
    decoded.delete(key);
  } else {
    m = terrariumMeters(await fetchTile(ZOOM, x, y));
    if (decoded.size >= DECODE_CACHE) decoded.delete(decoded.keys().next().value);
  }
  decoded.set(key, m);
  return m;
}

/** Source meters over a pixel box, as one row-major array. */
async function mosaic(b) {
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const out = new Float32Array(w * h);
  const max = 2 ** ZOOM;
  for (let ty = Math.floor(b.y0 / 256); ty <= Math.floor(b.y1 / 256); ty++) {
    for (let tx = Math.floor(b.x0 / 256); tx <= Math.floor(b.x1 / 256); tx++) {
      const m = await sourceMeters(((tx % max) + max) % max, Math.min(Math.max(ty, 0), max - 1));
      const xs = Math.max(b.x0, tx * 256);
      const xe = Math.min(b.x1, tx * 256 + 255);
      const ys = Math.max(b.y0, ty * 256);
      const ye = Math.min(b.y1, ty * 256 + 255);
      for (let y = ys; y <= ye; y++) {
        for (let x = xs; x <= xe; x++) out[(y - b.y0) * w + (x - b.x0)] = m[(y - ty * 256) * 256 + (x - tx * 256)];
      }
    }
  }
  return { w, h, m: out };
}

const SEA = 1;
const LAKE = 2;

/**
 * The only places in the covered regions with land and water well below sea
 * level, [south, west, north, east]: the Salton Trough (the Salton Sea at
 * -71 m, the Imperial and Coachella valleys) and Death Valley (Badwater
 * Basin, -86 m). Elsewhere nothing lower than the Sacramento Delta's islands
 * (-8 m) is land.
 */
export const INLAND_BASINS = [
  [32.3, -116.4, 33.9, -115.0],
  [35.7, -117.4, 36.8, -116.4],
];
const LOWEST_LAND_M = -10;
const LOWEST_BASIN_LAND_M = -100;
/** In a basin, a bathymetric water body whose shore is lower than this (m) is a lake below sea level. */
const INLAND_SHORE_M = -5;

/**
 * Median of the land around each connected patch of `seed` pixels: the
 * patch's shore level. Whole-meter specks inside the water (mostly
 * surrounded by it) are not shore.
 */
function shoreLevels(seed, w, h, m) {
  const around = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!seed[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h) around[ny * w + nx]++;
        }
      }
    }
  }
  const patch = new Int32Array(w * h).fill(-1);
  const shores = [];
  const stack = [];
  for (let start = 0; start < seed.length; start++) {
    if (!seed[start] || patch[start] >= 0) continue;
    const id = shores.length;
    const shore = [];
    patch[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!seed[j]) {
            if (around[j] < 5) shore.push(m[j]);
          } else if (patch[j] < 0) {
            patch[j] = id;
            stack.push(j);
          }
        }
      }
    }
    shore.sort((a, b) => a - b);
    shores.push(shore.length ? shore[shore.length >> 1] : 0);
  }
  return { patch, shores };
}

/**
 * Water over a mosaic: `mask` (SEA, LAKE or 0) and `level`, the surface
 * elevation in meters (0 for the sea, a lake's surface, the ground on land).
 * `inBasin` says the mosaic lies in one of the INLAND_BASINS. The source
 * marks water two ways:
 * - Seas, bays and tidal lakes carry bathymetry, which (unlike the land
 *   data, whole meters) has fractional meters: fractional values below 1 m
 *   are water (Lake Pontchartrain's surface is stored as 0.004 to 0.03 m),
 *   and anything below the lowest land is sea floor however it is stored.
 *   That water is the sea, at 0 m, except in the basins: the Salton Sea and
 *   the pools of Death Valley have bathymetry too, and a patch there whose
 *   shore lies well below sea level is a lake at its shore's level.
 *   Whole-meter pixels at 1 m or lower in a mostly-sea neighbourhood (half
 *   of the 7 x 7 around them) are sea that happened to round, in specks and
 *   thin lines.
 * - Lakes and reservoirs are perfectly flat surfaces: any pixel whose 5 x 5
 *   neighbourhood has one value, grown back to the shore at the same value.
 *   Flat farmland is never flat to the meter at this resolution (the Red
 *   River and Central valleys have no such windows); salt flats and the
 *   Everglades do count as water.
 */
export function classifyWater({ w, h, m }, inBasin = false) {
  const mask = new Uint8Array(w * h);
  const level = Float32Array.from(m);
  const seed = new Uint8Array(w * h);
  const lowest = inBasin ? LOWEST_BASIN_LAND_M : LOWEST_LAND_M;
  for (let i = 0; i < m.length; i++) if ((m[i] < 1 && m[i] !== Math.round(m[i])) || m[i] < lowest) seed[i] = 1;
  const lakes = inBasin ? shoreLevels(seed, w, h, m) : null;
  for (let i = 0; i < m.length; i++) {
    if (!seed[i]) continue;
    const shore = lakes ? lakes.shores[lakes.patch[i]] : 0;
    if (shore < INLAND_SHORE_M) {
      mask[i] = LAKE;
      level[i] = shore;
    } else {
      mask[i] = SEA;
      level[i] = 0;
    }
  }
  const S = 3;
  for (let pass = 0; pass < 6; pass++) {
    const grown = [];
    for (let y = S; y < h - S; y++) {
      for (let x = S; x < w - S; x++) {
        const i = y * w + x;
        if (mask[i] || m[i] > 1) continue;
        let sea = 0;
        for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) if (mask[i + dy * w + dx] === SEA) sea++;
        if (sea * 2 >= (2 * S + 1) ** 2) grown.push(i);
      }
    }
    for (const i of grown) {
      mask[i] = SEA;
      level[i] = 0;
    }
  }
  // Flat 5 x 5 cores: a horizontal pass, then a vertical one.
  const R = 2;
  const row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = R; x < w - R; x++) {
      const i = y * w + x;
      let flat = 1;
      for (let d = -R; d <= R && flat; d++) if (m[i + d] !== m[i]) flat = 0;
      row[i] = flat;
    }
  }
  const core = new Uint8Array(w * h);
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const i = y * w + x;
      let flat = 1;
      for (let d = -R; d <= R && flat; d++) if (!row[i + d * w] || m[i + d * w] !== m[i]) flat = 0;
      core[i] = flat;
    }
  }
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const i = y * w + x;
      if (!core[i]) continue;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const j = i + dy * w + dx;
          if (m[j] === m[i] && !mask[j]) mask[j] = LAKE;
        }
      }
    }
  }
  return { mask, level };
}

/**
 * Samples one 1-degree tile: elevation in feet and a water flag at 121 x 121
 * points, row 0 at the north edge. Returns null for open sea (nothing to store).
 */
export async function buildTile(lat, lon) {
  const b = pixelBounds(lat, lon);
  const mos = await mosaic(b);
  const inBasin = INLAND_BASINS.some(([s, w, n, e]) => lat < n && lat + 1 > s && lon < e && lon + 1 > w);
  const { mask, level } = classifyWater(mos, inBasin);
  const { w } = mos;
  const feet = new Int32Array(SAMPLES * SAMPLES);
  const water = new Uint8Array(SAMPLES * SAMPLES);
  let allSea = true;
  for (let r = 0; r < SAMPLES; r++) {
    const la = lat + 1 - r * STEP;
    for (let c = 0; c < SAMPLES; c++) {
      const p = mercatorPixel(la, lon + c * STEP, ZOOM);
      // Pixel centers are at +0.5.
      const fx = p.x - 0.5 - b.x0;
      const fy = p.y - 0.5 - b.y0;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const i = y0 * w + x0;
      const meters = (level[i] * (1 - tx) + level[i + 1] * tx) * (1 - ty) + (level[i + w] * (1 - tx) + level[i + w + 1] * tx) * ty;
      const k = r * SAMPLES + c;
      feet[k] = Math.round((meters * FT_PER_M) / QUANTUM_FT) * QUANTUM_FT;
      water[k] = mask[Math.round(fy) * w + Math.round(fx)] ? 1 : 0;
      if (!water[k] || feet[k] !== 0) allSea = false;
    }
  }
  return allSea ? null : { feet, water };
}

/** The tile as RGB bytes: feet + 1000 in R (high byte) and G (low byte), B = 1 over water. */
export function encodeTileRgb(feet, water) {
  const rgb = new Uint8Array(feet.length * 3);
  for (let k = 0; k < feet.length; k++) {
    const v = Math.min(Math.max(feet[k] + OFFSET_FT, 0), 65535);
    rgb[k * 3] = v >> 8;
    rgb[k * 3 + 1] = v & 0xff;
    rgb[k * 3 + 2] = water[k];
  }
  return rgb;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
      done++;
      if (done % 25 === 0 || done === items.length) process.stdout.write(`\rsource tiles ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
  if (items.length) process.stdout.write('\n');
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const only = arg('--only')?.split(',').map((s) => s.trim().toUpperCase());
  const concurrency = Number(arg('--concurrency') ?? 8);
  const all = [...regionTiles(REGIONS)];
  const tiles = only ? all.filter((t) => only.includes(tileName(t.lat, t.lon))) : all;

  // Download every source tile first (cached), then build.
  const needed = new Map();
  for (const t of tiles) for (const s of sourceTilesFor(pixelBounds(t.lat, t.lon))) needed.set(`${s.x}/${s.y}`, s);
  await pool([...needed.values()], concurrency, (s) => fetchTile(ZOOM, s.x, s.y));

  await fs.mkdir(OUT, { recursive: true });
  const written = [];
  let bytes = 0;
  let largest = { name: '', size: 0 };
  for (const [n, t] of tiles.entries()) {
    const name = tileName(t.lat, t.lon);
    const tile = await buildTile(t.lat, t.lon);
    const file = path.join(OUT, `${name}.png`);
    if (!tile) {
      await fs.rm(file, { force: true });
    } else {
      const png = encodePng(SAMPLES, SAMPLES, encodeTileRgb(tile.feet, tile.water));
      await fs.writeFile(file, png);
      written.push(name);
      bytes += png.length;
      if (png.length > largest.size) largest = { name, size: png.length };
    }
    if (n % 20 === 0 || n === tiles.length - 1) process.stdout.write(`\rtiles ${n + 1}/${tiles.length}, ${written.length} written`);
  }
  process.stdout.write('\n');

  if (!only) {
    // Clear tiles left from earlier builds that are now open sea or outside the regions.
    const keep = new Set(written.map((n) => `${n}.png`));
    for (const f of await fs.readdir(OUT)) if (f.endsWith('.png') && !keep.has(f)) await fs.rm(path.join(OUT, f));
    const index = {
      v: 1,
      source: `AWS Terrain Tiles (terrarium), zoom ${ZOOM}`,
      built: new Date().toISOString().slice(0, 10),
      samples: SAMPLES,
      regions: REGIONS,
      tiles: written.sort(),
    };
    await fs.writeFile(path.join(OUT, 'index.json'), `${JSON.stringify(index)}\n`);
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(
    `${written.length} tiles of ${tiles.length}, ${(bytes / 1048576).toFixed(2)} MB, ` +
      `average ${kb(bytes / Math.max(written.length, 1))}, largest ${largest.name} ${kb(largest.size)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
