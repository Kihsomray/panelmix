import { angleDiff, bearing, crossTrackNm, destination, distanceNm, type LatLon } from '../core/geo';
import type { MagneticModel } from '../core/magvar';
import type { NavDatabase, Waypoint } from '../core/navdb';
import type { Approach } from '../core/procedures';
import * as appr from './fms/approach';
import type { AirplaneNow } from './fms/guidance';
import { pendingHold } from './fms/hold';
import { presentPosition, routeActiveLeg } from './fms/legs';
import { approachIndices } from './fms/procedure';
import { activeGuidance, activeRouteLeg, approachEntryIndex, approachLegLengthNm, bump, distanceAlongToNm, sameWaypoint, stepRoute } from './fms/route';
import type { AircraftState, ActiveLeg, ApproachDerived, FlightPhase, FmsState, FmsSteering, RouteLeg, SimState, VerticalDerived } from './types';
import type { VorSolution } from './radionav';

/*
 * Flight management: the flight plan, the active leg, direct-to, OBS mode,
 * instrument approaches with their transitions, missed approaches and holds,
 * automatic leg sequencing, plus the GPS navigation solution every CDI, HSI
 * and data field reads and the steering an autopilot in NAV follows.
 *
 * Every function is pure: state in, state out. The leg engine lives in
 * src/sim/fms/: procedure.ts builds the legs, legs.ts and hold.ts fly them,
 * route.ts sequences, approach.ts loads approaches and scales the CDI.
 */

export { presentPosition } from './fms/legs';
export { approachMode, buildApproachLegs, approachIndices, hasVerticalPath } from './fms/procedure';
export { CDI_FULL_SCALE_NM, type CdiScale } from './fms/approach';
export { holdEntry } from './fms/geometry';

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

/** The airplane for FMS steps that only know where it is (reducers): level, on the leg's course. */
function nowAt(pos: LatLon, time = 0, a?: AircraftState): AirplaneNow {
  return {
    pos: { lat: pos.lat, lon: pos.lon },
    trackTrue: a?.trackTrue ?? 0,
    groundSpeedKt: a?.groundSpeedKt ?? 100,
    tasKt: a?.tasKt ?? 100,
    altitudeFt: a?.altitudeFt ?? 0,
    time,
  };
}

/** Legs that end at their fix, the ones a direct-to into the approach can join. */
const ENDS_AT_FIX = new Set(['IF', 'TF', 'CF', 'DF', 'RF', 'AF']);

/** The first approach leg that ends at `wp`, searching from the active approach leg on. */
function approachLegAt(s: FmsState, wp: Waypoint): number | null {
  const a = s.approach;
  if (!a) return null;
  const from = s.activeLeg?.approachIndex ?? 0;
  const order = [...a.legs.keys()].sort((x, y) => (x >= from ? x : x + a.legs.length) - (y >= from ? y : y + a.legs.length));
  const i = order.find((k) => {
    const l = a.legs[k]!;
    return l.to !== null && ENDS_AT_FIX.has(l.path) && sameWaypoint(l.to, wp);
  });
  return i ?? null;
}

export interface DirectToOptions {
  /** D-> CRS: fly a course into the waypoint rather than straight from the present position. */
  readonly courseMag?: number | undefined;
  readonly mag?: MagneticModel;
}

/**
 * Direct-to a waypoint. If it is in the plan (`planIndex`) or in the loaded
 * approach, sequencing continues from there afterwards (a direct-to into the
 * approach activates it). With `courseMag`, the leg is the course line into
 * the waypoint.
 */
export function directTo(s: FmsState, wp: Waypoint, pos: LatLon, planIndex: number | null = null, opts: DirectToOptions = {}): FmsState {
  const index = planIndex !== null && s.plan[planIndex] ? planIndex : null;
  const approachIndex = index === null ? approachLegAt(s, wp) : null;
  let from = presentPosition(pos);
  let courseMag: number | null = null;
  if (opts.courseMag !== undefined) {
    courseMag = ((Math.round(opts.courseMag) % 360) + 360) % 360;
    const courseTrue = opts.mag ? opts.mag.toTrue(courseMag, wp.lat, wp.lon) : courseMag;
    // The course line is anchored behind the waypoint, at least as far out as the airplane.
    const back = destination(wp, courseTrue + 180, Math.max(distanceNm(pos, wp) + 5, 10));
    from = { kind: 'user', ident: 'CRS', name: `Course to ${wp.ident}`, lat: back.lat, lon: back.lon };
  }
  const course = courseMag !== null ? { courseMag } : {};
  if (approachIndex !== null && s.approach) {
    const leg = routeActiveLeg(s.approach.legs, approachIndex, null, nowAt(pos));
    return bump(s, {
      activeLeg: { ...leg, from, to: wp, isDirectTo: true, ...course },
      approach: { ...s.approach, activated: true, vectorsToFinal: false },
      obsMode: false,
      suspended: false,
      hold: null,
    });
  }
  return bump(s, {
    activeLeg: { from, to: wp, planIndex: index, isDirectTo: true, ...course },
    obsMode: false,
    suspended: false,
    hold: null,
  });
}

/** Makes plan[index] the active waypoint. The first waypoint is flown direct from present position. */
export function activateLeg(s: FmsState, index: number, pos: LatLon): FmsState {
  const to = s.plan[index];
  if (!to) return s;
  const from = index > 0 ? s.plan[index - 1]! : presentPosition(pos);
  return bump(s, {
    activeLeg: { from, to, planIndex: index, isDirectTo: index === 0 },
    obsMode: false,
    suspended: false,
    hold: null,
    approach: s.approach && s.approach.activated ? { ...s.approach, activated: false } : s.approach,
  });
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
    // unless a direct-to off the plan (or the approach) is in progress.
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

/** Reverses the plan and flies to the first waypoint of the reversed route's first leg. The approach is removed. */
export function invertPlan(s: FmsState, pos: LatLon): FmsState {
  const plan = [...s.plan].reverse();
  const cleared = bump(s, { plan, activeLeg: null, obsMode: false, approach: null, hold: null, suspended: false });
  if (plan.length === 0) return cleared;
  return activateLeg(cleared, plan.length > 1 ? 1 : 0, pos);
}

/** Deletes the flight plan and its approach; a direct-to off the plan keeps flying. */
export function clearPlan(s: FmsState): FmsState {
  const leg = s.activeLeg;
  const offPlanDirect = leg !== null && leg.planIndex === null && (leg.approachIndex ?? null) === null;
  return bump(s, {
    plan: [],
    activeLeg: offPlanDirect ? leg : null,
    obsMode: false,
    approach: null,
    suspended: false,
    hold: offPlanDirect ? s.hold : null,
  });
}

export function cancelDirectTo(s: FmsState, pos: LatLon): FmsState {
  const leg = s.activeLeg;
  if (!leg?.isDirectTo) return s;
  // Back onto the leg that ends at the same waypoint, if there is one.
  const ai = leg.approachIndex ?? null;
  if (ai !== null && s.approach && ai > 0) return appr.activateApproachLeg(s, ai, nowAt(pos));
  if (leg.planIndex !== null && leg.planIndex > 0) return activateLeg(s, leg.planIndex, pos);
  return bump(s, { activeLeg: null, obsMode: false, hold: null, suspended: false });
}

export function setObsMode(s: FmsState, on: boolean, courseMag: number): FmsState {
  if (!s.activeLeg) return s.obsMode ? bump(s, { obsMode: false }) : s;
  return bump(s, { obsMode: on, obsCourseMag: on ? courseMag : s.obsCourseMag });
}

export function setObsCourse(s: FmsState, courseMag: number): FmsState {
  return { ...s, obsCourseMag: ((Math.round(courseMag) % 360) + 360) % 360 };
}

// Approaches and holds -----------------------------------------------------

export interface ApproachContext {
  readonly mag: MagneticModel;
  readonly db?: NavDatabase | undefined;
  readonly time?: number;
  readonly aircraft?: AircraftState;
}

const ctxNow = (pos: LatLon, ctx: ApproachContext) => nowAt(pos, ctx.time ?? 0, ctx.aircraft);

/** Loads an approach after the enroute plan; `activate` also activates it (from the transition, or vectors to final). */
export function loadApproach(
  s: FmsState,
  airport: Waypoint,
  approach: Approach,
  transition: string | null,
  activate: 'load' | 'activate' | 'vtf',
  pos: LatLon,
  ctx: ApproachContext,
): FmsState {
  const now = ctxNow(pos, ctx);
  const loaded = appr.loadApproach(s, airport, approach, transition, now, ctx.db ? { mag: ctx.mag, db: ctx.db } : { mag: ctx.mag });
  if (activate === 'load') return loaded;
  return appr.activateApproach(loaded, activate === 'vtf', now);
}

export function activateApproach(s: FmsState, vectorsToFinal: boolean, pos: LatLon, ctx: ApproachContext): FmsState {
  return appr.activateApproach(s, vectorsToFinal, ctxNow(pos, ctx));
}

/** Activates approach leg `index` as published (flight plan "activate leg" on the approach). */
export function activateApproachLeg(s: FmsState, index: number, pos: LatLon, ctx: ApproachContext): FmsState {
  return appr.activateApproachLeg(s, index, ctxNow(pos, ctx));
}

/** Goes straight into the missed approach (Garmin "activate missed approach"), from the present position. */
export function activateMissedApproach(s: FmsState, pos: LatLon, ctx: ApproachContext): FmsState {
  const a = s.approach;
  const missed = a ? approachIndices(a.legs).missed : null;
  if (!a || missed === null) return s;
  return appr.activateApproachLeg(s, missed, ctxNow(pos, ctx));
}

export function removeApproach(s: FmsState, pos: LatLon): FmsState {
  return appr.removeApproach(s, pos);
}

export function unsuspend(s: FmsState, pos: LatLon, ctx: ApproachContext): FmsState {
  return appr.unsuspend(s, ctxNow(pos, ctx));
}

/**
 * A pilot hold at a waypoint. At the active waypoint or one further along the
 * route, the hold starts when the airplane gets there; anywhere else the FMS
 * goes direct to it first.
 */
export function holdAt(
  s: FmsState,
  wp: Waypoint,
  inboundCourseMag: number,
  turn: 'L' | 'R',
  legTimeMin: number | null,
  legNm: number | null,
  pos: LatLon,
  ctx: ApproachContext,
): FmsState {
  const inbound = ((inboundCourseMag % 360) + 360) % 360;
  const hold = pendingHold(
    {
      fix: wp,
      inboundCourseMag: inbound,
      inboundCourseTrue: ctx.mag.toTrue(inbound, wp.lat, wp.lon),
      turn,
      legTimeMin: legNm !== null ? null : legTimeMin ?? 1,
      legNm,
      source: 'pilot',
      termination: 'manual',
      exitAltitudeFt: null,
    },
    ctx.time ?? 0,
  );
  const leg = s.activeLeg;
  const ahead =
    (leg && sameWaypoint(leg.to, wp)) ||
    (leg?.planIndex !== null && leg?.planIndex !== undefined && s.plan.slice(leg.planIndex + 1).some((w) => sameWaypoint(w, wp))) ||
    (leg?.approachIndex !== null && leg?.approachIndex !== undefined && approachLegAt(s, wp) !== null && approachLegAt(s, wp)! > leg.approachIndex);
  if (ahead) return bump(s, { hold, obsMode: false });
  return bump(directTo(s, wp, pos), { hold });
}

/** Leave the hold at the next crossing of the fix (or cancel one not yet started). */
export function exitHold(s: FmsState): FmsState {
  const h = s.hold;
  if (!h) return s;
  if (h.entryStep === 'toFix') return bump(s, { hold: null, suspended: false });
  return h.exitArmed ? s : bump(s, { hold: { ...h, exitArmed: true } });
}

// Sequencing -------------------------------------------------------------

export interface SequenceContext {
  readonly trackTrue?: number;
  readonly altitudeFt?: number;
  readonly tasKt?: number;
  readonly time?: number;
}

/** Moves to the next leg once the active one ends; runs holds, procedure turns and SUSP at the MAP. */
export function sequence(s: FmsState, pos: LatLon, groundSpeedKt: number, ctx: SequenceContext = {}): FmsState {
  const leg = s.activeLeg;
  if (!leg || s.obsMode) return s;
  return stepRoute(s, {
    pos: { lat: pos.lat, lon: pos.lon },
    trackTrue: ctx.trackTrue ?? (distanceNm(leg.from, leg.to) > 0.01 ? bearing(leg.from, leg.to) : bearing(pos, leg.to)),
    groundSpeedKt,
    tasKt: ctx.tasKt ?? groundSpeedKt,
    altitudeFt: ctx.altitudeFt ?? 0,
    time: ctx.time ?? 0,
  });
}

// Navigation solution ----------------------------------------------------

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
  /** ENR, TERM (also near the departure airport), APR (from 2 nm before the FAF), MAPR. */
  readonly scale: appr.CdiScale;
  readonly fullScaleNm: number;
  readonly eteSec: number | null;
  readonly destination: Waypoint | null;
  readonly destinationNm: number | null;
  readonly destinationEteSec: number | null;
  /** Track angle error: desired track minus actual, degrees. */
  readonly trackErrorDeg: number | null;
  /** Garmin flight phase: DPRT, TERM, ENR, APR or MAPR. */
  readonly phase?: FlightPhase;
  /** False when the GPS has no position (failure): flag the CDI. */
  readonly valid?: boolean;
  /** Label of the active leg when it is a procedure leg ("1100ft", "HOLD"...), else the waypoint ident. */
  readonly legLabel?: string | null;
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
  fullScaleNm: appr.CDI_FULL_SCALE_NM.ENR,
  eteSec: null,
  destination: null,
  destinationNm: null,
  destinationEteSec: null,
  trackErrorDeg: null,
  phase: 'ENR',
  valid: true,
  legLabel: null,
};

const toMag = (mag: MagneticModel, trueDeg: number, at: LatLon) => mag.toMagnetic(trueDeg, at.lat, at.lon);

/** OBS mode: a course line through the active waypoint, set by the OBS knob. */
function obsLine(s: FmsState, to: Waypoint, pos: LatLon, mag: MagneticModel) {
  const courseTrue = mag.toTrue(s.obsCourseMag, to.lat, to.lon);
  const origin = destination(to, courseTrue + 180, 100);
  const toFrom: 'TO' | 'FROM' = Math.abs(angleDiff(bearing(pos, to), courseTrue)) < 90 ? 'TO' : 'FROM';
  return { dtkTrue: courseTrue, xtkNm: crossTrackNm(origin, to, pos), toFrom };
}

/** The waypoint after the active one along the route. */
function nextWaypoint(s: FmsState, leg: ActiveLeg): Waypoint | null {
  const a = s.approach;
  const r = activeRouteLeg(s);
  if (r && a) {
    for (let i = r.index + 1; i < a.legs.length; i++) {
      const l = a.legs[i]!;
      if (l.to && !sameWaypoint(l.to, leg.to)) return l.to;
      if (!l.to) return { kind: 'user', ident: l.label, name: l.label, lat: leg.to.lat, lon: leg.to.lon };
    }
    return null;
  }
  if (leg.planIndex === null) return null;
  const next = s.plan[leg.planIndex + 1];
  if (next) return next;
  if (a && leg.planIndex === s.plan.length - 1) {
    const first = a.legs[approachEntryIndex(a, leg.to)];
    return first?.to ?? null;
  }
  return null;
}

/** Remaining distance along the route to the destination (through the approach to the MAP when one is loaded). */
function destinationDistance(s: FmsState, leg: ActiveLeg, pos: LatLon, distance: number): number {
  const a = s.approach;
  if (a) {
    const map = approachIndices(a.legs).map;
    const r = activeRouteLeg(s);
    if (map !== null && (!r || r.index <= map) && !appr.pastMap(s, null)) {
      const along = r && r.index === map ? distance : distanceAlongToNm(s, pos, map);
      const mapFix = a.legs[map]!.to;
      if (along !== null) return along + (mapFix ? distanceNm(mapFix, a.airport) : 0);
    }
    return distanceNm(pos, a.airport);
  }
  return distance + enrouteRemainingNm(s, leg);
}

/** The enroute plan still to fly after the active waypoint, nm. */
function enrouteRemainingNm(s: FmsState, leg: ActiveLeg): number {
  let total = 0;
  if (leg.planIndex !== null) {
    for (let i = leg.planIndex + 1; i < s.plan.length; i++) total += distanceNm(s.plan[i - 1]!, s.plan[i]!);
  }
  return total;
}

export function gpsSolution(
  s: FmsState,
  pos: LatLon,
  trackTrue: number,
  groundSpeedKt: number,
  mag: MagneticModel,
  valid = true,
): GpsSolution {
  const leg = s.activeLeg;
  if (!leg) return valid ? NO_SOLUTION : { ...NO_SOLUTION, valid: false };

  const { from, to } = leg;
  const distance = distanceNm(pos, to);
  const bearingTrue = bearing(pos, to);
  const g = activeGuidance(s, pos, trackTrue);

  let dtkTrue: number;
  let xtk: number;
  let toFrom: 'TO' | 'FROM';
  if (s.obsMode) ({ dtkTrue, xtkNm: xtk, toFrom } = obsLine(s, to, pos, mag));
  else ({ dtkTrue, xtkNm: xtk, toFrom } = g!);

  const scaling = appr.cdiScaling(s, pos, g);
  const gs = groundSpeedKt > 30 ? groundSpeedKt : null;
  const destNm = destinationDistance(s, leg, pos, distance);
  const r = activeRouteLeg(s);
  const holding = s.hold !== null && s.hold.entryStep !== 'toFix' && sameWaypoint(s.hold.fix, to);

  return {
    active: true,
    from,
    to,
    next: nextWaypoint(s, leg),
    isDirectTo: leg.isDirectTo,
    obsMode: s.obsMode,
    dtkMag: toMag(mag, dtkTrue, pos),
    bearingMag: toMag(mag, bearingTrue, pos),
    distanceNm: distance,
    crossTrackNm: valid ? xtk : 0,
    toFrom,
    needle: valid ? Math.min(Math.max(-xtk / scaling.fullScaleNm, -1), 1) : 0,
    scale: scaling.scale,
    fullScaleNm: scaling.fullScaleNm,
    eteSec: gs ? (distance / gs) * 3600 : null,
    destination: s.approach ? s.approach.airport : s.plan.length > 0 && leg.planIndex !== null ? s.plan[s.plan.length - 1]! : to,
    destinationNm: destNm,
    destinationEteSec: gs ? (destNm / gs) * 3600 : null,
    trackErrorDeg: angleDiff(dtkTrue, trackTrue),
    phase: scaling.phase,
    valid,
    legLabel: holding ? 'HOLD' : r ? r.leg.label : to.ident,
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

export interface ApproachLegInfo {
  readonly index: number;
  readonly leg: RouteLeg;
  /** Course of the leg, magnetic (inbound course for holds); null for direct-to legs. */
  readonly dtkMag: number | null;
  readonly legNm: number | null;
  /** From the present position along the route; null for legs already flown. */
  readonly cumulativeNm: number | null;
  readonly isActive: boolean;
}

/** Per-leg course and distance of the loaded approach, for flight plan and PROC pages. */
export function approachLegs(s: FmsState, pos: LatLon, mag: MagneticModel): ApproachLegInfo[] {
  const a = s.approach;
  if (!a) return [];
  const r = activeRouteLeg(s);
  const leg = s.activeLeg;
  const enrouteActive = !r && leg !== null && leg.planIndex !== null;
  const entry = approachEntryIndex(a, s.plan[s.plan.length - 1] ?? null);
  let cumulative: number | null = enrouteActive ? distanceNm(pos, leg.to) + enrouteRemainingNm(s, leg) : null;
  let at: LatLon | null = s.plan[s.plan.length - 1] ?? null;
  return a.legs.map((l, i) => {
    const prev = i > 0 ? a.legs[i - 1]!.to : null;
    const legNm = at ? approachLegLengthNm(l, at) || null : l.distanceNm ?? null;
    let dtkMag: number | null = null;
    if (l.courseMag !== undefined) dtkMag = l.courseMag;
    else if (prev && l.to && distanceNm(prev, l.to) > 0.05 && l.path !== 'DF') dtkMag = mag.toMagnetic(bearing(prev, l.to), prev.lat, prev.lon);
    let cum: number | null = null;
    if (r && i >= r.index) {
      cumulative = i === r.index ? distanceNm(pos, leg!.to) : (cumulative ?? 0) + (legNm ?? 0);
      cum = cumulative;
    } else if (enrouteActive && i >= entry && cumulative !== null) {
      cumulative += legNm ?? 0;
      cum = cumulative;
    }
    if (l.to) at = l.to;
    return { index: i, leg: l, dtkMag, legNm, cumulativeNm: cum, isActive: r?.index === i };
  });
}

/** The active leg as a pair of indices for highlighting, or null. */
export function activeLegIndices(leg: ActiveLeg | null): { from: number | null; to: number } | null {
  if (!leg || leg.planIndex === null) return null;
  return { from: leg.isDirectTo ? null : leg.planIndex - 1, to: leg.planIndex };
}

// Published per frame in `Derived` ------------------------------------------

/** The loaded approach as every device sees it. */
export function approachDerived(state: SimState, aircraft: AircraftState, _mag: MagneticModel): ApproachDerived | null {
  return appr.approachDerived(state.fms, aircraft, aircraft.trackTrue);
}

/**
 * Vertical deviation: the ILS glideslope when the CDI shows a NAV receiver on
 * an ILS, the GPS glidepath of an active RNAV approach when it shows GPS.
 */
export function verticalDerived(
  state: SimState,
  aircraft: AircraftState,
  mag: MagneticModel,
  vor: readonly [VorSolution, VorSolution],
  gpsValid = true,
): VerticalDerived | null {
  const source = state.nav.cdiSource;
  if (source !== 'GPS') {
    const gs = vor[source === 'NAV1' ? 0 : 1].glideslope;
    if (!gs) return null;
    return {
      source: 'GS',
      advisory: false,
      needle: gs.needle,
      deviationFt: gs.deviationFt,
      angleDeg: gs.angleDeg,
      valid: gs.valid,
      fullScaleFt: gs.fullScaleFt,
      pathAltitudeFt: gs.pathAltitudeFt,
      distanceNm: gs.distanceNm,
    };
  }
  if (!gpsValid || state.fms.obsMode) return null;
  return appr.glidepathDerived(state.fms, aircraft, aircraft.altitudeFt, aircraft.trackTrue, mag);
}

/** Steering for NAV mode on the active leg (tracks, headings, arcs, holds). Null without GPS guidance. */
export function fmsSteering(state: SimState, aircraft: AircraftState, mag: MagneticModel, gpsValid = true): FmsSteering | null {
  const s = state.fms;
  const leg = s.activeLeg;
  if (!leg || !gpsValid) return null;
  const pos = { lat: aircraft.lat, lon: aircraft.lon };
  const m = (t: number) => toMag(mag, t, pos);
  if (s.obsMode) {
    const o = obsLine(s, leg.to, pos, mag);
    return { kind: 'track', courseMag: m(o.dtkTrue), crossTrackNm: o.xtkNm };
  }
  const g = activeGuidance(s, pos, aircraft.trackTrue);
  if (!g) return null;
  const st = g.steer;
  switch (st.kind) {
    case 'track':
      return { kind: 'track', courseMag: m(st.courseTrue), crossTrackNm: st.xtkNm };
    case 'heading':
      return st.turn ? { kind: 'heading', headingMag: m(st.headingTrue), turn: st.turn } : { kind: 'heading', headingMag: m(st.headingTrue) };
    case 'arc':
      return { kind: 'arc', courseMag: m(st.courseTrue), crossTrackNm: st.xtkNm, turn: st.turn, radiusNm: st.radiusNm };
  }
}

/** Whether the GPS approach loaded offers a glidepath an autopilot can couple to (LPV, L/VNAV). */
export function hasCoupledGlidepath(s: FmsState): boolean {
  return appr.hasCoupledGlidepath(s.approach);
}
