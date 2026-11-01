import { angleDiff, bearing, distanceNm, toRad, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import { holdEntry, turnAnticipationNm } from './geometry';
import { tfGuidance, type AirplaneNow, type LegGuidance } from './guidance';
import { holdExits, holdGuidance, pendingHold, startHold, stepHold, type HoldSetup } from './hold';
import { directPassed, entryCourse, exitCourse, procedureTurnStage, routeActiveLeg, routeGuidance, routeLegComplete } from './legs';
import { approachIndices, constraintFt, isHoldPath } from './procedure';
import type { ActiveLeg, FmsState, HoldState, LoadedApproach, RouteLeg } from './types';

/*
 * Following the route: guidance for whatever the active leg is (enroute leg,
 * direct-to, procedure leg, hold), and the sequencing step that moves to the
 * next leg, runs the hold state machine and suspends at the missed approach
 * point. The enroute plan flows into the loaded approach the way Garmin
 * units sequence it: after the last enroute waypoint comes the approach's
 * first leg.
 */

export const bump = (s: FmsState, patch: Partial<FmsState>): FmsState => ({ ...s, ...patch, revision: s.revision + 1 });

export const sameWaypoint = (a: Waypoint, b: Waypoint) => a.ident === b.ident && distanceNm(a, b) < 0.2;

/** The procedure leg the active leg flies, if it is one. */
export function activeRouteLeg(s: FmsState): { readonly leg: RouteLeg; readonly next: RouteLeg | undefined; readonly index: number } | null {
  const i = s.activeLeg?.approachIndex;
  if (i === null || i === undefined || !s.approach) return null;
  const leg = s.approach.legs[i];
  return leg ? { leg, next: s.approach.legs[i + 1], index: i } : null;
}

/** Guidance on the active leg at the present position (OBS mode excepted). */
export function activeGuidance(s: FmsState, pos: LatLon, trackTrue: number): LegGuidance | null {
  const leg = s.activeLeg;
  if (!leg) return null;
  if (s.hold && s.hold.entryStep !== 'toFix' && sameWaypoint(s.hold.fix, leg.to)) return holdGuidance(s.hold, pos);
  const r = activeRouteLeg(s);
  if (r) return routeGuidance(leg, r.leg, r.next, pos, trackTrue);
  return tfGuidance(leg.from, leg.to, pos);
}

/** How a published hold leg is set up. */
export function holdSetup(leg: RouteLeg, fix: Waypoint): HoldSetup {
  const termination = leg.path === 'HF' ? 'fix' : leg.path === 'HA' ? 'altitude' : 'manual';
  return {
    fix,
    inboundCourseMag: leg.courseMag ?? 0,
    inboundCourseTrue: leg.courseTrue ?? leg.courseMag ?? 0,
    turn: leg.turn ?? 'R',
    legTimeMin: leg.distanceNm !== undefined ? null : leg.legTimeMin ?? null,
    legNm: leg.distanceNm ?? null,
    source: 'procedure',
    termination,
    exitAltitudeFt: termination === 'altitude' ? constraintFt(leg.altitude) : null,
  };
}

/** Holds flown until exited suspend automatic sequencing (SUSP); HF and HA holds end by themselves. */
const suspends = (h: HoldState) => (h.termination ?? 'manual') === 'manual';

/** The first approach leg flown after the enroute plan: the one after an IF at the waypoint just reached. */
export function approachEntryIndex(a: LoadedApproach, at: Waypoint | null): number {
  const first = a.legs[0];
  return first && at && first.path === 'IF' && first.to && sameWaypoint(first.to, at) && a.legs.length > 1 ? 1 : 0;
}

interface Following {
  readonly activeLeg: ActiveLeg;
  readonly approach: LoadedApproach | null;
  readonly hold: HoldState | null;
  readonly suspended: boolean;
}

/**
 * Activates approach leg `index`, starting the hold if it is one and the
 * airplane is at its fix. A pilot hold waiting at a later fix (`keep`) stays.
 */
export function enterApproachLeg(a: LoadedApproach, index: number, start: Waypoint | null, now: AirplaneNow, keep: HoldState | null): Following {
  const leg = a.legs[index]!;
  const approach = a.activated ? a : { ...a, activated: true };
  if (!isHoldPath(leg.path)) {
    return { activeLeg: routeActiveLeg(a.legs, index, start, now), approach, hold: keep?.source === 'pilot' ? keep : null, suspended: false };
  }
  // Arriving at the fix from the leg that ends there: the entry starts right here. Anywhere
  // else (activated out of sequence, or the fix passed well off to one side) go to the fix first.
  const atFix = !!start && !!leg.to && sameWaypoint(start, leg.to) && distanceNm(now.pos, leg.to) < 1;
  const activeLeg = routeActiveLeg(a.legs, index, atFix ? start : null, now);
  const pending = pendingHold(holdSetup(leg, activeLeg.to), now.time);
  if (atFix) {
    const hold = startHold(pending, now);
    return { activeLeg, approach, hold, suspended: suspends(hold) };
  }
  return { activeLeg, approach, hold: pending, suspended: false };
}

/** What comes after the active leg: the next enroute leg, the approach, or the next procedure leg. */
function following(s: FmsState, leg: ActiveLeg, now: AirplaneNow): Following | null {
  const a = s.approach;
  const r = activeRouteLeg(s);
  if (r && a) return r.next ? enterApproachLeg(a, r.index + 1, leg.to, now, s.hold) : null;
  if (leg.planIndex !== null) {
    const next = s.plan[leg.planIndex + 1];
    if (next) return { activeLeg: { from: leg.to, to: next, planIndex: leg.planIndex + 1, isDirectTo: false }, approach: a, hold: s.hold, suspended: false };
    if (a && a.legs.length > 0 && leg.planIndex === s.plan.length - 1) return enterApproachLeg(a, approachEntryIndex(a, leg.to), leg.to, now, s.hold);
  }
  return null;
}

/** Course the leg after the active one starts on, for turn anticipation (null: fly over the waypoint). */
function followingEntryCourse(s: FmsState, leg: ActiveLeg): number | null {
  const a = s.approach;
  const r = activeRouteLeg(s);
  if (r) return r.next ? entryCourse(r.next, leg.to) : null;
  if (leg.planIndex === null) return null;
  const next = s.plan[leg.planIndex + 1];
  if (next) return distanceNm(leg.to, next) > 0.05 ? bearing(leg.to, next) : null;
  if (a && leg.planIndex === s.plan.length - 1) {
    const first = a.legs[approachEntryIndex(a, leg.to)];
    return first ? entryCourse(first, leg.to) : null;
  }
  return null;
}

function apply(s: FmsState, f: Following): FmsState {
  return bump(s, { activeLeg: f.activeLeg, approach: f.approach, hold: f.hold, suspended: f.suspended, obsMode: false });
}

/** Leaves a hold at its fix: on to whatever follows it. */
function leaveHold(s: FmsState, now: AirplaneNow): FmsState {
  const leg = s.activeLeg!;
  const cleared: FmsState = { ...s, hold: null, suspended: false };
  const next = following(cleared, leg, now);
  if (next) return apply(cleared, next);
  // A hold at the end of the procedure: carry on along its inbound course.
  return bump(cleared, { activeLeg: { ...leg, stage: 'exited' } });
}

/** Whether the airplane has reached the waypoint the active leg ends at (flown over, no anticipation). */
function reachedFix(s: FmsState, now: AirplaneNow): boolean {
  const leg = s.activeLeg!;
  if (distanceNm(now.pos, leg.to) < 0.15) return true;
  const r = activeRouteLeg(s);
  if (r?.leg.path === 'DF') return directPassed(leg.to, now);
  const g = r ? routeGuidance(leg, r.leg, r.next, now.pos, now.trackTrue) : tfGuidance(leg.from, leg.to, now.pos);
  return g.remainingNm <= 0;
}

/**
 * One FMS step: holds, procedure turn stages, leg termination, SUSP at the
 * MAP, and the hand-over from the enroute plan into the approach.
 */
export function stepRoute(s: FmsState, now: AirplaneNow): FmsState {
  const leg = s.activeLeg;
  if (!leg || s.obsMode) return s;

  const h = s.hold;
  if (h && sameWaypoint(h.fix, leg.to)) {
    if (h.entryStep === 'toFix') {
      if (!reachedFix(s, now)) {
        // Show the entry the airplane is set up for (it is chosen for good at the fix).
        const expected = holdEntry(bearing(now.pos, h.fix), h.inboundCourseTrue ?? h.inboundCourseMag, h.turn);
        return expected === h.entry ? s : { ...s, hold: { ...h, entry: expected } };
      }
      const started = startHold(h, now);
      return bump(s, { hold: started, suspended: suspends(started) });
    }
    const step = stepHold(h, now);
    if (!step.crossed) return step.hold === h ? s : { ...s, hold: step.hold };
    return holdExits(step.hold, now.altitudeFt) ? leaveHold({ ...s, hold: step.hold }, now) : { ...s, hold: step.hold };
  }
  if (s.suspended) return s;

  const r = activeRouteLeg(s);
  if (r && s.approach) {
    if (isHoldPath(r.leg.path)) {
      // A hold leg without its hold (activated out of sequence, or restored): fly to the fix and hold there.
      if (leg.stage === 'exited' || h) return s;
      return { ...s, hold: pendingHold(holdSetup(r.leg, leg.to), now.time) };
    }
    if (r.leg.path === 'PI') {
      const stage = procedureTurnStage(leg, r.leg, r.next, now);
      if (stage !== leg.stage) return { ...s, activeLeg: { ...leg, ...(stage && { stage }) } };
    }
    const g = routeGuidance(leg, r.leg, r.next, now.pos, now.trackTrue);
    if (!routeLegComplete(leg, r.leg, r.next, g, now)) return s;
    if (r.index === approachIndices(s.approach.legs).map) return bump(s, { suspended: true });
    const next = following(s, leg, now);
    return next ? apply(s, next) : s;
  }

  if (leg.planIndex === null) return s;
  const last = leg.planIndex === s.plan.length - 1;
  if (!s.plan[leg.planIndex + 1] && !(last && s.approach && s.approach.legs.length > 0)) return s;
  // Enroute leg: start the turn onto what follows a turn radius early.
  const entry = followingEntryCourse(s, leg);
  const lead = entry === null ? 0 : turnAnticipationNm(now.groundSpeedKt, angleDiff(entry, exitCourse(leg, null, now.pos)));
  if (tfGuidance(leg.from, leg.to, now.pos).remainingNm > lead) return s;
  const next = following(s, leg, now);
  return next ? apply(s, next) : s;
}

/** Distance along the route from the airplane to the end of approach leg `target`, or null if it is behind. */
export function distanceAlongToNm(s: FmsState, pos: LatLon, target: number): number | null {
  const a = s.approach;
  const leg = s.activeLeg;
  if (!a || !leg || target < 0 || target >= a.legs.length) return null;
  const r = activeRouteLeg(s);
  let total: number;
  let from: number;
  let at: LatLon;
  if (r) {
    if (target < r.index) return null;
    total = distanceNm(pos, leg.to);
    from = r.index + 1;
    at = leg.to;
  } else if (leg.planIndex !== null) {
    total = distanceNm(pos, leg.to);
    for (let i = leg.planIndex + 1; i < s.plan.length; i++) total += distanceNm(s.plan[i - 1]!, s.plan[i]!);
    at = s.plan[s.plan.length - 1] ?? leg.to;
    from = approachEntryIndex(a, s.plan[s.plan.length - 1] ?? null);
  } else return null;
  for (let i = from; i <= target; i++) {
    const l = a.legs[i]!;
    total += approachLegLengthNm(l, at);
    if (l.to) at = l.to;
  }
  return total;
}

/** Length of a procedure leg flown from `at`: fix to fix, along an arc, or a published distance. */
export function approachLegLengthNm(l: RouteLeg, at: LatLon): number {
  if ((l.path === 'RF' || l.path === 'AF') && l.to && l.arcCenter && l.arcRadiusNm && l.turn) {
    const a0 = bearing(l.arcCenter, at);
    const a1 = bearing(l.arcCenter, l.to);
    const sweep = l.turn === 'R' ? (a1 - a0 + 360) % 360 : (a0 - a1 + 360) % 360;
    return toRad(sweep) * l.arcRadiusNm;
  }
  if (isHoldPath(l.path) || l.path === 'PI') return 0;
  if (l.to && ['IF', 'TF', 'CF', 'DF'].includes(l.path)) return distanceNm(at, l.to);
  return l.distanceNm ?? 0;
}
