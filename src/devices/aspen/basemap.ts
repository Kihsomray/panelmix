import { projectNm, toRad, type LatLon } from '../../core/geo';
import type { Airport, Navaid, Waypoint } from '../../core/navdb';
import type { ActiveLeg } from '../../sim/types';
import type { MapSettings } from './settings';

/*
 * The Aspen situational awareness map (Pilot's Guide 2.3.4.9 and figure
 * 4-90): heading-up, centered on the ownship, scaled so the range reaches
 * the compass scale, with the Aspen's white symbol set (stars for flight
 * plan waypoints, magenta for the active leg and waypoint) drawn under the
 * compass. No coastlines or terrain: the real unit shows only these
 * symbols.
 */

export interface BasemapFeatures {
  readonly airports: readonly Airport[];
  readonly navaids: readonly Navaid[];
}

export interface BasemapView {
  /** Ownship on screen, display px. */
  readonly cx: number;
  readonly cy: number;
  readonly pxPerNm: number;
  /** True heading drawn straight up. */
  readonly upTrue: number;
  readonly ownship: LatLon;
  readonly rangeNm: number;
}

/** Feature limits per range (Table 5-12): the farthest range each group is drawn at. */
const MAX_RANGE_NM = { fpl: 200, apt: 100, vor: 200, ndb: 15 } as const;

export function project(view: BasemapView, p: LatLon): { x: number; y: number } {
  const { x, y } = projectNm(view.ownship, p);
  const t = toRad(view.upTrue);
  const xr = x * Math.cos(t) - y * Math.sin(t);
  const yr = x * Math.sin(t) + y * Math.cos(t);
  return { x: view.cx + xr * view.pxPerNm, y: view.cy - yr * view.pxPerNm };
}

/**
 * Which groups show at this range and declutter level: level 4 everything,
 * 3 drops NDBs, 2 keeps only the flight plan and VORs, 1 the flight plan,
 * 0 nothing. The menu's OFF/AUTO switches remove groups entirely.
 */
export function visibleGroups(m: MapSettings, rangeNm: number): { fpl: boolean; apt: boolean; vor: boolean; ndb: boolean } {
  const level = m.declutter;
  return {
    fpl: level >= 1 && m.show.fpl && rangeNm <= MAX_RANGE_NM.fpl,
    vor: level >= 2 && m.show.vor && rangeNm <= MAX_RANGE_NM.vor,
    apt: level >= 3 && m.show.apt && rangeNm <= MAX_RANGE_NM.apt,
    ndb: level >= 4 && m.show.ndb && rangeNm <= MAX_RANGE_NM.ndb,
  };
}

const WHITE = '#ffffff';
const MAGENTA = '#ff45ff';
const FONT = "600 13px 'Barlow Semi Condensed', sans-serif";

/** Label widths by identifier: measuring text every frame is the costliest part of the map. */
const widths = new Map<string, number>();

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  let w = widths.get(text);
  if (w === undefined) {
    w = ctx.measureText(text).width + 6;
    widths.set(text, w);
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y - 8, w, 16);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y - 8, w, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 3, y + 5);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 9);
  ctx.lineTo(x + 2.5, y - 2.5);
  ctx.lineTo(x + 9, y);
  ctx.lineTo(x + 2.5, y + 2.5);
  ctx.lineTo(x, y + 9);
  ctx.lineTo(x - 2.5, y + 2.5);
  ctx.lineTo(x - 9, y);
  ctx.lineTo(x - 2.5, y - 2.5);
  ctx.closePath();
  ctx.fill();
}

function airport(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
    ctx.lineTo(x + Math.cos(a) * 8.5, y + Math.sin(a) * 8.5);
  }
  ctx.stroke();
}

function navaid(ctx: CanvasRenderingContext2D, n: Navaid, x: number, y: number) {
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = 1.8;
  if (n.kind === 'ndb') {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const px = x + Math.cos(a) * 7;
      const py = y + Math.sin(a) * 7;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    // A VORTAC or VOR/DME is the VOR inside the DME square.
    if (n.hasDme) ctx.strokeRect(x - 9, y - 9, 18, 18);
  }
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBasemap(
  ctx: CanvasRenderingContext2D,
  view: BasemapView,
  features: BasemapFeatures,
  route: { readonly plan: readonly Waypoint[]; readonly activeLeg: ActiveLeg | null },
  settings: MapSettings,
  bounds: { readonly top: number; readonly bottom: number },
) {
  const groups = visibleGroups(settings, view.rangeNm);
  const onScreen = (p: { x: number; y: number }) => p.x > -30 && p.x < 430 && p.y > bounds.top - 30 && p.y < bounds.bottom + 30;
  ctx.textBaseline = 'alphabetic';
  ctx.font = FONT;
  const labels = view.rangeNm <= 30;

  if (groups.vor) {
    for (const n of features.navaids) {
      if (n.kind !== 'vor') continue;
      const s = project(view, n);
      if (!onScreen(s)) continue;
      navaid(ctx, n, s.x, s.y);
      if (view.rangeNm <= 60) label(ctx, n.ident, s.x + 11, s.y - 10, WHITE);
    }
  }
  if (groups.ndb) {
    for (const n of features.navaids) {
      if (n.kind !== 'ndb') continue;
      const s = project(view, n);
      if (onScreen(s)) navaid(ctx, n, s.x, s.y);
    }
  }
  if (groups.apt) {
    // Flight plan waypoints carry their own labels.
    const planned = new Set(groups.fpl ? route.plan.map((w) => w.ident) : []);
    for (const a of features.airports) {
      // Farther out, only the bigger fields.
      if (view.rangeNm > 30 && a.size === 0) continue;
      const s = project(view, a);
      if (!onScreen(s)) continue;
      airport(ctx, s.x, s.y);
      if (labels && !planned.has(a.ident)) label(ctx, a.ident, s.x + 10, s.y + 12, WHITE);
    }
  }
  if (groups.fpl) {
    const leg = route.activeLeg;
    const pts = route.plan.map((w) => project(view, w));
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    if (leg) {
      const a = project(view, leg.from);
      const b = project(view, leg.to);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = MAGENTA;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    route.plan.forEach((w, i) => {
      const p = pts[i]!;
      if (!onScreen(p)) return;
      const active = leg !== null && leg.to.ident === w.ident && leg.planIndex === i;
      star(ctx, p.x, p.y, active ? MAGENTA : WHITE);
      label(ctx, w.ident, p.x + 11, p.y - 11, active ? MAGENTA : WHITE);
    });
    if (leg && leg.planIndex === null) {
      const p = project(view, leg.to);
      if (onScreen(p)) {
        star(ctx, p.x, p.y, MAGENTA);
        label(ctx, leg.to.ident, p.x + 11, p.y - 11, MAGENTA);
      }
    }
  }
}

/**
 * The lat/lon box to query: the display corners reach about 1.8 ranges from
 * the ownship in any rotation, plus slack for the airplane moving before the
 * cached query is refreshed.
 */
export function queryBox(center: LatLon, rangeNm: number): { south: number; west: number; north: number; east: number } {
  const spanNm = rangeNm * 1.9 + 8;
  const dLat = spanNm / 60;
  const dLon = spanNm / (60 * Math.max(Math.cos(toRad(center.lat)), 0.2));
  return { south: center.lat - dLat, west: center.lon - dLon, north: center.lat + dLat, east: center.lon + dLon };
}
