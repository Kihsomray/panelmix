import { tileName, type TerrainProvider, type TerrainSample } from './terrain';

/*
 * Browser terrain service: loads the 1-degree PNG tiles described in
 * terrain.ts on demand, keeps the decoded grids and answers elevation
 * queries by bilinear interpolation.
 *
 * Tiles (scripts/build-terrain.mjs): 121 x 121 samples, row 0 at the north
 * edge and column 0 at the west edge; feet = R * 256 + G - 1000, B = 1 over
 * water. public/terrain/index.json:
 *
 *   { v: 1, samples: 121, regions: [[south, west, north, east], ...], tiles: ["N39W078", ...] }
 *
 * Inside a region, a degree with no tile is open sea (0 ft, water); outside
 * every region there is no data.
 *
 * PNGs are decoded here (DecompressionStream inflates the image data) rather
 * than drawn to a canvas and read back: canvas readback can be colour
 * managed or deliberately noised by anti-fingerprinting (Safari private
 * windows, Brave), and one changed bit in R moves the ground by 256 ft.
 * Browsers without DecompressionStream fall back to Image + canvas.
 */

/** Samples per tile side (both edges included: 30 arc seconds). */
export const TILE_SAMPLES = 121;

/** A decoded tile. */
export interface TerrainGrid {
  /** South-west corner, whole degrees. */
  readonly lat: number;
  readonly lon: number;
  /** Samples per side. */
  readonly size: number;
  /** Elevation, ft MSL, row-major from the north-west corner. */
  readonly feet: Int16Array;
  /** 1 over water, same layout; null when the tile has none. */
  readonly water: Uint8Array | null;
}

export interface TerrainIndex {
  readonly v: 1;
  readonly samples?: number;
  readonly regions: readonly (readonly [number, number, number, number])[];
  readonly tiles: readonly string[];
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Pure tile math (tested in Node with real tiles)

/** Builds a grid from decoded pixels (RGB or RGBA). */
export function decodeTerrainPixels(lat: number, lon: number, img: DecodedImage): TerrainGrid {
  const { width, height, channels, data } = img;
  if (width !== height || channels < 3) throw new Error(`terrain tile ${tileName(lat, lon)}: ${width}x${height}x${channels}`);
  const n = width * height;
  const feet = new Int16Array(n);
  let water: Uint8Array | null = null;
  for (let k = 0; k < n; k++) {
    const p = k * channels;
    feet[k] = data[p]! * 256 + data[p + 1]! - 1000;
    if (data[p + 2]) (water ??= new Uint8Array(n))[k] = 1;
  }
  return { lat, lon, size: width, feet, water };
}

/** Elevation (bilinear between the four surrounding samples) and water (nearest sample) at a point in the grid. */
export function gridSample(g: TerrainGrid, lat: number, lon: number): TerrainSample {
  const last = g.size - 1;
  const fx = Math.min(Math.max((lon - g.lon) * last, 0), last);
  const fy = Math.min(Math.max((g.lat + 1 - lat) * last, 0), last);
  const x0 = Math.min(Math.floor(fx), last - 1);
  const y0 = Math.min(Math.floor(fy), last - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * g.size + x0;
  const f = g.feet;
  const top = f[i]! + (f[i + 1]! - f[i]!) * tx;
  const bottom = f[i + g.size]! + (f[i + g.size + 1]! - f[i + g.size]!) * tx;
  const water = g.water !== null && g.water[Math.round(fy) * g.size + Math.round(fx)] === 1;
  return { elevationFt: top + (bottom - top) * ty, water };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decodes an 8-bit, non-interlaced greyscale, RGB or RGBA PNG. */
export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Uint8Array[] = [];
  for (let off = 8; off + 8 <= bytes.length; ) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === 'IHDR') {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      const depth = bytes[off + 16];
      const color = bytes[off + 17]!;
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0;
      if (depth !== 8 || channels === 0 || bytes[off + 20] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') parts.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const compressed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    compressed.set(p, at);
    at += p.length;
  }
  const raw = await inflate(compressed);
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG');
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels]! : 0;
      const b = y > 0 ? data[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? data[row - stride + x - channels]! : 0;
      const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      data[row + x] = (raw[src + x]! + pred) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Fallback for browsers without DecompressionStream: let the browser decode and read the pixels back. */
async function decodeWithCanvas(bytes: Uint8Array): Promise<DecodedImage> {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D canvas');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, channels: 4, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Service

export interface TerrainServiceOptions {
  /** Reads a file under the base URL ("terrain/index.json"); the default uses fetch. Tests read public/ directly. */
  readonly load?: (path: string) => Promise<Uint8Array>;
  /** Decoded tiles kept in memory (about 45 kB each). */
  readonly maxTiles?: number;
}

export interface TerrainService extends TerrainProvider {
  /** Loads the tile under a point (if there is one) and resolves when it is ready. */
  load(lat: number, lon: number): Promise<void>;
  /** Tiles decoded so far, for repaint keys. */
  readonly revision: number;
}

interface ReadyEntry {
  readonly state: 'ready';
  readonly grid: TerrainGrid;
  /** Clock of the last query, for least-recently-used eviction. */
  used: number;
}

type Entry = { readonly state: 'loading'; readonly done: Promise<void> } | ReadyEntry | { readonly state: 'failed'; readonly retryAt: number };

const SEA: TerrainSample = { elevationFt: 0, water: true };
const MAX_IN_FLIGHT = 6;
/** Most tiles one prefetch asks for (a map at 300 nm range covers about 150). */
const MAX_PREFETCH = 200;
/** Requests waiting to start; the oldest (least urgent) are dropped beyond this. */
const MAX_QUEUE = 400;
const RETRY_MS = 30_000;
/** Listeners hear about loads at most this often, so a burst of tiles repaints once. */
const NOTIFY_MS = 80;

const keyOf = (la: number, lo: number) => (la + 90) * 360 + (lo + 180);

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Terrain from public/terrain/ under `baseUrl` (the app's base, ending in a slash). */
export function createTerrainService(baseUrl: string, options: TerrainServiceOptions = {}): TerrainService {
  const load = options.load ?? ((p: string) => fetchBytes(`${baseUrl}${p}`));
  const maxTiles = options.maxTiles ?? 600;
  const decode = typeof DecompressionStream === 'function' ? decodePng : decodeWithCanvas;

  let regions: TerrainIndex['regions'] = [];
  let available: Set<number> | null = null;
  let pendingBox: [number, number, number, number] | null = null;
  const entries = new Map<number, Entry>();
  let ready = 0;
  let clock = 0;
  let revision = 0;
  // The last tile used: consecutive queries (a map raster, the airplane) almost always hit it.
  let lastKey = -1;
  let last: ReadyEntry | null = null;

  /** Tiles waiting to load, most urgent last (popped first); `queued` mirrors it for O(1) lookups. */
  let queue: number[] = [];
  const queued = new Set<number>();
  let inFlight = 0;
  const listeners = new Set<() => void>();
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    revision++;
    if (notifyTimer !== null) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const l of [...listeners]) l();
    }, NOTIFY_MS);
  };

  const inRegion = (la: number, lo: number) => regions.some(([s, w, n, e]) => la >= s && la < n && lo >= w && lo < e);

  const indexReady = load('terrain/index.json')
    .then((bytes) => {
      const index = JSON.parse(new TextDecoder().decode(bytes)) as TerrainIndex;
      regions = index.regions;
      available = new Set(
        index.tiles.map((name) => {
          const la = Number(name.slice(1, 3)) * (name[0] === 'S' ? -1 : 1);
          const lo = Number(name.slice(4, 7)) * (name[3] === 'W' ? -1 : 1);
          return keyOf(la, lo);
        }),
      );
      if (pendingBox) prefetch(...pendingBox);
      pendingBox = null;
      notify();
    })
    .catch(() => {
      // No terrain installed: every query answers "no data".
      available = new Set();
    });

  function evict() {
    if (ready <= maxTiles) return;
    let oldestKey = -1;
    let oldest = Infinity;
    for (const [k, e] of entries) {
      if (e.state === 'ready' && e.used < oldest) {
        oldest = e.used;
        oldestKey = k;
      }
    }
    if (oldestKey >= 0) {
      entries.delete(oldestKey);
      ready--;
      if (oldestKey === lastKey) {
        lastKey = -1;
        last = null;
      }
    }
  }

  function start(key: number): Promise<void> {
    const la = Math.floor(key / 360) - 90;
    const lo = (key % 360) - 180;
    inFlight++;
    const done = load(`terrain/${tileName(la, lo)}.png`)
      .then(decode)
      .then((img) => {
        entries.set(key, { state: 'ready', grid: decodeTerrainPixels(la, lo, img), used: ++clock });
        ready++;
        evict();
        notify();
      })
      .catch(() => {
        entries.set(key, { state: 'failed', retryAt: Date.now() + RETRY_MS });
      })
      .finally(() => {
        inFlight--;
        pump();
      });
    entries.set(key, { state: 'loading', done });
    return done;
  }

  function pump() {
    while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
      const key = queue.pop()!;
      queued.delete(key);
      const e = entries.get(key);
      if (!e || (e.state === 'failed' && Date.now() >= e.retryAt)) start(key);
    }
  }

  /** Whether a tile still has to be requested (not loaded, loading or recently failed). */
  function needs(key: number): boolean {
    const e = entries.get(key);
    return !e || (e.state === 'failed' && Date.now() >= e.retryAt);
  }

  /** Queues tiles, the last one most urgent; tiles already queued move up. */
  function enqueue(keys: readonly number[]) {
    const fresh = keys.filter(needs);
    if (fresh.length === 0) return;
    const moving = new Set(fresh.filter((k) => queued.has(k)));
    if (moving.size > 0) queue = queue.filter((k) => !moving.has(k));
    for (const k of fresh) {
      queue.push(k);
      queued.add(k);
    }
    if (queue.length > MAX_QUEUE) for (const k of queue.splice(0, queue.length - MAX_QUEUE)) queued.delete(k);
    pump();
  }

  function prefetch(south: number, west: number, north: number, east: number) {
    if (!available) {
      pendingBox = [south, west, north, east];
      return;
    }
    const clat = (south + north) / 2;
    const clon = (west + east) / 2;
    const keys: { key: number; d: number }[] = [];
    for (let la = Math.floor(south); la <= Math.floor(north); la++) {
      for (let lo = Math.floor(west); lo <= Math.floor(east); lo++) {
        const key = keyOf(la, lo);
        if (available.has(key)) keys.push({ key, d: Math.hypot(la + 0.5 - clat, (lo + 0.5 - clon) * Math.cos((clat * Math.PI) / 180)) });
      }
    }
    // Nearest the middle of the view loads first (the queue pops from its end).
    keys.sort((a, b) => b.d - a.d);
    enqueue(keys.slice(-MAX_PREFETCH).map((k) => k.key));
  }

  function sample(lat: number, lon: number): TerrainSample | null {
    if (!available || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const la = Math.floor(lat);
    const lo = Math.floor(lon);
    const key = keyOf(la, lo);
    if (key === lastKey && last) {
      last.used = ++clock;
      return gridSample(last.grid, lat, lon);
    }
    if (!available.has(key)) return inRegion(la, lo) ? SEA : null;
    const e = entries.get(key);
    if (e?.state === 'ready') {
      e.used = ++clock;
      lastKey = key;
      last = e;
      return gridSample(e.grid, lat, lon);
    }
    // Not here yet: ask for it (once; a map raster asks thousands of times per paint).
    if (!queued.has(key) && needs(key)) enqueue([key]);
    return null;
  }

  return {
    sample,
    elevationFt(lat, lon) {
      return sample(lat, lon)?.elevationFt ?? null;
    },
    prefetch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load(lat, lon) {
      await indexReady;
      const key = keyOf(Math.floor(lat), Math.floor(lon));
      if (!available?.has(key)) return;
      const e = entries.get(key);
      if (e?.state === 'ready') return;
      if (e?.state === 'loading') return e.done;
      if (queued.delete(key)) queue = queue.filter((k) => k !== key);
      return start(key);
    },
    get revision() {
      return revision;
    },
  };
}
