import type { LatLon } from '../../../core/geo';
import type { AnyWaypoint, NavDatabase, Waypoint } from '../../../core/navdb';
import type { ActiveLeg } from '../../../sim/types';
import { getBasemap } from '../../../ui/map/basemap';
import { makeProjection, MAP_STYLES, paintMap, type MapStyle } from '../../../ui/map/paintMap';
import { CanvasLayer } from './NativeScreen';

/*
 * A G1000 moving map (PFD inset, MFD pages) on the shared map painter.
 *
 * Garmin quotes the map range as the distance from the top of the map to
 * the bottom, with the airplane in the middle. The canvas repaints only
 * when what it shows moves by about half a pixel, so a map in straight
 * flight repaints a couple of times a second instead of every frame.
 */

export type MapOrientation = 'north' | 'track' | 'heading';

export const ORIENTATION_LABEL: Record<MapOrientation, string> = { north: 'NORTH UP', track: 'TRK UP', heading: 'HDG UP' };

/** Garmin TOPO shading, flattened: the trainer has no terrain elevations. */
const TOPO_STYLE: MapStyle = { ...MAP_STYLES.garmin, background: '#3b4a26', lakeFill: '#123a6a', states: '#23301a' };

export interface MapViewProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly db: NavDatabase;
  readonly ownship: { readonly lat: number; readonly lon: number; readonly headingTrue: number; readonly trackTrue: number };
  /** Top-to-bottom range, nm. */
  readonly rangeNm: number;
  readonly orientation: MapOrientation;
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  /** Changes whenever the plan or the active leg does. */
  readonly planRevision: number;
  readonly declutter: number;
  readonly topo: boolean;
  /** Map centered somewhere other than the airplane (waypoint pages). */
  readonly center?: LatLon;
  readonly highlight?: Waypoint | null;
  /** Map pointer offset from the map center, native px. */
  readonly pointer?: { readonly x: number; readonly y: number } | null;
  readonly label: string;
}

type Orientable = Pick<MapViewProps, 'orientation' | 'ownship'> & { readonly center?: LatLon | undefined };

function upTrue(p: Orientable): number {
  if (p.center || p.orientation === 'north') return 0;
  return p.orientation === 'track' ? p.ownship.trackTrue : p.ownship.headingTrue;
}

/** Pointer movement per joystick click, native px. */
export const POINTER_STEP = 12;
const POINTER_PICK_PX = 16;

/**
 * The airport or navaid under the map pointer (within a few pixels), which
 * the D-> key offers as the destination.
 */
export function pointerTarget(
  db: NavDatabase,
  map: Orientable & { readonly w: number; readonly h: number; readonly rangeNm: number },
  pointer: { readonly x: number; readonly y: number },
): AnyWaypoint | null {
  const proj = makeProjection({
    width: map.w,
    height: map.h,
    db,
    ownship: { ...map.ownship },
    ...(map.center ? { center: map.center } : {}),
    rangeNm: map.rangeNm / 2,
    upTrue: upTrue(map),
    ownshipAt: 0.5,
  });
  const origin = map.center ?? map.ownship;
  const spanDeg = map.rangeNm / 60;
  const lonSpan = spanDeg / Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.2);
  const { airports, navaids } = db.inBox(origin.lat - spanDeg, origin.lon - lonSpan, origin.lat + spanDeg, origin.lon + lonSpan);
  let best: AnyWaypoint | null = null;
  let bestD = POINTER_PICK_PX;
  const px = map.w / 2 + pointer.x;
  const py = map.h / 2 + pointer.y;
  for (const w of [...airports, ...navaids]) {
    const s = proj.toScreen(w);
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < bestD) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

/**
 * Bearing (true) and distance from the airplane at the map center to the
 * pointer: the map is centered on the airplane, so this is the pointer's
 * offset turned back by the map orientation.
 */
export function pointerVector(
  map: Orientable & { readonly h: number; readonly rangeNm: number },
  pointer: { readonly x: number; readonly y: number },
): { bearingTrue: number; distanceNm: number } {
  const pxPerNm = map.h / map.rangeNm;
  const angle = (Math.atan2(pointer.x, -pointer.y) * 180) / Math.PI;
  return { bearingTrue: (((upTrue(map) + angle) % 360) + 360) % 360, distanceNm: Math.hypot(pointer.x, pointer.y) / pxPerNm };
}

export function movePointer(
  pointer: { readonly x: number; readonly y: number },
  dir: 'left' | 'right' | 'up' | 'down',
  w: number,
  h: number,
): { x: number; y: number } {
  const dx = dir === 'left' ? -POINTER_STEP : dir === 'right' ? POINTER_STEP : 0;
  const dy = dir === 'up' ? -POINTER_STEP : dir === 'down' ? POINTER_STEP : 0;
  return {
    x: Math.min(Math.max(pointer.x + dx, -w / 2 + 4), w / 2 - 14),
    y: Math.min(Math.max(pointer.y + dy, -h / 2 + 4), h / 2 - 22),
  };
}

function drawPointer(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(4.5, 13.5);
  ctx.lineTo(8, 21);
  ctx.lineTo(11, 19.5);
  ctx.lineTo(7.5, 12.5);
  ctx.lineTo(13, 12.5);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function MapView(p: MapViewProps) {
  const half = p.rangeNm / 2;
  const up = upTrue(p);
  // Half a pixel of map, in degrees of latitude: finer movement would not show.
  const quantum = Math.max(half / (p.h / 2) / 2 / 60, 1e-6);
  const q = (v: number) => Math.round(v / quantum);
  const drawKey = [
    q(p.ownship.lat),
    q(p.ownship.lon),
    Math.round(up * 2),
    Math.round(p.ownship.headingTrue * 2),
    p.rangeNm,
    p.declutter,
    p.topo ? 1 : 0,
    p.planRevision,
    p.center ? `${p.center.lat},${p.center.lon}` : '',
    p.highlight?.ident ?? '',
    p.pointer ? `${p.pointer.x},${p.pointer.y}` : '',
    getBasemap() ? 1 : 0,
  ].join('|');

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    paintMap(ctx, {
      width: w,
      height: h,
      db: p.db,
      ownship: { lat: p.ownship.lat, lon: p.ownship.lon, headingTrue: p.ownship.headingTrue },
      ...(p.center ? { center: p.center } : {}),
      rangeNm: half,
      upTrue: up,
      ownshipAt: 0.5,
      route: { plan: p.plan, activeLeg: p.activeLeg },
      style: p.topo ? TOPO_STYLE : MAP_STYLES.garmin,
      declutter: p.declutter,
      highlight: p.highlight ?? null,
    });
    if (p.pointer) drawPointer(ctx, w / 2 + p.pointer.x, h / 2 + p.pointer.y);
  };

  return <CanvasLayer x={p.x} y={p.y} w={p.w} h={p.h} drawKey={drawKey} draw={draw} label={p.label} />;
}

/** Map ranges the RANGE knob clicks through, nm (the shortest, sub-mile ranges are left out). */
export const G1000_RANGES = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

export function stepG1000Range(current: number, steps: number): number {
  let i = G1000_RANGES.findIndex((r) => r >= current - 1e-9);
  if (i < 0) i = G1000_RANGES.length - 1;
  return G1000_RANGES[Math.min(Math.max(i + steps, 0), G1000_RANGES.length - 1)]!;
}

/** "1.5", "0.75": the number part of the range box (the unit is NM). */
export function rangeLabel(nm: number): string {
  return String(Number(nm.toFixed(2)));
}
