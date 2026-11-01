import { alongTrackNm, bearing, crossTrackNm, destination, distanceNm, type LatLon } from '../../core/geo';
import { onCourseLine } from './geometry';

/*
 * What the FMS works out for the active leg at the present position: the
 * desired track and cross-track error the CDI shows, how far the leg has to
 * go, and the steering an autopilot in NAV flies. Everything in degrees
 * true; fms.ts converts to magnetic for the published solution.
 */

export type SteerTrue =
  | { readonly kind: 'track'; readonly courseTrue: number; readonly xtkNm: number }
  | { readonly kind: 'heading'; readonly headingTrue: number; readonly turn?: 'L' | 'R' }
  | { readonly kind: 'arc'; readonly courseTrue: number; readonly xtkNm: number; readonly turn: 'L' | 'R'; readonly radiusNm: number };

export interface LegGuidance {
  readonly dtkTrue: number;
  /** Positive right of the desired path. */
  readonly xtkNm: number;
  readonly toFrom: 'TO' | 'FROM';
  /** Along the leg to where it ends, nm (negative once passed); Infinity when it ends at an altitude, an intercept or manually. */
  readonly remainingNm: number;
  readonly steer: SteerTrue;
}

/** The airplane as the FMS sees it each step. */
export interface AirplaneNow {
  readonly pos: LatLon;
  readonly trackTrue: number;
  readonly groundSpeedKt: number;
  readonly tasKt: number;
  readonly altitudeFt: number;
  readonly time: number;
}

const track = (dtkTrue: number, xtkNm: number): SteerTrue => ({ kind: 'track', courseTrue: dtkTrue, xtkNm });

/** A great-circle leg from `from` to `to` (TF legs, enroute legs, direct-to). */
export function tfGuidance(from: LatLon, to: LatLon, pos: LatLon): LegGuidance {
  const legNm = distanceNm(from, to);
  const xtk = legNm > 0.01 ? crossTrackNm(from, to, pos) : 0;
  const along = legNm > 0.01 ? alongTrackNm(from, to, pos) : 0;
  // Desired track is the great-circle course at the point abeam the airplane.
  const abeam = legNm > 0.01 ? destination(from, bearing(from, to), Math.min(Math.max(along, 0), legNm)) : pos;
  const dtkTrue = legNm > 0.01 && along < legNm - 0.01 ? bearing(abeam, to) : bearing(from, to);
  return { dtkTrue, xtkNm: xtk, toFrom: along < legNm ? 'TO' : 'FROM', remainingNm: legNm - along, steer: track(dtkTrue, xtk) };
}

/** A course line through `origin`, ending `endAlongNm` past it (Infinity for open-ended legs). */
export function lineGuidance(origin: LatLon, courseTrue: number, pos: LatLon, endAlongNm: number): LegGuidance {
  const l = onCourseLine(origin, courseTrue, pos);
  const remainingNm = endAlongNm - l.alongNm;
  return {
    dtkTrue: l.dtkTrue,
    xtkNm: l.xtkNm,
    toFrom: remainingNm > 0 ? 'TO' : 'FROM',
    remainingNm,
    steer: track(l.dtkTrue, l.xtkNm),
  };
}

/** Homing to a fix (DF legs): the desired track is the bearing to it. */
export function directGuidance(to: LatLon, pos: LatLon, trackTrue: number, turn: 'L' | 'R' | undefined): LegGuidance {
  const dtkTrue = bearing(pos, to);
  const distance = distanceNm(pos, to);
  // A published turn direction is honoured while the turn is too big to be left to the shortest way.
  const steer: SteerTrue = turn && forcedTurn(dtkTrue, trackTrue, turn) && distance > 0.3 ? { kind: 'heading', headingTrue: dtkTrue, turn } : track(dtkTrue, 0);
  return { dtkTrue, xtkNm: 0, toFrom: 'TO', remainingNm: distance, steer };
}

/**
 * Whether reaching `target` from `current` the published way needs more than
 * the shortest turn would give: over 150 degrees to go that way, but not when
 * the target is just behind (up to 30 degrees the other way, an overshoot).
 */
export function forcedTurn(target: number, current: number, turn: 'L' | 'R'): boolean {
  const remaining = turn === 'R' ? (target - current + 720) % 360 : (current - target + 720) % 360;
  return remaining > 150 && remaining < 330;
}
