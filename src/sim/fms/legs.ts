import { angleDiff, bearing, destination, distanceNm, norm360, toRad, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import {
  arcTangentTrue,
  onArc,
  onCourseLine,
  rayCircleIntersectionNm,
  rayLineIntersectionNm,
  turnAnticipationNm,
  turnRadiusNm,
} from './geometry';
import { directGuidance, lineGuidance, tfGuidance, type AirplaneNow, type LegGuidance, type SteerTrue } from './guidance';
import { constraintFt, isHoldPath } from './procedure';
import type { ActiveLeg, RouteLeg } from './types';

/*
 * Procedure legs as the FMS flies them (ARINC 424 path terminators):
 *
 *   IF  initial fix: direct to it when activated, else a TF from the last fix
 *   TF  great circle fix to fix           CF  course line into the fix
 *   DF  direct to the fix from wherever the leg begins, honouring a published turn
 *   RF  constant-radius arc to the fix     AF  DME arc around the navaid to the fix
 *   CA / FA / VA   course (from present position / from the fix) or heading until an altitude
 *   CI / VI        course or heading until the next leg is intercepted
 *   CR / VR        course or heading until a radial
 *   FC             course from the fix for a distance
 *   FD / CD / VD   course from the fix / course / heading until a DME distance
 *   FM / VM        course from the fix / heading until the pilot sequences (MANSEQ)
 *   PI             procedure turn: outbound, 45 degree leg, 180 degree turn, intercept inbound
 *   HM / HA / HF   holds (hold.ts): until exited, until an altitude, one circuit
 *
 * Legs that end without a fix get a computed termination waypoint (named
 * like their label: "1100ft", "INTRCPT", "D134J") so `activeLeg.to` always
 * has a position for distances and maps.
 */

/** Climb gradient used to estimate where an altitude leg ends, ft per nm. */
const ESTIMATED_CLIMB_FT_PER_NM = 500;
/** Length drawn for legs that end at an intercept or manually, nm. */
const OPEN_LEG_NM = 10;
/** Procedure turn: outbound from the fix, then the 45 degree leg until this far off the inbound course. */
const PT_OUTBOUND_NM = 1.5;
const PT_OFFSET_NM = 1.1;

/** A waypoint for the present position, the origin of a direct-to leg. */
export function presentPosition(pos: LatLon): Waypoint {
  return { kind: 'user', ident: 'P.POS', name: 'Present position', lat: pos.lat, lon: pos.lon };
}

const computed = (ident: string, p: LatLon): Waypoint => ({ kind: 'user', ident, name: ident, lat: p.lat, lon: p.lon });

/** The leg's course (true), falling back on its geometry when the data has none. */
function legCourse(leg: RouteLeg, from: LatLon, to: LatLon | null): number {
  if (leg.courseTrue !== undefined) return leg.courseTrue;
  return to && distanceNm(from, to) > 0.01 ? bearing(from, to) : 0;
}

/** A line the next leg flies along, for intercept legs. */
type InterceptTarget =
  | { readonly kind: 'line'; readonly origin: LatLon; readonly courseTrue: number }
  | { readonly kind: 'arc'; readonly center: LatLon; readonly radiusNm: number; readonly turn: 'L' | 'R' };

function interceptTarget(next: RouteLeg | undefined): InterceptTarget | null {
  if (!next) return null;
  if ((next.path === 'RF' || next.path === 'AF') && next.arcCenter && next.arcRadiusNm && next.turn) {
    return { kind: 'arc', center: next.arcCenter, radiusNm: next.arcRadiusNm, turn: next.turn };
  }
  if (next.to && next.courseTrue !== undefined && ['CF', 'FC', 'FA', 'FD', 'FM'].includes(next.path)) {
    return { kind: 'line', origin: next.to, courseTrue: next.courseTrue };
  }
  return null;
}

function terminationPoint(leg: RouteLeg, next: RouteLeg | undefined, origin: LatLon, courseTrue: number, now: AirplaneNow): Waypoint {
  const along = (nm: number) => computed(leg.label, destination(origin, courseTrue, nm));
  switch (leg.path) {
    case 'FC':
      return along(leg.distanceNm ?? 1);
    case 'FD':
    case 'CD':
    case 'VD': {
      if (leg.navaid && leg.distanceNm !== undefined) {
        const t = rayCircleIntersectionNm(origin, courseTrue, leg.navaid, leg.distanceNm);
        if (t !== null) return along(t);
      }
      return along(leg.distanceNm ?? OPEN_LEG_NM);
    }
    case 'CA':
    case 'FA':
    case 'VA': {
      const target = constraintFt(leg.altitude);
      const climb = target === null ? 0 : Math.max(target - now.altitudeFt, 0);
      return along(Math.max(climb / ESTIMATED_CLIMB_FT_PER_NM, 0.5));
    }
    case 'VI':
    case 'CI': {
      const target = interceptTarget(next);
      if (target?.kind === 'line') {
        const t = rayLineIntersectionNm(origin, courseTrue, target.origin, target.courseTrue);
        if (t !== null && t < 60) return along(t);
      }
      return along(OPEN_LEG_NM);
    }
    case 'CR':
    case 'VR': {
      if (leg.navaid && leg.radialTrue !== undefined) {
        const t = rayLineIntersectionNm(origin, courseTrue, leg.navaid, leg.radialTrue);
        if (t !== null && t < 60) return along(t);
      }
      return along(OPEN_LEG_NM);
    }
    default:
      return along(OPEN_LEG_NM);
  }
}

/**
 * The active leg for `legs[index]`. `start` is where the previous leg ended;
 * null joins the leg from the present position (direct-to, activation).
 */
export function routeActiveLeg(legs: readonly RouteLeg[], index: number, start: Waypoint | null, now: AirplaneNow): ActiveLeg {
  const leg = legs[index]!;
  const next = legs[index + 1];
  const here = presentPosition(now.pos);
  const fix = leg.to;
  const base = { planIndex: null, approachIndex: index } as const;
  switch (leg.path) {
    case 'FC':
    case 'FA':
    case 'FD':
    case 'FM': {
      const origin = fix ?? start ?? here;
      return { ...base, from: origin, to: terminationPoint(leg, next, origin, legCourse(leg, origin, null), now), isDirectTo: false };
    }
    case 'PI': {
      const at = fix ?? start ?? here;
      return { ...base, from: at, to: at, isDirectTo: false, stage: 'outbound' };
    }
    case 'CA':
    case 'CI':
    case 'CD':
    case 'CR':
    case 'VA':
    case 'VI':
    case 'VM':
    case 'VD':
    case 'VR':
      return { ...base, from: here, to: terminationPoint(leg, next, here, legCourse(leg, here, null), now), isDirectTo: false };
    case 'DF':
      return { ...base, from: here, to: fix ?? here, isDirectTo: false };
    default:
      // IF, TF, CF, RF, AF and the fix a hold is flown at.
      return { ...base, from: start ?? here, to: fix ?? start ?? here, isDirectTo: start === null };
  }
}

const heading = (g: LegGuidance, headingTrue: number, turn: 'L' | 'R' | undefined): LegGuidance => {
  const steer: SteerTrue = turn ? { kind: 'heading', headingTrue, turn } : { kind: 'heading', headingTrue };
  return { ...g, steer };
};

interface TurnGeometry {
  readonly inbound: number;
  readonly outbound: number;
  readonly away: number;
  readonly back: number;
  readonly turn: 'L' | 'R';
}

/** Procedure turn geometry: the published course is the 45 degree leg; the next leg gives the inbound course. */
function procedureTurn(leg: RouteLeg, next: RouteLeg | undefined, fix: LatLon): TurnGeometry {
  const away = leg.courseTrue ?? 0;
  const turnGuess: 'L' | 'R' = leg.turn ?? 'R';
  let inbound: number;
  if (next?.courseTrue !== undefined) inbound = next.courseTrue;
  else if (next?.to && distanceNm(fix, next.to) > 0.05) inbound = bearing(fix, next.to);
  else inbound = norm360(away + (turnGuess === 'R' ? 225 : 135));
  const outbound = norm360(inbound + 180);
  // The 180 degree turn goes back toward the inbound course.
  const turn: 'L' | 'R' = leg.turn ?? (angleDiff(away, outbound) < 0 ? 'R' : 'L');
  return { inbound, outbound, away, back: norm360(away + 180), turn };
}

/** CDI and steering on a procedure leg (holds excepted, see hold.ts). */
export function routeGuidance(active: ActiveLeg, leg: RouteLeg, next: RouteLeg | undefined, pos: LatLon, trackTrue: number): LegGuidance {
  const course = () => legCourse(leg, active.from, active.to);
  switch (leg.path) {
    case 'CF':
      return leg.courseTrue === undefined ? tfGuidance(active.from, active.to, pos) : lineGuidance(active.to, leg.courseTrue, pos, 0);
    case 'FC':
    case 'FD':
    case 'CD':
      return lineGuidance(active.from, course(), pos, distanceNm(active.from, active.to));
    case 'FA':
    case 'FM':
    case 'CA':
    case 'CI':
    case 'CR':
      return lineGuidance(active.from, course(), pos, Infinity);
    case 'VD':
      return heading(lineGuidance(active.from, course(), pos, distanceNm(active.from, active.to)), course(), leg.turn);
    case 'VA':
    case 'VI':
    case 'VM':
    case 'VR':
      return heading(lineGuidance(active.from, course(), pos, Infinity), course(), leg.turn);
    case 'DF':
      return directGuidance(active.to, pos, trackTrue, leg.turn);
    case 'RF':
    case 'AF': {
      if (!leg.arcCenter || !leg.arcRadiusNm || !leg.turn) return tfGuidance(active.from, active.to, pos);
      const g = onArc(leg.arcCenter, leg.arcRadiusNm, leg.turn, active.from, active.to, pos);
      return {
        dtkTrue: g.dtkTrue,
        xtkNm: g.xtkNm,
        toFrom: g.remainingNm > 0 ? 'TO' : 'FROM',
        remainingNm: g.remainingNm,
        steer: { kind: 'arc', courseTrue: g.dtkTrue, xtkNm: g.xtkNm, turn: leg.turn, radiusNm: leg.arcRadiusNm },
      };
    }
    case 'PI': {
      const pt = procedureTurn(leg, next, active.to);
      const level = (dtkTrue: number): LegGuidance => ({
        dtkTrue,
        xtkNm: 0,
        toFrom: 'FROM',
        remainingNm: Infinity,
        steer: { kind: 'track', courseTrue: dtkTrue, xtkNm: 0 },
      });
      switch (active.stage) {
        case 'away':
          return level(pt.away);
        case 'turn':
          return heading(level(pt.back), pt.back, pt.turn);
        case 'back':
          return { ...level(pt.back), toFrom: 'TO' };
        default:
          return { ...lineGuidance(active.to, pt.outbound, pos, Infinity), toFrom: 'FROM' };
      }
    }
    case 'HM':
    case 'HA':
    case 'HF':
      // Past a final hold the course continues inbound through the fix.
      if (active.stage === 'exited' && leg.courseTrue !== undefined) return lineGuidance(active.to, leg.courseTrue, pos, 0);
      return tfGuidance(active.from, active.to, pos);
    default:
      return tfGuidance(active.from, active.to, pos);
  }
}

/** Procedure turn progress: the stage to fly next, or the same one. */
export function procedureTurnStage(active: ActiveLeg, leg: RouteLeg, next: RouteLeg | undefined, now: AirplaneNow): ActiveLeg['stage'] {
  const pt = procedureTurn(leg, next, active.to);
  switch (active.stage) {
    case 'away':
      return Math.abs(onCourseLine(active.to, pt.outbound, now.pos).xtkNm) >= PT_OFFSET_NM ? 'turn' : 'away';
    case 'turn':
      return Math.abs(angleDiff(now.trackTrue, pt.back)) < 20 ? 'back' : 'turn';
    case 'back':
      return 'back';
    default:
      return onCourseLine(active.to, pt.outbound, now.pos).alongNm >= PT_OUTBOUND_NM ? 'away' : 'outbound';
  }
}

/** Course the airplane is on as it finishes a leg, for turn anticipation. */
export function exitCourse(active: ActiveLeg, leg: RouteLeg | null, pos: LatLon): number {
  if (leg && (leg.path === 'RF' || leg.path === 'AF') && leg.arcCenter && leg.turn) return arcTangentTrue(leg.arcCenter, leg.turn, active.to);
  if (leg && leg.courseTrue !== undefined && !['IF', 'TF', 'DF'].includes(leg.path)) return leg.courseTrue;
  if (leg?.path === 'DF') return bearing(pos, active.to);
  return distanceNm(active.from, active.to) > 0.01 ? norm360(bearing(active.to, active.from) + 180) : bearing(pos, active.to);
}

/** Course the next leg starts on from `at`, or null when it starts with a fly-over (holds, procedure turns). */
export function entryCourse(next: RouteLeg, at: LatLon): number | null {
  switch (next.path) {
    case 'HM':
    case 'HA':
    case 'HF':
    case 'PI':
      return null;
    case 'RF':
    case 'AF':
      return next.arcCenter && next.turn ? arcTangentTrue(next.arcCenter, next.turn, at) : null;
    case 'IF':
    case 'TF':
    case 'DF':
      return next.to && distanceNm(at, next.to) > 0.05 ? bearing(at, next.to) : null;
    default:
      return next.courseTrue ?? (next.to && distanceNm(at, next.to) > 0.05 ? bearing(at, next.to) : null);
  }
}

/** How far before the end of the leg to start the turn onto the next one (0: fly over the fix). */
export function leadNm(exitTrue: number, next: RouteLeg | null, at: LatLon, groundSpeedKt: number, flyover: boolean): number {
  if (flyover || !next) return 0;
  const entry = entryCourse(next, at);
  return entry === null ? 0 : turnAnticipationNm(groundSpeedKt, angleDiff(entry, exitTrue));
}

function altitudeReached(leg: RouteLeg, altitudeFt: number): boolean {
  const c = leg.altitude;
  if (!c) return true;
  switch (c.kind) {
    case 'atOrBelow':
      return altitudeFt <= c.ft + 20;
    case 'between':
      return altitudeFt >= c.aboveFt - 20;
    default:
      return altitudeFt >= c.ft - 20;
  }
}

/** Signed cross-track from an intercept target (positive right of its direction) and its course there. */
function targetPosition(t: InterceptTarget, pos: LatLon): { readonly xtkNm: number; readonly courseTrue: number } {
  if (t.kind === 'line') {
    const l = onCourseLine(t.origin, t.courseTrue, pos);
    return { xtkNm: l.xtkNm, courseTrue: l.dtkTrue };
  }
  const d = distanceNm(t.center, pos);
  return { xtkNm: t.turn === 'R' ? t.radiusNm - d : d - t.radiusNm, courseTrue: arcTangentTrue(t.center, t.turn, pos) };
}

/**
 * Whether the next leg's path is about to be captured: within the turn lead
 * and closing, on it, or already across it (seen from where the leg began).
 * A heading that will never get there (near parallel, or drifting away) is
 * given up once the airplane is abeam the next leg's fix, so the FMS goes on
 * to it instead of flying the heading forever.
 */
function interceptReached(next: RouteLeg | undefined, from: LatLon, now: AirplaneNow): boolean {
  const target = interceptTarget(next);
  // Nothing to intercept (a TF or DF follows): hand over straight away.
  if (!target) return true;
  if (target.kind === 'line' && onCourseLine(target.origin, target.courseTrue, now.pos).alongNm >= 0) return true;
  const { xtkNm, courseTrue } = targetPosition(target, now.pos);
  const theta = toRad(angleDiff(now.trackTrue, courseTrue));
  if (Math.abs(xtkNm) <= 0.05) return true;
  const closing = xtkNm * Math.sin(theta) < 0;
  const lead = turnRadiusNm(now.groundSpeedKt) * (1 - Math.cos(theta));
  if (closing && Math.abs(xtkNm) <= lead + 0.05) return true;
  const startSide = Math.sign(targetPosition(target, from).xtkNm);
  return startSide !== 0 && Math.sign(xtkNm) !== startSide && Math.abs(xtkNm) < 2;
}

function radialReached(leg: RouteLeg, from: LatLon, pos: LatLon): boolean {
  if (!leg.navaid || leg.radialTrue === undefined) return true;
  const now = onCourseLine(leg.navaid, leg.radialTrue, pos);
  const start = onCourseLine(leg.navaid, leg.radialTrue, from).xtkNm;
  return now.alongNm > 0 && (Math.abs(now.xtkNm) < 0.05 || Math.sign(now.xtkNm) !== Math.sign(start));
}

/** A fix-terminated leg flown over (no anticipation) is complete once the fix is behind. */
export function directPassed(to: LatLon, now: AirplaneNow): boolean {
  const d = distanceNm(now.pos, to);
  return d < 0.1 || (d < 1 && Math.abs(angleDiff(bearing(now.pos, to), now.trackTrue)) > 90);
}

/** Whether a procedure leg has ended (holds are ended by the hold state machine instead). */
export function routeLegComplete(active: ActiveLeg, leg: RouteLeg, next: RouteLeg | undefined, g: LegGuidance, now: AirplaneNow): boolean {
  switch (leg.path) {
    case 'CA':
    case 'FA':
    case 'VA':
      return altitudeReached(leg, now.altitudeFt);
    case 'VI':
    case 'CI':
      return interceptReached(next, active.from, now);
    case 'CR':
    case 'VR':
      return radialReached(leg, active.from, now.pos);
    case 'VM':
    case 'FM':
    case 'HM':
    case 'HA':
    case 'HF':
      return false;
    case 'PI':
      return active.stage === 'back' && interceptReached(next, destination(active.to, procedureTurn(leg, next, active.to).away, 1), now);
    default: {
      const flyover = leg.flyover === true || leg.role === 'MAP' || !next || isHoldPath(next.path) || next.path === 'PI';
      const lead = leadNm(exitCourse(active, leg, now.pos), next ?? null, active.to, now.groundSpeedKt, flyover);
      if (leg.path === 'DF') return lead > 0 ? g.remainingNm <= lead : directPassed(active.to, now);
      return g.remainingNm <= lead;
    }
  }
}
