import { alongTrackNm, angleDiff, bearing, crossTrackNm, destination, distanceNm, type LatLon } from '../core/geo';
import type { MagneticModel } from '../core/magvar';
import type { Waypoint } from '../core/navdb';
import type { AircraftState, ActiveLeg, ApproachDerived, FmsState, FmsSteering, SimState, VerticalDerived } from './types';
import type { VorSolution } from './radionav';

/*
 * Flight management: the flight plan, the active leg, direct-to, OBS mode and
 * automatic leg sequencing, plus the GPS navigation solution every CDI, HSI
 * and data field reads.
 *
 * Every function is pure: state in, state out.
 */

export const EMPTY_FMS: FmsState = {
  plan: [],
  activeLeg: null,
  obsMode: false,
  obsCourseMag: 0,
  revision: 0,
  approach: null,
  suspended: false,
  hold: null,
};

/** A waypoint for the present position, the origin of a direct-to leg. */
export function presentPosition(pos: LatLon): Waypoint {
  return { kind: 'user', ident: 'P.POS', name: 'Present position', lat: pos.lat, lon: pos.lon };
}

const bump = (s: FmsState, patch: Partial<FmsState>): FmsState => ({ ...s, ...patch, revision: s.revision + 1 });

/** Direct-to a waypoint. If it is in the plan (`planIndex`), sequencing continues from there afterwards. */
export function directTo(s: FmsState, wp: Waypoint, pos: LatLon, planIndex: number | null = null): FmsState {
  const index = planIndex !== null && s.plan[planIndex] ? planIndex : null;
  return bump(s, {
    activeLeg: { from: presentPosition(pos), to: wp, planIndex: index, isDirectTo: true },
    obsMode: false,
  });
}

/** Makes plan[index] the active waypoint. The first waypoint is flown direct from present position. */
export function activateLeg(s: FmsState, index: number, pos: LatLon): FmsState {
  const to = s.plan[index];
  if (!to) return s;
  const from = index > 0 ? s.plan[index - 1]! : presentPosition(pos);
  return bump(s, { activeLeg: { from, to, planIndex: index, isDirectTo: index === 0 }, obsMode: false });
}

/** Re-anchors the active leg after the plan changed, keeping the same active waypoint where possible. */
function relink(s: FmsState, plan: readonly Waypoint[], newIndex: number | null, pos: LatLon): FmsState {
  const leg = s.activeLeg;
  if (!leg || leg.planIndex === null) return bump(s, { plan });
  if (newIndex === null || !plan[newIndex]) return bump(s, { plan, activeLeg: null, obsMode: false });
  const to = plan[newIndex]!;
  const from = leg.isDirectTo ? leg.from : newIndex > 0 ? plan[newIndex - 1]! : presentPosition(pos);
  return bump(s, { plan, activeLeg: { ...leg, to, from, planIndex: newIndex } });
}

/**
 * Inserts a waypoint before `index` (index === plan.length appends). Inserting
 * directly ahead of the active waypoint makes the new one the next to fly to,
 * keeping the current leg's origin.
 */
export function insertWaypoint(s: FmsState, index: number, wp: Waypoint, pos: LatLon): FmsState {
  const i = Math.min(Math.max(index, 0), s.plan.length);
  const plan = [...s.plan.slice(0, i), wp, ...s.plan.slice(i)];
  const active = s.activeLeg?.planIndex ?? null;
  if (active === null) {
    // A plan that just became a route (two or more waypoints) starts flying its first leg,
    // unless a direct-to off the plan is in progress.
    if (!s.activeLeg && plan.length >= 2) return activateLeg(bump(s, { plan }), 1, pos);
    return relink(s, plan, null, pos);
  }
  if (i < active) return relink(s, plan, active + 1, pos);
  if (i === active) {
    const leg = s.activeLeg!;
    return bump(s, { plan, activeLeg: { ...leg, to: wp, planIndex: i } });
  }
  return relink(s, plan, active, pos);
}

export function removeWaypoint(s: FmsState, index: number, pos: LatLon): FmsState {
  if (index < 0 || index >= s.plan.length) return s;
  const plan = s.plan.filter((_, i) => i !== index);
  const active = s.activeLeg?.planIndex ?? null;
  if (active === null) return relink(s, plan, null, pos);
  if (index < active) return relink(s, plan, active - 1, pos);
  if (index === active) {
    // The next waypoint takes over, flown from where the leg started.
    const next = plan[index];
    if (!next) return bump(s, { plan, activeLeg: null, obsMode: false });
    const leg = s.activeLeg!;
    return bump(s, { plan, activeLeg: { ...leg, to: next, planIndex: index } });
  }
  return relink(s, plan, active, pos);
}

export function replacePlan(s: FmsState, plan: readonly Waypoint[], pos: LatLon): FmsState {
  const offPlanDirect = s.activeLeg !== null && s.activeLeg.planIndex === null;
  const next = bump(s, { plan: [...plan], activeLeg: offPlanDirect ? s.activeLeg : null, obsMode: false });
  if (next.activeLeg || plan.length < 2) return next;
  return activateLeg(next, 1, pos);
}

/** Reverses the plan and flies to the first waypoint of the reversed route's first leg. */
export function invertPlan(s: FmsState, pos: LatLon): FmsState {
  const plan = [...s.plan].reverse();
  const cleared = bump(s, { plan, activeLeg: null, obsMode: false });
  if (plan.length === 0) return cleared;
  return activateLeg(cleared, plan.length > 1 ? 1 : 0, pos);
}

export function clearPlan(s: FmsState): FmsState {
  const offPlanDirect = s.activeLeg !== null && s.activeLeg.planIndex === null;
  return bump(s, { plan: [], activeLeg: offPlanDirect ? s.activeLeg : null, obsMode: false });
}

export function cancelDirectTo(s: FmsState, pos: LatLon): FmsState {
  const leg = s.activeLeg;
  if (!leg?.isDirectTo) return s;
  // Back onto the plan leg that ends at the same waypoint, if there is one.
  if (leg.planIndex !== null && leg.planIndex > 0) return activateLeg(s, leg.planIndex, pos);
  return bump(s, { activeLeg: null, obsMode: false });
}

export function setObsMode(s: FmsState, on: boolean, courseMag: number): FmsState {
  if (!s.activeLeg) return s.obsMode ? bump(s, { obsMode: false }) : s;
  return bump(s, { obsMode: on, obsCourseMag: on ? courseMag : s.obsCourseMag });
}

export function setObsCourse(s: FmsState, courseMag: number): FmsState {
  return { ...s, obsCourseMag: ((Math.round(courseMag) % 360) + 360) % 360 };
}

/** Distance before the active waypoint at which the next leg starts (simple turn anticipation). */
function anticipationNm(groundSpeedKt: number, turnDeg: number): number {
  if (turnDeg < 5) return 0.05;
  // Standard-rate turn radius, scaled by how much of the turn is needed.
  const radius = groundSpeedKt / (20 * Math.PI);
  return Math.min(radius * Math.tan(((Math.min(turnDeg, 120) / 2) * Math.PI) / 180), 3);
}

/** Moves to the next leg once the active waypoint is reached. */
export function sequence(s: FmsState, pos: LatLon, groundSpeedKt: number): FmsState {
  const leg = s.activeLeg;
  if (!leg || s.obsMode || leg.planIndex === null) return s;
  const next = s.plan[leg.planIndex + 1];
  if (!next) return s;
  const legNm = distanceNm(leg.from, leg.to);
  const remaining = legNm - alongTrackNm(leg.from, leg.to, pos);
  const turn = Math.abs(angleDiff(bearing(leg.to, next), bearing(leg.from, leg.to)));
  if (remaining > anticipationNm(groundSpeedKt, turn)) return s;
  return bump(s, { activeLeg: { from: leg.to, to: next, planIndex: leg.planIndex + 1, isDirectTo: false } });
}

// Navigation solution ----------------------------------------------------

export type CdiScale = 'ENR' | 'TERM' | 'APR';

/** Full-scale CDI deflection by phase, nm (Garmin defaults). */
export const CDI_FULL_SCALE_NM: Record<CdiScale, number> = { ENR: 2, TERM: 1, APR: 0.3 };

export interface GpsSolution {
  readonly active: boolean;
  readonly from: Waypoint | null;
  readonly to: Waypoint | null;
  readonly next: Waypoint | null;
  readonly isDirectTo: boolean;
  readonly obsMode: boolean;
  /** Desired track at the present position along the leg. */
  readonly dtkMag: number | null;
  readonly bearingMag: number | null;
  readonly distanceNm: number | null;
  /** Positive when the airplane is right of course. */
  readonly crossTrackNm: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  /** Course needle position, -1 (full left) to 1 (full right). Fly toward the needle. */
  readonly needle: number;
  readonly scale: CdiScale;
  readonly fullScaleNm: number;
  readonly eteSec: number | null;
  readonly destination: Waypoint | null;
  readonly destinationNm: number | null;
  readonly destinationEteSec: number | null;
  /** Track angle error: desired track minus actual, degrees. */
  readonly trackErrorDeg: number | null;
}

export interface PlanLegInfo {
  readonly index: number;
  readonly waypoint: Waypoint;
  /** Course of the leg ending at this waypoint, magnetic. Null for the first waypoint. */
  readonly dtkMag: number | null;
  readonly legNm: number | null;
  /** From the present position along the route; null for waypoints already flown. */
  readonly cumulativeNm: number | null;
  readonly isActive: boolean;
}

const NO_SOLUTION: GpsSolution = {
  active: false,
  from: null,
  to: null,
  next: null,
  isDirectTo: false,
  obsMode: false,
  dtkMag: null,
  bearingMag: null,
  distanceNm: null,
  crossTrackNm: 0,
  toFrom: null,
  needle: 0,
  scale: 'ENR',
  fullScaleNm: CDI_FULL_SCALE_NM.ENR,
  eteSec: null,
  destination: null,
  destinationNm: null,
  destinationEteSec: null,
  trackErrorDeg: null,
};

const toMag = (mag: MagneticModel, trueDeg: number, at: LatLon) => mag.toMagnetic(trueDeg, at.lat, at.lon);

/** Terminal scaling within 31 nm of the departure or destination airport (with hysteresis left to the caller). */
function cdiScale(s: FmsState, pos: LatLon): CdiScale {
  const first = s.plan[0];
  const last = s.plan[s.plan.length - 1];
  const near = (w: Waypoint | undefined) => w?.kind === 'airport' && distanceNm(pos, w) <= 31;
  const target = s.activeLeg?.to;
  return near(first) || near(last) || (s.activeLeg?.isDirectTo && near(target)) ? 'TERM' : 'ENR';
}

export function gpsSolution(
  s: FmsState,
  pos: LatLon,
  trackTrue: number,
  groundSpeedKt: number,
  mag: MagneticModel,
): GpsSolution {
  const leg = s.activeLeg;
  if (!leg) return NO_SOLUTION;

  const { from, to } = leg;
  const scale = cdiScale(s, pos);
  const fullScaleNm = CDI_FULL_SCALE_NM[scale];
  const distance = distanceNm(pos, to);
  const bearingTrue = bearing(pos, to);

  let dtkTrue: number;
  let xtk: number;
  let toFrom: 'TO' | 'FROM';
  if (s.obsMode) {
    // A course line through the active waypoint, set by the OBS knob.
    const courseTrue = mag.toTrue(s.obsCourseMag, to.lat, to.lon);
    const origin = destination(to, courseTrue + 180, 100);
    xtk = crossTrackNm(origin, to, pos);
    dtkTrue = courseTrue;
    toFrom = Math.abs(angleDiff(bearingTrue, courseTrue)) < 90 ? 'TO' : 'FROM';
  } else {
    const legNm = distanceNm(from, to);
    xtk = legNm > 0.01 ? crossTrackNm(from, to, pos) : 0;
    const along = legNm > 0.01 ? alongTrackNm(from, to, pos) : 0;
    // Desired track is the great-circle course at the point abeam the airplane.
    const abeam = legNm > 0.01 ? destination(from, bearing(from, to), Math.min(Math.max(along, 0), legNm)) : pos;
    dtkTrue = legNm > 0.01 && along < legNm - 0.01 ? bearing(abeam, to) : bearing(from, to);
    toFrom = along < legNm ? 'TO' : 'FROM';
  }

  const plan = s.plan;
  const nextIndex = leg.planIndex !== null ? leg.planIndex + 1 : null;
  const next = nextIndex !== null ? plan[nextIndex] ?? null : null;
  const dest = plan.length > 0 && leg.planIndex !== null ? plan[plan.length - 1]! : to;
  let destNm = distance;
  if (leg.planIndex !== null) {
    for (let i = leg.planIndex + 1; i < plan.length; i++) destNm += distanceNm(plan[i - 1]!, plan[i]!);
  }
  const gs = groundSpeedKt > 30 ? groundSpeedKt : null;

  return {
    active: true,
    from,
    to,
    next,
    isDirectTo: leg.isDirectTo,
    obsMode: s.obsMode,
    dtkMag: toMag(mag, dtkTrue, pos),
    bearingMag: toMag(mag, bearingTrue, pos),
    distanceNm: distance,
    crossTrackNm: xtk,
    toFrom,
    needle: Math.min(Math.max(-xtk / fullScaleNm, -1), 1),
    scale,
    fullScaleNm,
    eteSec: gs ? (distance / gs) * 3600 : null,
    destination: dest,
    destinationNm: destNm,
    destinationEteSec: gs ? (destNm / gs) * 3600 : null,
    trackErrorDeg: angleDiff(dtkTrue, trackTrue),
  };
}

/** Per-waypoint course and distance for flight plan pages. */
export function planLegs(s: FmsState, pos: LatLon, mag: MagneticModel): PlanLegInfo[] {
  const active = s.activeLeg?.planIndex ?? null;
  let cumulative = 0;
  return s.plan.map((wp, i) => {
    const prev = i > 0 ? s.plan[i - 1]! : null;
    const legNm = prev ? distanceNm(prev, wp) : null;
    const dtkMag = prev ? mag.toMagnetic(bearing(prev, wp), prev.lat, prev.lon) : null;
    let cum: number | null = null;
    if (active !== null && i >= active) {
      cumulative += i === active ? distanceNm(pos, wp) : legNm ?? 0;
      cum = cumulative;
    }
    return { index: i, waypoint: wp, dtkMag, legNm, cumulativeNm: cum, isActive: i === active };
  });
}

/** The active leg as a pair of indices for highlighting, or null. */
export function activeLegIndices(leg: ActiveLeg | null): { from: number | null; to: number } | null {
  if (!leg || leg.planIndex === null) return null;
  return { from: leg.isDirectTo ? null : leg.planIndex - 1, to: leg.planIndex };
}

// Procedure-capable FMS extension points. The simulator publishes these in
// `Derived`; they return null until approaches are flown by the FMS.

/** The loaded approach as every device sees it. */
export function approachDerived(_state: SimState, _aircraft: AircraftState, _mag: MagneticModel): ApproachDerived | null {
  return null;
}

/** Vertical deviation from the GPS glidepath or the ILS glideslope. */
export function verticalDerived(
  _state: SimState,
  _aircraft: AircraftState,
  _mag: MagneticModel,
  _vor: readonly [VorSolution, VorSolution],
): VerticalDerived | null {
  return null;
}

/** Steering for NAV mode on the active leg (tracks, headings, arcs, holds). */
export function fmsSteering(_state: SimState, _aircraft: AircraftState, _mag: MagneticModel): FmsSteering | null {
  return null;
}
