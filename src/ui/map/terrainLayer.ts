import { EARTH_RADIUS_NM, toRad, type LatLon } from '../../core/geo';
import type { TerrainProvider } from '../../core/terrain';

/*
 * Terrain under the moving map, drawn as a coarse raster (cells of a few
 * pixels, smoothed when scaled up) so a repaint costs a few milliseconds:
 * - topo: hypsometric colours, greens through browns to grey peaks, water
 *   in the map's lake colour, with light relief shading from the top left;
 * - relative: Garmin TAWS / TERRAIN colours against the airplane's altitude,
 *   red where terrain is within 100 ft below the airplane or higher, yellow
 *   within 1,000 ft below, nothing (the black map) lower down.
 */

export type TerrainMode = 'topo' | 'relative';

export interface TerrainLayerOptions {
  readonly provider: TerrainProvider;
  readonly mode: TerrainMode;
  /** Airplane altitude, ft MSL: what `relative` colours compare against. */
  readonly altitudeFt: number;
}

/** Terrain this close below the airplane, or higher, is red. */
export const TAWS_RED_FT = 100;
/** Terrain this close below the airplane is yellow. */
export const TAWS_YELLOW_FT = 1000;

/** Beyond this many 1-degree tiles in view (a map range of about 250 nm) the layer is not drawn. */
export const MAX_TILES_IN_VIEW = 160;

const NM_PER_DEG = EARTH_RADIUS_NM * (Math.PI / 180);

export interface MapFrame {
  readonly width: number;
  readonly height: number;
  readonly origin: LatLon;
  /** Projection origin on screen, px. */
  readonly ox: number;
  readonly oy: number;
  /** Pixels per nm. */
  readonly scale: number;
  /** True direction drawn straight up. */
  readonly upTrue: number;
}

/** Inverse of `makeProjection` in paintMap.ts: a screen point back to latitude and longitude. */
export function screenToLatLon(f: MapFrame, x: number, y: number): LatLon {
  const xr = (x - f.ox) / f.scale;
  const yr = (f.oy - y) / f.scale;
  const t = toRad(f.upTrue);
  const east = xr * Math.cos(t) + yr * Math.sin(t);
  const north = -xr * Math.sin(t) + yr * Math.cos(t);
  const lat = f.origin.lat + north / NM_PER_DEG;
  const lon = f.origin.lon + east / (NM_PER_DEG * Math.max(Math.cos(toRad((lat + f.origin.lat) / 2)), 0.01));
  return { lat, lon };
}

/** Latitude and longitude box of everything on screen (the four corners, plus the edge midpoints for rotated maps). */
export function visibleBox(f: MapFrame): { south: number; west: number; north: number; east: number } {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const [x, y] of [[0, 0], [f.width / 2, 0], [f.width, 0], [f.width, f.height / 2], [f.width, f.height], [f.width / 2, f.height], [0, f.height], [0, f.height / 2]] as const) {
    const p = screenToLatLon(f, x, y);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  return { south, west, north, east };
}

// ---------------------------------------------------------------------------
// Colours

type Rgb = readonly [number, number, number];

/** Elevation tint stops, ft MSL: dark enough that white and magenta symbols stay readable on top. */
const TOPO_STOPS: readonly (readonly [number, Rgb])[] = [
  [-1000, [24, 58, 30]],
  [0, [30, 72, 34]],
  [500, [38, 86, 38]],
  [1000, [56, 96, 40]],
  [2000, [84, 104, 46]],
  [3000, [110, 106, 52]],
  [4500, [122, 98, 56]],
  [6000, [118, 84, 54]],
  [8000, [104, 76, 56]],
  [10000, [122, 104, 92]],
  [12000, [150, 144, 138]],
  [14000, [190, 188, 186]],
];

/** Topo colour for an elevation, interpolated between the stops. */
export function topoColor(elevationFt: number): Rgb {
  const first = TOPO_STOPS[0]!;
  if (elevationFt <= first[0]) return first[1];
  for (let i = 1; i < TOPO_STOPS.length; i++) {
    const [ft, rgb] = TOPO_STOPS[i]!;
    if (elevationFt <= ft) {
      const [ft0, rgb0] = TOPO_STOPS[i - 1]!;
      const t = (elevationFt - ft0) / (ft - ft0);
      return [rgb0[0] + (rgb[0] - rgb0[0]) * t, rgb0[1] + (rgb[1] - rgb0[1]) * t, rgb0[2] + (rgb[2] - rgb0[2]) * t];
    }
  }
  return TOPO_STOPS[TOPO_STOPS.length - 1]![1];
}

/** `topoColor` every 20 ft from -1,000 to 21,000 ft, as separate channels for the shading multiply. */
const LUT_STEP_FT = 20;
const LUT_BASE_FT = -1000;
const LUT_SIZE = (21000 - LUT_BASE_FT) / LUT_STEP_FT + 1;
const LUT = (() => {
  const r = new Uint8Array(LUT_SIZE);
  const g = new Uint8Array(LUT_SIZE);
  const b = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [cr, cg, cb] = topoColor(LUT_BASE_FT + i * LUT_STEP_FT);
    r[i] = Math.round(cr);
    g[i] = Math.round(cg);
    b[i] = Math.round(cb);
  }
  return { r, g, b };
})();

export type TawsLevel = 'red' | 'yellow' | 'none';

/** The TAWS colour band of terrain at `elevationFt` seen from `altitudeFt`. */
export function tawsLevel(elevationFt: number, altitudeFt: number): TawsLevel {
  if (elevationFt >= altitudeFt - TAWS_RED_FT) return 'red';
  if (elevationFt >= altitudeFt - TAWS_YELLOW_FT) return 'yellow';
  return 'none';
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** An opaque colour as written through a Uint32Array view of ImageData. */
function pack(r: number, g: number, b: number): number {
  const R = Math.round(Math.min(Math.max(r, 0), 255));
  const G = Math.round(Math.min(Math.max(g, 0), 255));
  const B = Math.round(Math.min(Math.max(b, 0), 255));
  return LITTLE_ENDIAN ? ((255 << 24) | (B << 16) | (G << 8) | R) >>> 0 : ((R << 24) | (G << 16) | (B << 8) | 255) >>> 0;
}

const TAWS_RED = pack(255, 0, 0);
const TAWS_YELLOW = pack(255, 255, 0);

function parseHex(color: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [10, 38, 72];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Raster

interface Buffers {
  cols: number;
  rows: number;
  elevation: Float32Array;
  water: Uint8Array;
  topo: ImageData | null;
  relative: ImageData | null;
}

const buffers: Buffers = { cols: 0, rows: 0, elevation: new Float32Array(0), water: new Uint8Array(0), topo: null, relative: null };
/** The relative picture is thresholded at twice the cell resolution, so band edges are smooth rather than stepped. */
const RELATIVE_SUPERSAMPLE = 2;
let surface: OffscreenCanvas | HTMLCanvasElement | null = null;

/** Raster cell size in map pixels: about 15,000 cells for any map size, never coarser than 6 px. */
export function cellSize(width: number, height: number): number {
  return Math.min(Math.max(Math.round(Math.sqrt((width * height) / 15000)), 3), 6);
}

function surfaceFor(cols: number, rows: number): OffscreenCanvas | HTMLCanvasElement {
  if (!surface) surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cols, rows) : document.createElement('canvas');
  if (surface.width !== cols) surface.width = cols;
  if (surface.height !== rows) surface.height = rows;
  return surface;
}

/**
 * Paints the terrain layer and asks the provider for the tiles in view.
 * `waterColor` is the map's lake colour, so topo water matches the basemap.
 */
export function paintTerrain(ctx: CanvasRenderingContext2D, layer: TerrainLayerOptions, frame: MapFrame, waterColor: string): void {
  const box = visibleBox(frame);
  const tiles = (Math.floor(box.north) - Math.floor(box.south) + 1) * (Math.floor(box.east) - Math.floor(box.west) + 1);
  if (tiles > MAX_TILES_IN_VIEW) return;
  layer.provider.prefetch(box.south, box.west, box.north, box.east);

  const cell = cellSize(frame.width, frame.height);
  const cols = Math.ceil(frame.width / cell);
  const rows = Math.ceil(frame.height / cell);
  if (buffers.cols !== cols || buffers.rows !== rows) {
    buffers.cols = cols;
    buffers.rows = rows;
    buffers.elevation = new Float32Array(cols * rows);
    buffers.water = new Uint8Array(cols * rows);
    buffers.topo = null;
    buffers.relative = null;
  }
  const { elevation, water } = buffers;
  const topo = layer.mode === 'topo';
  let any = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = screenToLatLon(frame, (c + 0.5) * cell, (r + 0.5) * cell);
      const k = r * cols + c;
      if (topo) {
        const s = layer.provider.sample(p.lat, p.lon);
        elevation[k] = s ? s.elevationFt : NaN;
        water[k] = s?.water ? 1 : 0;
      } else {
        elevation[k] = layer.provider.elevationFt(p.lat, p.lon) ?? NaN;
      }
      if (!any && !Number.isNaN(elevation[k]!)) any = true;
    }
  }
  if (!any) return;

  let image: ImageData;
  if (topo) {
    image = buffers.topo ??= new ImageData(cols, rows);
    shadeTopo(new Uint32Array(image.data.buffer), elevation, water, cols, rows, cell / frame.scale, parseHex(waterColor));
  } else {
    image = buffers.relative ??= new ImageData(cols * RELATIVE_SUPERSAMPLE, rows * RELATIVE_SUPERSAMPLE);
    colourRelative(new Uint32Array(image.data.buffer), elevation, cols, rows, layer.altitudeFt);
  }

  const canvas = surfaceFor(image.width, image.height);
  const sctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sctx) return;
  sctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, cols * cell, rows * cell);
  ctx.restore();
}

/**
 * TAWS bands from the cell elevations, interpolated to RELATIVE_SUPERSAMPLE
 * pixels per cell before thresholding (cell centers sit at half-cell
 * offsets). Cells without data stay clear.
 */
function colourRelative(px: Uint32Array, elevation: Float32Array, cols: number, rows: number, altitudeFt: number) {
  const n = RELATIVE_SUPERSAMPLE;
  const width = cols * n;
  const at = (r: number, c: number) => elevation[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]!;
  for (let y = 0; y < rows * n; y++) {
    const v = (y + 0.5) / n - 0.5;
    const r0 = Math.floor(v);
    const ty = v - r0;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / n - 0.5;
      const c0 = Math.floor(u);
      const tx = u - c0;
      const a = at(r0, c0);
      const b = at(r0, c0 + 1);
      const c = at(r0 + 1, c0);
      const d = at(r0 + 1, c0 + 1);
      let e = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      // At the edge of the loaded data, fall back to the nearest cell.
      if (Number.isNaN(e)) e = at(Math.round(v), Math.round(u));
      const k = y * width + x;
      if (Number.isNaN(e)) px[k] = 0;
      else if (e >= altitudeFt - TAWS_RED_FT) px[k] = TAWS_RED;
      else if (e >= altitudeFt - TAWS_YELLOW_FT) px[k] = TAWS_YELLOW;
      else px[k] = 0;
    }
  }
}

/**
 * Hypsometric tint with hillshading lit from the top left of the screen.
 * Relief is exaggerated more at long ranges, where a cell spans miles and
 * real slopes would barely show.
 */
function shadeTopo(px: Uint32Array, elevation: Float32Array, water: Uint8Array, cols: number, rows: number, cellNm: number, waterRgb: Rgb) {
  const spacingFt = cellNm * 6076;
  const exaggeration = Math.min(Math.max(Math.sqrt(cellNm / 0.25), 1), 6);
  const k = exaggeration / (2 * spacingFt);
  const waterPx = pack(waterRgb[0], waterRgb[1], waterRgb[2]);
  const at = (r: number, c: number, fallback: number) => {
    const v = elevation[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]!;
    return Number.isNaN(v) ? fallback : v;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const e = elevation[i]!;
      if (Number.isNaN(e)) {
        px[i] = 0;
        continue;
      }
      if (water[i]) {
        px[i] = waterPx;
        continue;
      }
      // Slope per screen axis (y down); light from the upper left at 45 degrees.
      const dx = (at(r, c + 1, e) - at(r, c - 1, e)) * k;
      const dy = (at(r + 1, c, e) - at(r - 1, c, e)) * k;
      const lit = (0.5 * dx + 0.5 * dy + Math.SQRT1_2) / Math.sqrt(dx * dx + dy * dy + 1) / Math.SQRT1_2;
      const shade = Math.min(Math.max(1 + 0.65 * (lit - 1), 0.5), 1.4);
      const j = Math.min(Math.max(Math.round((e - LUT_BASE_FT) / LUT_STEP_FT), 0), LUT_SIZE - 1);
      px[i] = pack(LUT.r[j]! * shade, LUT.g[j]! * shade, LUT.b[j]! * shade);
    }
  }
}

// ---------------------------------------------------------------------------

const revisions = new WeakMap<TerrainProvider, { n: number }>();

/**
 * A number that changes whenever the provider loads more terrain. Devices
 * that repaint their map only when its picture changes add it to their
 * repaint key (with the altitude, for the relative mode), so terrain shows
 * up as soon as it arrives.
 */
export function terrainRevision(provider: TerrainProvider): number {
  let r = revisions.get(provider);
  if (!r) {
    const counter = { n: 0 };
    provider.subscribe(() => counter.n++);
    revisions.set(provider, counter);
    r = counter;
  }
  return r.n;
}
