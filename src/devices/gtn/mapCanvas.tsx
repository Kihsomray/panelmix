import { Component } from 'preact';
import { toRad, type LatLon } from '../../core/geo';
import type { NavDatabase, Waypoint } from '../../core/navdb';
import type { ActiveLeg } from '../../sim/types';
import { ScreenCanvas } from '../../ui/Screen';
import { getBasemap } from '../../ui/map/basemap';
import { makeProjection, MAP_STYLES, paintMap, type MapOptions } from '../../ui/map/paintMap';

/*
 * The GTN moving map on a canvas: the shared basemap and aeronautical layers
 * plus the GTN's own NAV range ring (a magnetic compass around the ownship
 * with the range written in it) and the dashed cyan track vector.
 *
 * The device re-renders every simulation frame; the map is only repainted
 * when its picture would visibly change (see `mapVersion`).
 */

export interface MapPicture {
  readonly db: NavDatabase;
  readonly center: LatLon;
  readonly ownship: { readonly lat: number; readonly lon: number; readonly headingTrue: number } | null;
  /** Range ring radius, nm. */
  readonly ringNm: number;
  /** Ring radius as a share of the smaller map dimension. */
  readonly ringShare: number;
  readonly upTrue: number;
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  readonly declutter: number;
  readonly highlight: Waypoint | null;
  /** Draw the compass ring and track vector (the moving map, not a preview). */
  readonly navRing: boolean;
  readonly magVar: number;
  readonly trackTrue: number;
  readonly groundSpeedKt: number;
}

/** The nm from the map centre to its top edge that puts the ring where the GTN draws it. */
function mapOptions(p: MapPicture, w: number, h: number): MapOptions {
  const ringPx = Math.min(w, h) * p.ringShare;
  return {
    width: w,
    height: h,
    db: p.db,
    ownship: p.ownship,
    center: p.center,
    rangeNm: (p.ringNm * (h / 2)) / ringPx,
    upTrue: p.upTrue,
    ownshipAt: 0.5,
    route: { plan: p.plan, activeLeg: p.activeLeg },
    style: MAP_STYLES.garmin,
    declutter: p.declutter,
    highlight: p.highlight,
  };
}

/** Screen position back to latitude and longitude (the flat projection the map uses). */
export function screenToLatLon(p: MapPicture, w: number, h: number, x: number, y: number): LatLon {
  const proj = makeProjection(mapOptions(p, w, h));
  const xr = (x - proj.ox) / proj.scale;
  const yr = (proj.oy - y) / proj.scale;
  const t = toRad(p.upTrue);
  const east = xr * Math.cos(t) + yr * Math.sin(t);
  const north = -xr * Math.sin(t) + yr * Math.cos(t);
  const lat = proj.origin.lat + north / 60.04;
  const lon = proj.origin.lon + east / (60.04 * Math.max(Math.cos(toRad((lat + proj.origin.lat) / 2)), 0.2));
  return { lat, lon };
}

const RING_LABELS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

function drawNavRing(ctx: CanvasRenderingContext2D, p: MapPicture, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `600 ${Math.max(10, r * 0.11)}px 'Barlow Semi Condensed', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Magnetic card: screen angle of a magnetic bearing.
  for (let mag = 0; mag < 360; mag += 10) {
    const a = toRad(mag + p.magVar - p.upTrue);
    const long = mag % 30 === 0;
    const inner = r - (long ? 9 : 5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.stroke();
    const label = RING_LABELS[mag];
    if (label) {
      const lr = r - 17;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, cx + Math.sin(a) * lr, cy - Math.cos(a) * lr);
      ctx.fillText(label, cx + Math.sin(a) * lr, cy - Math.cos(a) * lr);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    }
  }
  // Range written on the ring in its upper left quadrant, on a black tab.
  const la = toRad(-55);
  const text = `${p.ringNm < 1 ? p.ringNm : Number(p.ringNm.toFixed(1))}NM`;
  ctx.font = `700 ${Math.max(11, r * 0.11)}px 'Barlow Semi Condensed', sans-serif`;
  const lx = cx + Math.sin(la) * r;
  const ly = cy - Math.cos(la) * r;
  const tw = ctx.measureText(text).width + 6;
  const th = Math.max(11, r * 0.11) + 4;
  ctx.fillStyle = '#000';
  ctx.fillRect(lx - tw / 2, ly - th / 2, tw, th);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, lx, ly + 0.5);
  // Lubber triangle at the current track, drawn last so the range tab never hides it.
  const ta = toRad(p.trackTrue - p.upTrue);
  ctx.beginPath();
  ctx.moveTo(cx + Math.sin(ta) * (r + 1), cy - Math.cos(ta) * (r + 1));
  ctx.lineTo(cx + Math.sin(ta - 0.06) * (r + 10), cy - Math.cos(ta - 0.06) * (r + 10));
  ctx.lineTo(cx + Math.sin(ta + 0.06) * (r + 10), cy - Math.cos(ta + 0.06) * (r + 10));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTrackVector(ctx: CanvasRenderingContext2D, p: MapPicture, cx: number, cy: number, pxPerNm: number) {
  if (p.groundSpeedKt < 20) return;
  // One minute of flight along the ground track.
  const len = (p.groundSpeedKt / 60) * pxPerNm;
  const a = toRad(p.trackTrue - p.upTrue);
  ctx.save();
  ctx.strokeStyle = '#2fd7ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(cx + Math.sin(a) * 14, cy - Math.cos(a) * 14);
  ctx.lineTo(cx + Math.sin(a) * (14 + len), cy - Math.cos(a) * (14 + len));
  ctx.stroke();
  ctx.restore();
}

function drawGtnMap(ctx: CanvasRenderingContext2D, p: MapPicture, w: number, h: number): void {
  const proj = paintMap(ctx, mapOptions(p, w, h));
  if (!p.navRing || !p.ownship) return;
  const o = proj.toScreen(p.ownship);
  drawTrackVector(ctx, p, o.x, o.y, proj.scale);
  drawNavRing(ctx, p, o.x, o.y, Math.min(w, h) * p.ringShare);
}

/**
 * Quantised summary of a picture: equal versions draw the same pixels, so the
 * canvas skips repainting (positions to a pixel, angles to half a degree).
 */
export function mapVersion(p: MapPicture, w: number, h: number, planRevision: number): string {
  const pxPerNm = (Math.min(w, h) * p.ringShare) / p.ringNm;
  const q = 60 * pxPerNm; // pixels per degree of latitude
  const cos = Math.cos(toRad(p.center.lat));
  const own = p.ownship ? `${Math.round(p.ownship.lat * q)}:${Math.round(p.ownship.lon * q * cos)}:${Math.round(p.ownship.headingTrue * 2)}` : '-';
  return [
    Math.round(p.center.lat * q),
    Math.round(p.center.lon * q * cos),
    own,
    p.ringNm,
    Math.round(p.upTrue * 2),
    Math.round(p.trackTrue * 2),
    Math.round(p.groundSpeedKt / 5),
    planRevision,
    p.declutter,
    p.highlight ? `${p.highlight.kind}${p.highlight.ident}` : '',
    w,
    h,
    // Repaint once the coastline and borders have loaded.
    getBasemap() ? 1 : 0,
  ].join('|');
}

interface MapCanvasProps {
  readonly w: number;
  readonly h: number;
  readonly picture: MapPicture;
  readonly version: string;
  readonly label: string;
}

/** Repaints only when `version` changes, though its parent renders every frame. */
export class MapCanvas extends Component<MapCanvasProps> {
  override shouldComponentUpdate(next: MapCanvasProps): boolean {
    return next.version !== this.props.version;
  }

  override render() {
    const { w, h, picture, label } = this.props;
    return <ScreenCanvas w={w} h={h} label={label} draw={(ctx, cw, ch) => drawGtnMap(ctx, picture, cw, ch)} />;
  }
}
