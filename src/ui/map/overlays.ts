import type { AirspaceClass, AirspaceSource, AirspaceVolume } from '../../core/airspace';
import { airspaceLabel, ringParts } from '../../core/airspaceSource';
import type { LatLon } from '../../core/geo';
import type { Airway, Fix } from '../../core/navdb';

/*
 * Airspace, intersection and airway overlays for the moving map. Each draws
 * only what is inside the view, using cached bounding boxes, and hides
 * itself (or its labels) at ranges where a real unit would declutter it.
 */

export interface ViewBox {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

export interface OverlayContext {
  readonly toScreen: (p: LatLon) => { x: number; y: number };
  readonly box: ViewBox;
  readonly width: number;
  readonly height: number;
  /** Map range, nm (ownship or center to the top edge). */
  readonly rangeNm: number;
  readonly declutter: number;
  readonly font: string;
  readonly fontSize: number;
  readonly halo: string;
  readonly labels: LabelSpace;
}

/** Screen rectangles already taken by labels in this paint, so later labels do not overprint them. */
export class LabelSpace {
  private readonly taken: { x0: number; y0: number; x1: number; y1: number }[] = [];

  /** Claims a rectangle centered at (x, y); false (nothing claimed) if it overlaps one already taken. */
  claim(x: number, y: number, w: number, h: number): boolean {
    const r = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
    for (const t of this.taken) if (r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0) return false;
    this.taken.push(r);
    return true;
  }

  /** Takes a rectangle whatever it overlaps: for symbols and names that are drawn anyway. */
  reserve(x: number, y: number, w: number, h: number): void {
    this.taken.push({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
  }
}

const onScreen = (s: { x: number; y: number }, c: OverlayContext, margin = 20) =>
  s.x > -margin && s.x < c.width + margin && s.y > -margin && s.y < c.height + margin;

function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, halo: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Airspace

export interface AirspaceColors {
  readonly classB: string;
  readonly classC: string;
  readonly classD: string;
}

/** Garmin's airspace colours: Class B blue, C magenta, D blue (dashed). */
export const AIRSPACE_COLORS: AirspaceColors = { classB: '#3d8bff', classC: '#e040e0', classD: '#3d8bff' };

/** Largest map range (nm) each class is drawn at, and labelled at. */
export const AIRSPACE_MAX_RANGE: Record<AirspaceClass, number> = { B: 200, C: 120, D: 60 };
export const AIRSPACE_LABEL_RANGE: Record<AirspaceClass, number> = { B: 40, C: 25, D: 15 };

const colorOf = (cls: AirspaceClass, c: AirspaceColors) => (cls === 'B' ? c.classB : cls === 'C' ? c.classC : c.classD);

/** Altitudes as on charts, in hundreds of feet: "100" over "30", "SFC" for surface floors. */
export function airspaceLabelLines(v: AirspaceVolume): [string, string] | [string] {
  const hundreds = (ft: number) => String(Math.round(ft / 100));
  const ceiling = hundreds(v.upperFt);
  if (v.cls === 'D' && v.lowerFt === 0) return [ceiling];
  return [ceiling, v.lowerFt === 0 ? 'SFC' : hundreds(v.lowerFt)];
}

function traceRing(ctx: CanvasRenderingContext2D, ring: readonly number[], c: OverlayContext) {
  for (const [start, end] of ringParts(ring)) {
    for (let i = start; i < end; i += 2) {
      const s = c.toScreen({ lon: ring[i]!, lat: ring[i + 1]! });
      if (i === start) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
  }
}

export function paintAirspace(ctx: CanvasRenderingContext2D, source: AirspaceSource, c: OverlayContext, colors: AirspaceColors = AIRSPACE_COLORS): void {
  const range = c.rangeNm;
  const volumes = source.inBox(c.box.south, c.box.west, c.box.north, c.box.east).filter((v) => range <= AIRSPACE_MAX_RANGE[v.cls]);
  if (volumes.length === 0) return;
  ctx.lineJoin = 'round';
  for (const v of volumes) {
    ctx.strokeStyle = colorOf(v.cls, colors);
    ctx.lineWidth = v.cls === 'D' ? 1.6 : 2;
    ctx.setLineDash(v.cls === 'D' ? [6, 4] : []);
    ctx.beginPath();
    traceRing(ctx, v.ring, c);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (c.declutter >= 2) return;

  // Altitude labels. The data lists big volumes first; labelling in reverse lets Class D and
  // the inner rings claim their spot before the wide shelves around them.
  const size = Math.max(c.fontSize - 2, 10);
  ctx.font = `700 ${size}px ${c.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const v of [...volumes].reverse()) {
    if (range > AIRSPACE_LABEL_RANGE[v.cls]) continue;
    const [lon, lat] = airspaceLabel(v);
    const s = c.toScreen({ lat, lon });
    if (!onScreen(s, c, -10)) continue;
    // Skip volumes too small on screen to hold a label.
    const sw = c.toScreen({ lat: v.bbox[1], lon: v.bbox[0] });
    const ne = c.toScreen({ lat: v.bbox[3], lon: v.bbox[2] });
    if (Math.hypot(ne.x - sw.x, ne.y - sw.y) < 70) continue;
    const lines = airspaceLabelLines(v);
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 6;
    const h = lines.length * (size + 1) + 4;
    if (!c.labels.claim(s.x, s.y, w, h)) continue;
    const color = colorOf(v.cls, colors);
    if (lines.length === 2) {
      haloText(ctx, lines[0], s.x, s.y - size / 2 - 1, color, c.halo);
      haloText(ctx, lines[1], s.x, s.y + size / 2 + 1, color, c.halo);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x - w / 2 + 3, s.y);
      ctx.lineTo(s.x + w / 2 - 3, s.y);
      ctx.stroke();
    } else {
      // Class D: the ceiling in a dashed box, as on charts.
      haloText(ctx, lines[0], s.x, s.y, color, c.halo);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
      ctx.setLineDash([]);
    }
  }
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Fixes

/** Enroute intersections show up to this range (nm); terminal waypoints (an airport's approach fixes) closer in. */
export const FIX_MAX_RANGE = 20;
export const TERMINAL_FIX_MAX_RANGE = 10;
const FIX_CELL_DEG = 0.5;

const fixGrids = new WeakMap<readonly Fix[], Map<number, Fix[]>>();

const cellKey = (la: number, lo: number) => (la + 400) * 2000 + (lo + 800);

/** Fixes inside a box, from a 0.5-degree grid built the first time a fix list is queried. */
export function fixesInBox(fixes: readonly Fix[], box: ViewBox): Fix[] {
  let grid = fixGrids.get(fixes);
  if (!grid) {
    grid = new Map();
    for (const f of fixes) {
      const k = cellKey(Math.floor(f.lat / FIX_CELL_DEG), Math.floor(f.lon / FIX_CELL_DEG));
      const list = grid.get(k);
      if (list) list.push(f);
      else grid.set(k, [f]);
    }
    fixGrids.set(fixes, grid);
  }
  const out: Fix[] = [];
  for (let la = Math.floor(box.south / FIX_CELL_DEG); la <= Math.floor(box.north / FIX_CELL_DEG); la++) {
    for (let lo = Math.floor(box.west / FIX_CELL_DEG); lo <= Math.floor(box.east / FIX_CELL_DEG); lo++) {
      for (const f of grid.get(cellKey(la, lo)) ?? []) {
        if (f.lat >= box.south && f.lat <= box.north && f.lon >= box.west && f.lon <= box.east) out.push(f);
      }
    }
  }
  return out;
}

/** Small cyan triangles with white identifiers; idents skip where they would overprint other labels. */
export function paintFixes(ctx: CanvasRenderingContext2D, fixes: readonly Fix[], c: OverlayContext, skip: ReadonlySet<string>, color = '#4fd2ff'): void {
  const range = c.rangeNm;
  if (range > FIX_MAX_RANGE || c.declutter >= 3 || fixes.length === 0) return;
  const marks: { ident: string; x: number; y: number }[] = [];
  for (const f of fixesInBox(fixes, c.box)) {
    if (f.region !== 'ENRT' && range > TERMINAL_FIX_MAX_RANGE) continue;
    if (skip.has(f.ident)) continue;
    const s = c.toScreen(f);
    if (onScreen(s, c, 8)) marks.push({ ident: f.ident, ...s });
  }
  // Every triangle first, so no identifier is printed over one.
  ctx.lineWidth = 1.4;
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = color;
  for (const { x, y } of marks) {
    ctx.beginPath();
    ctx.moveTo(x, y - 4.5);
    ctx.lineTo(x + 4, y + 3);
    ctx.lineTo(x - 4, y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    c.labels.reserve(x, y, 10, 10);
  }
  if (c.declutter >= 2) return;
  const size = Math.max(c.fontSize - 2, 10);
  ctx.font = `600 ${size}px ${c.font}`;
  ctx.textBaseline = 'middle';
  for (const { ident, x, y } of marks) {
    const w = ctx.measureText(ident).width;
    if (c.labels.claim(x + 7 + w / 2, y - 7, w + 4, size + 2)) haloText(ctx, ident, x + 7, y - 7, '#ffffff', c.halo);
  }
}

// ---------------------------------------------------------------------------
// Airways

/** Low airways are drawn up to this range (nm) and named up to the second. */
export const AIRWAY_MAX_RANGE = 80;
export const AIRWAY_LABEL_RANGE = 30;

interface AirwayLine {
  readonly name: string;
  readonly fixes: Airway['fixes'];
  readonly bbox: readonly [number, number, number, number];
}

const airwayLines = new WeakMap<readonly Airway[], readonly AirwayLine[]>();

/** Victor and T routes (the low-altitude structure) with their bounding boxes, built once per airway list. */
export function lowAirways(airways: readonly Airway[]): readonly AirwayLine[] {
  let lines = airwayLines.get(airways);
  if (!lines) {
    lines = airways
      .filter((w) => /^[VT]\d/.test(w.name) && w.level !== 'H' && w.fixes.length >= 2)
      .map((w) => {
        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        for (const f of w.fixes) {
          west = Math.min(west, f.lon);
          east = Math.max(east, f.lon);
          south = Math.min(south, f.lat);
          north = Math.max(north, f.lat);
        }
        return { name: w.name, fixes: w.fixes, bbox: [west, south, east, north] as const };
      });
    airwayLines.set(airways, lines);
  }
  return lines;
}

/** Thin grey lines; at short ranges each airway is named once, on its segment nearest the middle of the map. */
export function paintAirways(ctx: CanvasRenderingContext2D, airways: readonly Airway[], c: OverlayContext, color = '#8a8a8a'): void {
  const range = c.rangeNm;
  if (range > AIRWAY_MAX_RANGE || c.declutter >= 3 || airways.length === 0) return;
  const visible = lowAirways(airways).filter(
    (w) => w.bbox[2] >= c.box.west && w.bbox[0] <= c.box.east && w.bbox[3] >= c.box.south && w.bbox[1] <= c.box.north,
  );
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const screens = visible.map((w) => {
    const pts = w.fixes.map(c.toScreen);
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    return pts;
  });
  ctx.stroke();
  if (range > AIRWAY_LABEL_RANGE || c.declutter >= 2) return;

  const size = Math.max(c.fontSize - 3, 10);
  ctx.font = `600 ${size}px ${c.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = c.width / 2;
  const cy = c.height / 2;
  visible.forEach((w, k) => {
    const pts = screens[k]!;
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 80) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!onScreen(mid, c, -20)) continue;
      const d = Math.hypot(mid.x - cx, mid.y - cy);
      if (!best || d < best.d) best = { ...mid, d };
    }
    if (!best) return;
    const tw = ctx.measureText(w.name).width + 8;
    const th = size + 4;
    if (!c.labels.claim(best.x, best.y, tw, th)) return;
    ctx.fillStyle = '#000000';
    ctx.fillRect(best.x - tw / 2, best.y - th / 2, tw, th);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(best.x - tw / 2, best.y - th / 2, tw, th);
    ctx.fillStyle = '#c8c8c8';
    ctx.fillText(w.name, best.x, best.y + 0.5);
  });
  ctx.textAlign = 'left';
}
