import { ringContains, type AirspaceClass, type AirspaceSource, type AirspaceVolume } from '../../core/airspace';
import { toRad } from '../../core/geo';
import type { AircraftState } from '../types';
import type { AirspaceDerived } from './types';

/*
 * Class B, C and D awareness: the airspace the airplane is in, and the
 * airspace it will enter within about two minutes if it keeps its track,
 * ground speed and vertical speed (so a descent into a Class B shelf counts).
 * Shelves of one airspace share a name and are reported once.
 */

export const AIRSPACE_LOOKAHEAD: { readonly horizonS: number; readonly stepS: number } = { horizonS: 120, stepS: 10 };

const EMPTY: AirspaceDerived = { inside: [], ahead: [] };

/** "WASHINGTON-TRI AREA CLASS B" -> "WASHINGTON-TRI AREA", "EL PASO CLASS D2" -> "EL PASO" (the class is reported separately). */
export function airspaceShortName(name: string): string {
  const short = name.replace(/\s*\bCLASS\s+[A-G]\d*\b(\s+AIRSPACE)?\s*$/i, '').trim();
  return short || name.trim();
}

function contains(v: AirspaceVolume, lat: number, lon: number, altitudeFt: number): boolean {
  const [west, south, east, north] = v.bbox;
  return (
    altitudeFt >= v.lowerFt &&
    altitudeFt <= v.upperFt &&
    lat >= south &&
    lat <= north &&
    lon >= west &&
    lon <= east &&
    ringContains(v.ring, lat, lon)
  );
}

const boxArea = (v: AirspaceVolume) => (v.bbox[2] - v.bbox[0]) * (v.bbox[3] - v.bbox[1]);

/** Volumes never change once loaded, so each name is shortened once. */
const shortNames = new WeakMap<AirspaceVolume, string>();
function shortName(v: AirspaceVolume): string {
  let name = shortNames.get(v);
  if (name === undefined) {
    name = airspaceShortName(v.name);
    shortNames.set(v, name);
  }
  return name;
}

/** Where the airplane will be `s` seconds from now on its current track, speed and vertical speed. */
function projector(a: AircraftState) {
  const track = toRad(a.trackTrue);
  const north = Math.cos(track) / 60;
  const east = Math.sin(track) / (60 * Math.cos(toRad(a.lat)));
  return (s: number) => {
    const nm = (a.groundSpeedKt * s) / 3600;
    return { lat: a.lat + nm * north, lon: a.lon + nm * east, altitudeFt: a.altitudeFt + (a.verticalSpeedFpm * s) / 60 };
  };
}

/** Seconds until the projected path enters `v`, refined between samples, or null beyond the horizon. */
function entryTime(v: AirspaceVolume, at: ReturnType<typeof projector>): number | null {
  const inside = (s: number) => {
    const p = at(s);
    return contains(v, p.lat, p.lon, p.altitudeFt);
  };
  const { horizonS, stepS } = AIRSPACE_LOOKAHEAD;
  for (let s = stepS; s <= horizonS; s += stepS) {
    if (!inside(s)) continue;
    let lo = s - stepS;
    let hi = s;
    for (let i = 0; i < 3; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  return null;
}

export function airspaceAwareness(source: AirspaceSource, a: AircraftState): AirspaceDerived {
  if (source.volumes.length === 0) return EMPTY;
  const at = projector(a);
  const end = at(AIRSPACE_LOOKAHEAD.horizonS);
  const pad = 0.01;
  const candidates = source.inBox(
    Math.min(a.lat, end.lat) - pad,
    Math.min(a.lon, end.lon) - pad,
    Math.max(a.lat, end.lat) + pad,
    Math.max(a.lon, end.lon) + pad,
  );
  if (candidates.length === 0) return EMPTY;

  const inside = new Map<string, { cls: AirspaceClass; name: string; area: number }>();
  const ahead = new Map<string, { cls: AirspaceClass; name: string; minutes: number }>();
  const outside: AirspaceVolume[] = [];
  for (const v of candidates) {
    if (!contains(v, a.lat, a.lon, a.altitudeFt)) {
      outside.push(v);
      continue;
    }
    const name = shortName(v);
    const key = `${v.cls}:${name}`;
    const area = boxArea(v);
    if ((inside.get(key)?.area ?? Infinity) > area) inside.set(key, { cls: v.cls, name, area });
  }
  for (const v of outside) {
    const name = shortName(v);
    const key = `${v.cls}:${name}`;
    // Already inside one shelf of an airspace: its other shelves are not "ahead".
    if (inside.has(key)) continue;
    const s = entryTime(v, at);
    if (s !== null && (ahead.get(key)?.minutes ?? Infinity) > s / 60) ahead.set(key, { cls: v.cls, name, minutes: s / 60 });
  }
  if (inside.size === 0 && ahead.size === 0) return EMPTY;
  return {
    inside: [...inside.values()].sort((p, q) => p.area - q.area).map(({ cls, name }) => ({ cls, name })),
    ahead: [...ahead.values()].sort((p, q) => p.minutes - q.minutes),
  };
}
