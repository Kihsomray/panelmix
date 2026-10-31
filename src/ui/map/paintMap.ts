import { projectNm, toRad, type LatLon } from '../../core/geo';
import type { Airport, Navaid, NavDatabase, Waypoint } from '../../core/navdb';
import type { ActiveLeg } from '../../sim/types';
import { getBasemap } from './basemap';

/*
 * Canvas moving map shared by every navigator and MFD: basemap, airports,
 * navaids, the flight plan (active leg magenta) and the ownship symbol.
 * Devices pick a style and a range; this file knows nothing about any unit.
 */

export interface MapStyle {
  readonly background: string;
  readonly coast: string;
  readonly lakeFill: string;
  readonly states: string;
  readonly borders: string;
  readonly airportTowered: string;
  readonly airportUntowered: string;
  readonly vor: string;
  readonly ndb: string;
  readonly label: string;
  readonly labelHalo: string;
  readonly route: string;
  readonly routeActive: string;
  readonly ownship: string;
  readonly runway: string;
  readonly font: string;
  readonly fontSize: number;
  readonly highlight: string;
}

export const MAP_STYLES = {
  /** G1000 / GTN: black background, blue towered and magenta non-towered airports. */
  garmin: {
    background: '#000000',
    coast: '#3a78c9',
    lakeFill: '#0a2648',
    states: '#5a5a5a',
    borders: '#8a8a8a',
    airportTowered: '#3aa0ff',
    airportUntowered: '#e34fe3',
    vor: '#3aa0ff',
    ndb: '#b07ad0',
    label: '#ffffff',
    labelHalo: '#000000',
    route: '#ffffff',
    routeActive: '#ff40ff',
    ownship: '#ffffff',
    runway: '#d0d0d0',
    font: "'Barlow Semi Condensed', sans-serif",
    fontSize: 13,
    highlight: '#00f0ff',
  },
  /** GNS 430/530: the classic black map with cyan water and white symbols. */
  gns: {
    background: '#000000',
    coast: '#2fa6d8',
    lakeFill: '#06283a',
    states: '#595959',
    borders: '#8c8c8c',
    airportTowered: '#4fb8ff',
    airportUntowered: '#e050e0',
    vor: '#4fb8ff',
    ndb: '#c080c0',
    label: '#ffffff',
    labelHalo: '#000000',
    route: '#ffffff',
    routeActive: '#ff40ff',
    ownship: '#ffffff',
    runway: '#c8c8c8',
    font: "'Barlow Semi Condensed', sans-serif",
    fontSize: 13,
    highlight: '#00f0ff',
  },
} as const satisfies Record<string, MapStyle>;

export interface MapRoute {
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
}

export interface MapOptions {
  readonly width: number;
  readonly height: number;
  readonly db: NavDatabase;
  readonly ownship: { readonly lat: number; readonly lon: number; readonly headingTrue: number } | null;
  /** Center of projection; defaults to the ownship. */
  readonly center?: LatLon;
  /** Distance from the ownship (or center) to the top edge of the map, nm. */
  readonly rangeNm: number;
  /** Map orientation: 0 = north up, or the true track/heading drawn straight up. */
  readonly upTrue: number;
  /** Ownship position as a fraction of the height from the top (0.5 = middle). */
  readonly ownshipAt?: number;
  readonly route?: MapRoute;
  readonly style?: MapStyle;
  /** 0 shows everything; higher values hide small airports, NDBs, then labels. */
  readonly declutter?: number;
  /** Item under the map pointer or cursor. */
  readonly highlight?: Waypoint | null;
  /** Range ring around the ownship at this many nm, labelled. */
  readonly ringNm?: number | null;
}

export interface MapProjection {
  readonly toScreen: (p: LatLon) => { x: number; y: number };
  /** Pixels per nm. */
  readonly scale: number;
}

export function makeProjection(o: MapOptions): MapProjection & { origin: LatLon; ox: number; oy: number } {
  const origin = o.center ?? o.ownship ?? { lat: 0, lon: 0 };
  const at = o.ownshipAt ?? 0.5;
  const oy = o.height * at;
  const ox = o.width / 2;
  const scale = oy / Math.max(o.rangeNm, 0.1);
  const t = toRad(o.upTrue);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return {
    origin,
    ox,
    oy,
    scale,
    toScreen: (p) => {
      const { x, y } = projectNm(origin, p);
      const xr = x * cos - y * sin;
      const yr = x * sin + y * cos;
      return { x: ox + xr * scale, y: oy - yr * scale };
    },
  };
}

interface GeoBox {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

const lineBoxes = new WeakMap<readonly number[], GeoBox>();

/** Whether a flat [lon, lat, ...] line's bounding box overlaps the view box (boxes cached per line). */
function touches(line: readonly number[], box: GeoBox): boolean {
  let b = lineBoxes.get(line);
  if (!b) {
    let south = Infinity;
    let north = -Infinity;
    let west = Infinity;
    let east = -Infinity;
    for (let i = 0; i < line.length; i += 2) {
      const lon = line[i]!;
      const lat = line[i + 1]!;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
    b = { south, north, west, east };
    lineBoxes.set(line, b);
  }
  return b.north >= box.south && b.south <= box.north && b.east >= box.west && b.west <= box.east;
}

function strokeLines(ctx: CanvasRenderingContext2D, lines: readonly (readonly number[])[], proj: MapProjection, box: GeoBox) {
  ctx.beginPath();
  for (const line of lines) {
    if (!touches(line, box)) continue;
    for (let i = 0; i < line.length; i += 2) {
      const s = proj.toScreen({ lon: line[i]!, lat: line[i + 1]! });
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
  }
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: MapStyle, color = style.label) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = style.labelHalo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawAirport(ctx: CanvasRenderingContext2D, a: Airport, x: number, y: number, style: MapStyle, proj: MapProjection) {
  const color = a.towered ? style.airportTowered : style.airportUntowered;
  // Close in, draw the real runways.
  if (proj.scale > 40) {
    ctx.strokeStyle = style.runway;
    ctx.lineCap = 'butt';
    for (const r of a.runways) {
      const [e1, e2] = r.ends;
      if (e1.lat === null || e1.lon === null || e2.lat === null || e2.lon === null) continue;
      const p1 = proj.toScreen({ lat: e1.lat, lon: e1.lon });
      const p2 = proj.toScreen({ lat: e2.lat, lon: e2.lon });
      ctx.lineWidth = Math.max((r.widthFt / 6076) * proj.scale, 2.5);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }
  const rad = a.size === 2 ? 7 : a.size === 1 ? 6 : 5;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  if (a.hardSurface) {
    ctx.stroke();
    // Hard-surface airports get the four "cog" ticks.
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2 + Math.PI / 4;
      ctx.moveTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
      ctx.lineTo(x + Math.cos(ang) * (rad + 3), y + Math.sin(ang) * (rad + 3));
    }
    ctx.stroke();
  } else {
    ctx.stroke();
  }
}

function drawNavaid(ctx: CanvasRenderingContext2D, n: Navaid, x: number, y: number, style: MapStyle) {
  if (n.kind === 'ndb') {
    ctx.fillStyle = style.ndb;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * 6, y + Math.sin(ang) * 6, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = style.vor;
  ctx.fillStyle = style.vor;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2;
    const px = x + Math.cos(ang) * 7;
    const py = y + Math.sin(ang) * 7;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  if (n.type === 'VOR-DME') ctx.strokeRect(x - 8, y - 7, 16, 14);
  if (n.type === 'VORTAC') {
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + Math.PI / 6;
      ctx.save();
      ctx.translate(x + Math.cos(ang) * 8, y + Math.sin(ang) * 8);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawOwnship(ctx: CanvasRenderingContext2D, x: number, y: number, angleDeg: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(toRad(angleDeg));
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(2, -4);
  ctx.lineTo(11, 1);
  ctx.lineTo(11, 4);
  ctx.lineTo(2, 2);
  ctx.lineTo(1.5, 8);
  ctx.lineTo(5, 11);
  ctx.lineTo(5, 13);
  ctx.lineTo(0, 12);
  ctx.lineTo(-5, 13);
  ctx.lineTo(-5, 11);
  ctx.lineTo(-1.5, 8);
  ctx.lineTo(-2, 2);
  ctx.lineTo(-11, 4);
  ctx.lineTo(-11, 1);
  ctx.lineTo(-2, -4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Paints the whole map. Returns the projection so devices can overlay their own symbols. */
export function paintMap(ctx: CanvasRenderingContext2D, o: MapOptions): MapProjection {
  const style = o.style ?? MAP_STYLES.garmin;
  const proj = makeProjection(o);
  const { width: w, height: h } = o;
  const declutter = o.declutter ?? 0;

  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, w, h);

  // Visible area in degrees, generous for rotation.
  const spanNm = Math.hypot(w, h) / proj.scale;
  const latSpan = spanNm / 60;
  const lonSpan = spanNm / (60 * Math.max(Math.cos(toRad(proj.origin.lat)), 0.2));
  const box = {
    south: proj.origin.lat - latSpan,
    north: proj.origin.lat + latSpan,
    west: proj.origin.lon - lonSpan,
    east: proj.origin.lon + lonSpan,
  };

  const base = getBasemap();
  if (base) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.4;
    ctx.fillStyle = style.lakeFill;
    ctx.strokeStyle = style.coast;
    // Lakes: fill then outline.
    for (const ring of base.lakes) {
      if (!touches(ring, box)) continue;
      ctx.beginPath();
      for (let i = 0; i < ring.length; i += 2) {
        const s = proj.toScreen({ lon: ring[i]!, lat: ring[i + 1]! });
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    strokeLines(ctx, base.coast, proj, box);
    ctx.lineWidth = 1;
    ctx.strokeStyle = style.states;
    ctx.setLineDash([6, 4]);
    strokeLines(ctx, base.states, proj, box);
    ctx.setLineDash([]);
    ctx.strokeStyle = style.borders;
    ctx.lineWidth = 1.6;
    strokeLines(ctx, base.borders, proj, box);
  }

  ctx.font = `600 ${style.fontSize}px ${style.font}`;
  ctx.textBaseline = 'middle';
  const range = o.rangeNm;
  const { airports, navaids } = o.db.inBox(box.south, box.west, box.north, box.east);
  const onScreen = (s: { x: number; y: number }) => s.x > -20 && s.x < w + 20 && s.y > -20 && s.y < h + 20;

  // Navaids under airports.
  for (const n of navaids) {
    if (n.kind === 'ndb' && (range > 40 || declutter >= 2)) continue;
    if (n.kind === 'vor' && range > 300) continue;
    const s = proj.toScreen(n);
    if (!onScreen(s)) continue;
    drawNavaid(ctx, n, s.x, s.y, style);
    if (declutter < 3 && range <= 120 && !o.route?.plan.some((w) => w.ident === n.ident)) {
      label(ctx, n.ident, s.x + 10, s.y - 9, style, n.kind === 'vor' ? style.vor : style.ndb);
    }
  }

  const minSize = range > 150 ? 2 : range > 60 ? 1 : 0;
  // Flight plan waypoints get their own labels below.
  const routeIdents = new Set(o.route?.plan.map((w) => w.ident));
  if (o.route?.activeLeg) routeIdents.add(o.route.activeLeg.to.ident);
  for (const a of airports) {
    if (a.size < minSize && !(a.towered && range <= 100)) continue;
    if (declutter >= 1 && !a.hardSurface && a.size === 0) continue;
    const s = proj.toScreen(a);
    if (!onScreen(s)) continue;
    drawAirport(ctx, a, s.x, s.y, style, proj);
    const showLabel = declutter < 3 && !routeIdents.has(a.ident) && (range <= 40 || a.size > 0 || (a.towered && range <= 100));
    if (showLabel) label(ctx, a.ident, s.x + 9, s.y + 11, style);
  }

  // Flight plan: white legs, magenta active leg, labelled waypoints.
  const route = o.route;
  if (route && route.plan.length > 0) {
    const pts = route.plan.map((p) => proj.toScreen(p));
    ctx.lineWidth = 3;
    ctx.strokeStyle = style.route;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    for (let i = 0; i < route.plan.length; i++) {
      const p = pts[i]!;
      if (!onScreen(p)) continue;
      ctx.fillStyle = style.route;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      label(ctx, route.plan[i]!.ident, p.x + 9, p.y - 11, style);
    }
  }
  const leg = route?.activeLeg;
  if (leg) {
    const a = proj.toScreen(leg.from);
    const b = proj.toScreen(leg.to);
    ctx.lineWidth = 4;
    ctx.strokeStyle = style.routeActive;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Arrowhead pointing at the active waypoint.
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.fillStyle = style.routeActive;
    ctx.beginPath();
    ctx.moveTo(mid.x + Math.cos(ang) * 9, mid.y + Math.sin(ang) * 9);
    ctx.lineTo(mid.x + Math.cos(ang + 2.5) * 9, mid.y + Math.sin(ang + 2.5) * 9);
    ctx.lineTo(mid.x + Math.cos(ang - 2.5) * 9, mid.y + Math.sin(ang - 2.5) * 9);
    ctx.fill();
    if (leg.planIndex === null) label(ctx, leg.to.ident, b.x + 9, b.y - 11, style, style.routeActive);
  }

  if (o.highlight) {
    const s = proj.toScreen(o.highlight);
    ctx.strokeStyle = style.highlight;
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x - 11, s.y - 11, 22, 22);
  }

  if (o.ringNm) {
    const r = o.ringNm * proj.scale;
    const own = o.ownship ? proj.toScreen(o.ownship) : { x: w / 2, y: h / 2 };
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(own.x, own.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, formatRange(o.ringNm), own.x - r * 0.72, own.y - r * 0.72, style);
  }

  if (o.ownship) {
    const s = proj.toScreen(o.ownship);
    drawOwnship(ctx, s.x, s.y, o.ownship.headingTrue - o.upTrue, style.ownship);
  }
  return proj;
}

export function formatRange(nm: number): string {
  return nm < 1 ? `${nm}` : `${Number(nm.toFixed(1))}`;
}

/** Garmin range steps, nm. */
export const RANGE_STEPS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500];

export function stepRange(current: number, delta: number, steps: readonly number[] = RANGE_STEPS): number {
  let i = steps.findIndex((s) => s >= current - 1e-9);
  if (i < 0) i = steps.length - 1;
  return steps[Math.min(Math.max(i + delta, 0), steps.length - 1)]!;
}
