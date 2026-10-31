/**
 * Spherical-earth navigation math. Positions in decimal degrees, distances in
 * nautical miles, courses in degrees true unless a name says otherwise.
 * A sphere is accurate to well under 0.5 % at the ranges a trainer uses.
 */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export const EARTH_RADIUS_NM = 3440.065;
export const FT_PER_NM = 6076.12;

const RAD = Math.PI / 180;
export const toRad = (deg: number) => deg * RAD;
export const toDeg = (rad: number) => rad / RAD;

/** Wraps any angle into [0, 360). */
export function norm360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d === 360 ? 0 : d;
}

/** Signed smallest difference a - b, in (-180, 180]. Positive when a is clockwise of b. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Great-circle distance (haversine). */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle course from a to b, degrees true. */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return norm360(toDeg(Math.atan2(y, x)));
}

/** The point reached travelling `distNm` from `from` on initial course `courseTrue`. */
export function destination(from: LatLon, courseTrue: number, distNm: number): LatLon {
  const δ = distNm / EARTH_RADIUS_NM;
  const θ = toRad(courseTrue);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * Cross-track distance of `pos` from the great circle `from` -> `to`.
 * Positive when `pos` is right of the course line.
 */
export function crossTrackNm(from: LatLon, to: LatLon, pos: LatLon): number {
  const δ13 = distanceNm(from, pos) / EARTH_RADIUS_NM;
  const θ13 = toRad(bearing(from, pos));
  const θ12 = toRad(bearing(from, to));
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_NM;
}

/** Distance from `from` to the point abeam `pos` on the great circle from -> to. Negative behind `from`. */
export function alongTrackNm(from: LatLon, to: LatLon, pos: LatLon): number {
  const δ13 = distanceNm(from, pos) / EARTH_RADIUS_NM;
  const δxt = crossTrackNm(from, to, pos) / EARTH_RADIUS_NM;
  const along = Math.acos(Math.min(1, Math.max(-1, Math.cos(δ13) / Math.cos(δxt)))) * EARTH_RADIUS_NM;
  const θ13 = toRad(bearing(from, pos));
  const θ12 = toRad(bearing(from, to));
  return Math.cos(θ13 - θ12) >= 0 ? along : -along;
}

/** Wind triangle: ground track and speed from heading, true airspeed and wind (from, kt). */
export function windTriangle(
  headingTrue: number,
  tasKt: number,
  windFromTrue: number,
  windKt: number,
): { trackTrue: number; groundSpeedKt: number } {
  const h = toRad(headingTrue);
  const w = toRad(windFromTrue + 180); // the direction the air moves toward
  const vx = tasKt * Math.sin(h) + windKt * Math.sin(w);
  const vy = tasKt * Math.cos(h) + windKt * Math.cos(w);
  return { trackTrue: norm360(toDeg(Math.atan2(vx, vy))), groundSpeedKt: Math.hypot(vx, vy) };
}

/** Flat projection around a center, good for maps out to a few hundred miles. Returns nm east/north. */
export function projectNm(center: LatLon, p: LatLon): { x: number; y: number } {
  const x = toRad(p.lon - center.lon) * Math.cos(toRad((p.lat + center.lat) / 2)) * EARTH_RADIUS_NM;
  const y = toRad(p.lat - center.lat) * EARTH_RADIUS_NM;
  return { x, y };
}

/** Line-of-sight radio range, nm, between antennas at the given heights above ground. */
export function radioHorizonNm(heightAFt: number, heightBFt: number): number {
  return 1.23 * (Math.sqrt(Math.max(heightAFt, 0)) + Math.sqrt(Math.max(heightBFt, 0)));
}

/** Formats a latitude like N38°56.08' (Garmin style). */
export function formatLat(lat: number): string {
  return formatDm(Math.abs(lat), 2, lat >= 0 ? 'N' : 'S');
}

/** Formats a longitude like W077°27.36'. */
export function formatLon(lon: number): string {
  return formatDm(Math.abs(lon), 3, lon >= 0 ? 'E' : 'W');
}

function formatDm(value: number, degDigits: number, hemi: string): string {
  let deg = Math.floor(value);
  let min = Math.round((value - deg) * 6000) / 100;
  if (min >= 60) {
    deg += 1;
    min -= 60;
  }
  return `${hemi}${String(deg).padStart(degDigits, '0')}°${min.toFixed(2).padStart(5, '0')}'`;
}
