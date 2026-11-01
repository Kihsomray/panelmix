import { alongTrackNm, bearing, crossTrackNm, destination, distanceNm, EARTH_RADIUS_NM, FT_PER_NM, norm360, toDeg, toRad, type LatLon } from '../../core/geo';

/*
 * Geometry for flying procedure legs: course lines, arcs, turn radii and the
 * small flat frame holds are laid out in. Courses are degrees true,
 * distances nm. Great-circle math is used wherever a leg can be long; the
 * flat frame only for patterns a few miles across.
 */

const G_FTS2 = 32.174;
const KT_TO_FTS = 1.68781;

/** Bank the FMS plans fly-by turns with; the autopilot itself is limited to 22 degrees. */
export const PLANNED_BANK_DEG = 20;

/** Radius of a coordinated turn at a ground speed and bank, nm. */
export function turnRadiusNm(groundSpeedKt: number, bankDeg = PLANNED_BANK_DEG): number {
  const v = Math.max(groundSpeedKt, 40) * KT_TO_FTS;
  return (v * v) / (G_FTS2 * Math.tan(toRad(bankDeg))) / FT_PER_NM;
}

/** Standard-rate (3 degrees per second) turn radius, nm. */
export function standardRateRadiusNm(speedKt: number): number {
  return Math.max(speedKt, 40) / (60 * Math.PI);
}

/** Bank that holds a ground track of `radiusNm` at a ground speed, degrees. */
export function arcBankDeg(groundSpeedKt: number, radiusNm: number): number {
  const v = Math.max(groundSpeedKt, 30) * KT_TO_FTS;
  return toDeg(Math.atan((v * v) / (G_FTS2 * Math.max(radiusNm, 0.05) * FT_PER_NM)));
}

/** Distance before a fly-by waypoint at which the turn onto the next leg begins. */
export function turnAnticipationNm(groundSpeedKt: number, turnDeg: number): number {
  const turn = Math.abs(turnDeg);
  if (turn < 5) return 0.05;
  return Math.min(turnRadiusNm(groundSpeedKt) * Math.tan(toRad(Math.min(turn, 120) / 2)), 3);
}

/** Where the airplane is relative to a course line through `origin`. */
export interface LinePosition {
  /** Positive right of the course. */
  readonly xtkNm: number;
  /** Along the course from `origin`; negative before it. */
  readonly alongNm: number;
  /** Course of the line at the point abeam the airplane. */
  readonly dtkTrue: number;
}

const LINE_NM = 100;

export function onCourseLine(origin: LatLon, courseTrue: number, pos: LatLon): LinePosition {
  const far = destination(origin, courseTrue, LINE_NM);
  const xtkNm = crossTrackNm(origin, far, pos);
  const alongNm = alongTrackNm(origin, far, pos);
  const dtkTrue = alongNm < LINE_NM - 1 ? bearing(destination(origin, courseTrue, alongNm), far) : courseTrue;
  return { xtkNm, alongNm, dtkTrue };
}

/** Where the airplane is relative to an arc flown from `start` to `end` around `center`. */
export interface ArcPosition {
  /** Positive right of the direction of flight along the arc. */
  readonly xtkNm: number;
  /** Tangent course abeam the airplane. */
  readonly dtkTrue: number;
  /** Along the arc to `end`; negative once passed. */
  readonly remainingNm: number;
}

export function onArc(center: LatLon, radiusNm: number, turn: 'L' | 'R', start: LatLon, end: LatLon, pos: LatLon): ArcPosition {
  const sweep = (fromDeg: number, toDegs: number) => (turn === 'R' ? norm360(toDegs - fromDeg) : norm360(fromDeg - toDegs));
  const startBrg = bearing(center, start);
  const brg = bearing(center, pos);
  const total = sweep(startBrg, bearing(center, end));
  let progressed = sweep(startBrg, brg);
  // Positions behind the start of the arc read as almost a full circle: count them as negative progress.
  if (progressed > total + (360 - total) / 2) progressed -= 360;
  const d = distanceNm(center, pos);
  return {
    xtkNm: turn === 'R' ? radiusNm - d : d - radiusNm,
    dtkTrue: norm360(brg + (turn === 'R' ? 90 : -90)),
    remainingNm: toRad(total - progressed) * radiusNm,
  };
}

/** Course of the arc's tangent at a point on it. */
export function arcTangentTrue(center: LatLon, turn: 'L' | 'R', at: LatLon): number {
  return norm360(bearing(center, at) + (turn === 'R' ? 90 : -90));
}

// Flat local frame ---------------------------------------------------------

/** nm east (x) and north (y) of a local origin. */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

export function toLocal(origin: LatLon, p: LatLon): Vec {
  return {
    x: toRad(p.lon - origin.lon) * Math.cos(toRad((p.lat + origin.lat) / 2)) * EARTH_RADIUS_NM,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS_NM,
  };
}

export function fromLocal(origin: LatLon, v: Vec): LatLon {
  const lat = origin.lat + toDeg(v.y / EARTH_RADIUS_NM);
  const lon = origin.lon + toDeg(v.x / (EARTH_RADIUS_NM * Math.cos(toRad((lat + origin.lat) / 2))));
  return { lat, lon };
}

/** Unit vector along a course. */
export const unit = (courseTrue: number): Vec => ({ x: Math.sin(toRad(courseTrue)), y: Math.cos(toRad(courseTrue)) });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const courseOf = (v: Vec): number => norm360(toDeg(Math.atan2(v.x, v.y)));

/** Distance along a ray from `p0` on `c0` to the line through `p1` on `c1`; null when parallel or behind. */
export function rayLineIntersectionNm(p0: LatLon, c0: number, p1: LatLon, c1: number): number | null {
  const u0 = unit(c0);
  const u1 = unit(c1);
  const p = toLocal(p0, p1);
  const det = u1.x * u0.y - u0.x * u1.y;
  if (Math.abs(det) < 1e-4) return null;
  const t = (u1.x * p.y - p.x * u1.y) / det;
  return t >= 0 ? t : null;
}

/** Distance along a ray from `p0` on `c0` to the first point `radiusNm` from `center`; null if it never gets there. */
export function rayCircleIntersectionNm(p0: LatLon, c0: number, center: LatLon, radiusNm: number): number | null {
  const u = unit(c0);
  const c = toLocal(p0, center);
  const b = dot(u, c);
  const disc = b * b - (dot(c, c) - radiusNm * radiusNm);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const near = b - root;
  if (near >= 0) return near;
  const far = b + root;
  return far >= 0 ? far : null;
}

/**
 * Hold entry by the AIM sectors: the 70 degree line through the fix splits
 * arrivals into direct (180 degrees of arrival courses), teardrop (70) and
 * parallel (110). Courses true.
 */
export function holdEntry(arrivalTrue: number, inboundTrue: number, turn: 'L' | 'R'): 'direct' | 'teardrop' | 'parallel' {
  const r = norm360(arrivalTrue - inboundTrue);
  if (turn === 'R') {
    if (r >= 110 && r < 180) return 'teardrop';
    if (r >= 180 && r < 290) return 'parallel';
    return 'direct';
  }
  if (r > 180 && r <= 250) return 'teardrop';
  if (r > 70 && r <= 180) return 'parallel';
  return 'direct';
}
