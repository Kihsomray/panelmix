import { angleDiff, bearing, destination, distanceNm, norm360, projectNm, toRad, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import type { ActiveLeg, RouteLeg } from '../../sim/fms/types';

/*
 * The loaded approach on the moving map: every leg as the path it flies,
 * the active leg magenta and the others white, the missed approach dashed
 * until it is flown, holds as racetracks, RF and DME arcs as arcs, and legs
 * that end at an altitude, a heading intercept or a manual termination as
 * short vectors along their course.
 *
 * Geometry is worked out once per approach (the legs array is replaced
 * whenever the approach changes) with a bounding box per leg for culling.
 */

/** Speed holds and procedure turns are drawn for: the trainer's airplanes fly approaches at about 90 kt. */
export const DRAW_SPEED_KT = 90;
/** Standard-rate turn radius at that speed, nm. */
export const DRAW_TURN_RADIUS_NM = DRAW_SPEED_KT / (60 * Math.PI);
/** Climb gradient used to size climb-to-altitude legs, ft per nm. */
const CLIMB_FT_PER_NM = 400;
/** Length of open legs (heading to a manual termination, intercepts with nothing to meet), nm. */
const VECTOR_NM = 3;
/** Stub drawn into a first leg's fix along its course when nothing precedes it, nm. */
const LEAD_IN_NM = 3;
/** Arcs are drawn as chords this many degrees apart. */
const ARC_STEP_DEG = 5;

export interface LegPath {
  readonly index: number;
  readonly leg: RouteLeg;
  /** The leg's track, one point for a lone IF. */
  readonly points: readonly LatLon[];
  /** A racetrack (closed loop through the holding fix). */
  readonly hold: boolean;
  /** [west, south, east, north] */
  readonly bbox: readonly [number, number, number, number];
}

const NM_PER_DEG = 60.04;

/** A point `east` and `north` nm from `origin` (flat frame, fine for a few miles). */
function offset(origin: LatLon, east: number, north: number): LatLon {
  return { lat: origin.lat + north / NM_PER_DEG, lon: origin.lon + east / (NM_PER_DEG * Math.cos(toRad(origin.lat))) };
}

/**
 * A holding pattern as a closed polyline starting and ending at the fix, in
 * flying order: the turn at the fix to the holding side, the outbound leg,
 * the turn back, the inbound leg. Same layout as the FMS racetrack
 * (src/sim/fms/hold.ts): inbound leg from `legNm` before the fix to the fix,
 * outbound leg offset two radii toward the turn side.
 */
export function holdRacetrack(fix: LatLon, inboundTrue: number, turn: 'L' | 'R', legNm: number, radiusNm = DRAW_TURN_RADIUS_NM): LatLon[] {
  const c = toRad(inboundTrue);
  const u = { e: Math.sin(c), n: Math.cos(c) };
  const sign = turn === 'R' ? 1 : -1;
  // Toward the holding side: right of the inbound course for right turns.
  const s = { e: Math.cos(c) * sign, n: -Math.sin(c) * sign };
  const at = (a: number, b: number) => offset(fix, u.e * a + s.e * b, u.n * a + s.n * b);
  const out: LatLon[] = [];
  const steps = Math.round(180 / ARC_STEP_DEG);
  // Turn at the fix around (0, r): from the fix (angle 180 deg in the u/s frame) to (0, 2r).
  for (let k = 0; k <= steps; k++) {
    const t = Math.PI - (Math.PI * k) / steps;
    out.push(at(radiusNm * Math.sin(t), radiusNm + radiusNm * Math.cos(t)));
  }
  // Outbound leg to (-L, 2r), then the turn around (-L, r) back to (-L, 0).
  for (let k = 0; k <= steps; k++) {
    const t = (Math.PI * k) / steps;
    out.push(at(-legNm - radiusNm * Math.sin(t), radiusNm + radiusNm * Math.cos(t)));
  }
  // Inbound leg back to the fix.
  out.push({ lat: fix.lat, lon: fix.lon });
  return out;
}

/** Straight leg length of a hold: the published distance, else the leg time at the drawing speed (1 min below 14,000 ft). */
export function holdLegNm(leg: RouteLeg): number {
  if (leg.distanceNm !== undefined && leg.distanceNm > 0) return leg.distanceNm;
  const alt = constraintFt(leg);
  const minutes = leg.legTimeMin ?? (alt !== null && alt > 14000 ? 1.5 : 1);
  return (DRAW_SPEED_KT * minutes) / 60;
}

/** Points along an arc around `center` from `from` to `to`, turning `turn` (R = clockwise). */
export function arcPoints(center: LatLon, from: LatLon, to: LatLon, turn: 'L' | 'R' | undefined, radiusNm?: number): LatLon[] {
  const r = radiusNm ?? distanceNm(center, to);
  const b0 = bearing(center, from);
  const b1 = bearing(center, to);
  const sweep = turn === 'R' ? norm360(b1 - b0) : turn === 'L' ? -norm360(b0 - b1) : angleDiff(b1, b0);
  const n = Math.max(Math.ceil(Math.abs(sweep) / ARC_STEP_DEG), 1);
  const pts: LatLon[] = [from];
  for (let k = 1; k < n; k++) pts.push(destination(center, b0 + (sweep * k) / n, r));
  pts.push(to);
  return pts;
}

/** Where a ray from `p` on `courseTrue` meets the line through `q` on `lineTrue`, nm along the ray; null if parallel or behind. */
function rayLineNm(p: LatLon, courseTrue: number, q: LatLon, lineTrue: number): number | null {
  const d1 = { x: Math.sin(toRad(courseTrue)), y: Math.cos(toRad(courseTrue)) };
  const d2 = { x: Math.sin(toRad(lineTrue)), y: Math.cos(toRad(lineTrue)) };
  const qv = projectNm(p, q);
  const det = d2.x * d1.y - d1.x * d2.y;
  if (Math.abs(det) < 1e-6) return null;
  const t = (d2.x * qv.y - qv.x * d2.y) / det;
  return t > 0 ? t : null;
}

/** Where a ray from `p` on `courseTrue` first reaches `radiusNm` from `center` (a DME distance), nm along the ray. */
function rayCircleNm(p: LatLon, courseTrue: number, center: LatLon, radiusNm: number): number | null {
  const c = projectNm(p, center);
  const d = { x: Math.sin(toRad(courseTrue)), y: Math.cos(toRad(courseTrue)) };
  const along = c.x * d.x + c.y * d.y;
  const disc = along * along - (c.x * c.x + c.y * c.y - radiusNm * radiusNm);
  if (disc < 0) return null;
  const roots = [along - Math.sqrt(disc), along + Math.sqrt(disc)].filter((t) => t > 0.05);
  return roots.length ? Math.min(...roots) : null;
}

function constraintFt(leg: RouteLeg): number | null {
  const a = leg.altitude;
  if (!a) return null;
  return a.kind === 'between' ? a.aboveFt : a.ft;
}

const courseOf = (leg: RouteLeg): number | null => leg.courseTrue ?? leg.courseMag ?? null;

function bboxOf(points: readonly LatLon[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

/**
 * The path of every leg, chained: each leg starts where the previous one
 * ended. Courses are the legs' true courses (`courseTrue`, resolved by the
 * FMS when the approach is loaded; `courseMag` is used as is without it).
 */
export function approachPaths(legs: readonly RouteLeg[]): LegPath[] {
  const paths: LegPath[] = [];
  let pos: LatLon | null = null;
  let altFt: number | null = null;
  legs.forEach((leg, index) => {
    const crs = courseOf(leg);
    let points: LatLon[] = [];
    let hold = false;
    const vector = (origin: LatLon, course: number, nm: number) => [origin, destination(origin, course, Math.min(Math.max(nm, 0.5), 25))];
    switch (leg.path) {
      case 'IF':
        if (leg.to) points = [leg.to];
        break;
      case 'TF':
      case 'CF':
      case 'DF':
        if (leg.to) {
          if (pos) points = [pos, leg.to];
          else if (crs !== null) points = [destination(leg.to, crs + 180, LEAD_IN_NM), leg.to];
          else points = [leg.to];
        }
        break;
      case 'RF':
      case 'AF':
        if (leg.to && pos && leg.arcCenter) points = arcPoints(leg.arcCenter, pos, leg.to, leg.turn, leg.arcRadiusNm);
        else if (leg.to) points = pos ? [pos, leg.to] : [leg.to];
        break;
      case 'HM':
      case 'HA':
      case 'HF': {
        const fix = leg.to ?? pos;
        if (fix && crs !== null) {
          points = holdRacetrack(fix, crs, leg.turn ?? 'R', holdLegNm(leg));
          hold = true;
        }
        break;
      }
      case 'PI': {
        // Procedure turn barb: the 45 degree leg away from the fix, the 180 degree turn, and part of the way back.
        const fix = leg.to ?? pos;
        if (fix && crs !== null) {
          const away = destination(fix, crs, 2);
          const sign = leg.turn === 'L' ? -1 : 1;
          const center = destination(away, crs + 90 * sign, DRAW_TURN_RADIUS_NM);
          const back = destination(away, crs + 90 * sign, 2 * DRAW_TURN_RADIUS_NM);
          points = [fix, ...arcPoints(center, away, back, leg.turn ?? 'R', DRAW_TURN_RADIUS_NM), destination(back, crs + 180, 1.5)];
        }
        break;
      }
      default: {
        // Legs that end at an altitude, a distance, a radial, an intercept or manually: a vector on the course.
        const origin: LatLon | null = (leg.path.startsWith('F') ? leg.to : null) ?? pos;
        if (!origin || crs === null) break;
        const next = legs[index + 1];
        const target = constraintFt(leg);
        const within = (t: number | null, fallback: number) => (t !== null && t < 25 ? t : fallback);
        switch (leg.path) {
          case 'CA':
          case 'FA':
          case 'VA':
            points = vector(origin, crs, target !== null && altFt !== null ? (target - altFt) / CLIMB_FT_PER_NM : 2);
            break;
          case 'CI':
          case 'VI':
            points = vector(origin, crs, next?.to ? within(rayLineNm(origin, crs, next.to, courseOf(next) ?? bearing(origin, next.to)), VECTOR_NM) : VECTOR_NM);
            break;
          case 'CR':
          case 'VR':
            points = vector(origin, crs, leg.navaid && leg.radialTrue !== undefined ? within(rayLineNm(origin, crs, leg.navaid, leg.radialTrue), VECTOR_NM) : VECTOR_NM);
            break;
          case 'FD':
          case 'CD':
          case 'VD':
            // To a DME distance from the navaid when there is one, else that far along the course.
            points = vector(origin, crs, leg.navaid && leg.distanceNm !== undefined ? within(rayCircleNm(origin, crs, leg.navaid, leg.distanceNm), leg.distanceNm) : leg.distanceNm ?? VECTOR_NM);
            break;
          case 'FM':
          case 'VM':
            points = vector(origin, crs, VECTOR_NM + 1);
            break;
          default:
            points = vector(origin, crs, leg.distanceNm ?? VECTOR_NM);
        }
      }
    }
    if (points.length > 0) {
      paths.push({ index, leg, points, hold, bbox: bboxOf(points) });
      // A hold and a procedure turn come back to their fix; everything else ends at its last point.
      pos = hold || leg.path === 'PI' ? points[0]! : points[points.length - 1]!;
    }
    altFt = constraintFt(leg) ?? altFt;
  });
  return paths;
}

const cache = new WeakMap<readonly RouteLeg[], LegPath[]>();

/** `approachPaths`, worked out once per legs array. */
export function cachedApproachPaths(legs: readonly RouteLeg[]): readonly LegPath[] {
  let p = cache.get(legs);
  if (!p) {
    p = approachPaths(legs);
    cache.set(legs, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Drawing

export interface ApproachLayerOptions {
  readonly legs: readonly RouteLeg[];
  /** Index of the active leg in `legs` (derived.approach.activeLegIndex), or null. */
  readonly activeIndex: number | null;
}

export interface ApproachDrawContext {
  readonly toScreen: (p: LatLon) => { x: number; y: number };
  readonly box: { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
  readonly width: number;
  readonly height: number;
  readonly white: string;
  readonly magenta: string;
  readonly label: (text: string, x: number, y: number, color?: string) => void;
  /** The FMS active leg, when it is this approach's: its real start replaces the drawn one. */
  readonly activeLeg: ActiveLeg | null;
  /** Last enroute waypoint, joined to the approach's first fix. */
  readonly enrouteEnd: Waypoint | null;
}

/** Fix-to-fix legs: drawn from where the FMS started them when active (a direct-to, an activated leg). */
const LINE_TYPES = new Set(['IF', 'TF', 'CF', 'DF']);
/** Legs whose end the FMS computes when it activates them: drawn from its start to its end when active. */
const VECTOR_TYPES = new Set(['CA', 'FA', 'VA', 'CI', 'VI', 'CR', 'VR', 'FD', 'CD', 'VD', 'FC', 'FM', 'VM']);

function overlaps(b: LegPath['bbox'], box: ApproachDrawContext['box']): boolean {
  return b[2] >= box.west && b[0] <= box.east && b[3] >= box.south && b[1] <= box.north;
}

function arrowhead(ctx: CanvasRenderingContext2D, pts: readonly { x: number; y: number }[], color: string) {
  // At the middle of the drawn path, pointing along it.
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  if (total < 30) return;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + seg >= total / 2) {
      const f = (total / 2 - run) / seg;
      const mid = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(mid.x + Math.cos(ang) * 9, mid.y + Math.sin(ang) * 9);
      ctx.lineTo(mid.x + Math.cos(ang + 2.5) * 9, mid.y + Math.sin(ang + 2.5) * 9);
      ctx.lineTo(mid.x + Math.cos(ang - 2.5) * 9, mid.y + Math.sin(ang - 2.5) * 9);
      ctx.fill();
      return;
    }
    run += seg;
  }
}

/** Draws the approach: white legs and fixes first, the active leg on top. */
export function paintApproach(ctx: CanvasRenderingContext2D, a: ApproachLayerOptions, d: ApproachDrawContext): void {
  const paths = cachedApproachPaths(a.legs);
  if (paths.length === 0) return;
  const active = d.activeLeg && d.activeLeg.approachIndex === a.activeIndex ? d.activeLeg : null;

  const stroke = (pts: readonly LatLon[], color: string, width: number, dashed: boolean) => {
    const s = pts.map(d.toScreen);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [8, 6] : []);
    ctx.beginPath();
    s.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    return s;
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // From the end of the enroute plan to the first approach fix, unless that is the active leg.
  const first = paths[0]!;
  if (d.enrouteEnd && a.activeIndex !== first.index && first.leg.to) stroke([d.enrouteEnd, first.leg.to], d.white, 3, false);

  let activePath: readonly LatLon[] | null = null;
  let activeHold = false;
  for (const p of paths) {
    if (p.index === a.activeIndex) {
      activePath = p.points;
      activeHold = p.hold;
      if (active && LINE_TYPES.has(p.leg.path) && p.leg.to) activePath = [active.from, p.leg.to];
      else if (active && VECTOR_TYPES.has(p.leg.path) && distanceNm(active.from, active.to) > 0.05) activePath = [active.from, active.to];
      continue;
    }
    if (p.points.length < 2 || !overlaps(p.bbox, d.box)) continue;
    stroke(p.points, d.white, 3, p.leg.segment === 'missed');
  }
  ctx.setLineDash([]);

  // Fix symbols and names, each fix once (a missed approach hold sits on the missed approach fix).
  const named = new Set<string>();
  const activeTo = a.activeIndex !== null ? a.legs[a.activeIndex]?.to?.ident : undefined;
  for (const p of paths) {
    const fix = p.leg.to;
    if (!fix || named.has(fix.ident)) continue;
    named.add(fix.ident);
    const s = d.toScreen(fix);
    if (s.x < -20 || s.y < -20 || s.x > d.width + 20 || s.y > d.height + 20) continue;
    const isActive = fix.ident === activeTo;
    ctx.fillStyle = isActive ? d.magenta : d.white;
    ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    d.label(fix.ident, s.x + 9, s.y - 11, isActive ? d.magenta : d.white);
  }

  if (activePath && activePath.length >= 2) {
    const s = stroke(activePath, d.magenta, 4, false);
    if (!activeHold) arrowhead(ctx, s, d.magenta);
  }
  ctx.lineCap = 'butt';
}
