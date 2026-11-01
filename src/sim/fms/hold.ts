import { angleDiff, norm360, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import { courseOf, dot, holdEntry, onCourseLine, standardRateRadiusNm, sub, toLocal, unit, type Vec } from './geometry';
import type { AirplaneNow, LegGuidance, SteerTrue } from './guidance';
import type { HoldState } from './types';

/*
 * Holding patterns: entry selection and the racetrack state machine.
 *
 * The racetrack is laid out in a flat frame at the fix: `u` along the inbound
 * course, `s` toward the holding side. With turn radius r and leg length L:
 *
 *   inbound leg   c = 0 from a = -L to the fix (a = 0)
 *   turn at fix   around (a, c) = (0, r) to abeam the fix on the outbound side
 *   outbound leg  c = 2r from a = 0 to a = -L
 *   turn inbound  around (-L, r) back onto the inbound course
 *
 * Entries (AIM 5-3-8), chosen from the track when the fix is crossed:
 *   direct    straight into the turn at the fix (or a turn in the holding
 *             direction to the outbound heading when arriving well off the
 *             inbound course), then the outbound leg
 *   teardrop  out on the outbound course offset 30 degrees toward the holding
 *             side for one leg length, turn in the holding direction to the
 *             inbound course
 *   parallel  outbound on the non-holding side for one leg length, turn away
 *             from the holding direction through about 225 degrees, intercept
 *             the inbound course at 45 degrees
 */

/** Minimum and default timed leg below 14,000 ft, minutes. */
const DEFAULT_LEG_MIN = 1;
const HIGH_LEG_MIN = 1.5;
/** Radius margin over standard rate, so the racetrack can be flown in wind within the autopilot's bank limit. */
const RADIUS_MARGIN = 1.15;

export interface HoldSetup {
  readonly fix: Waypoint;
  readonly inboundCourseMag: number;
  readonly inboundCourseTrue: number;
  readonly turn: 'L' | 'R';
  readonly legTimeMin: number | null;
  readonly legNm: number | null;
  readonly source: HoldState['source'];
  readonly termination: NonNullable<HoldState['termination']>;
  readonly exitAltitudeFt: number | null;
}

/** A hold waiting for the airplane to reach its fix. */
export function pendingHold(setup: HoldSetup, time: number): HoldState {
  return {
    fix: setup.fix,
    inboundCourseMag: setup.inboundCourseMag,
    turn: setup.turn,
    legTimeMin: setup.legTimeMin,
    legNm: setup.legNm,
    entry: 'direct',
    phase: 'entry',
    phaseStartedAt: time,
    exitArmed: false,
    source: setup.source,
    entryStep: 'toFix',
    inboundCourseTrue: setup.inboundCourseTrue,
    circuits: 0,
    termination: setup.termination,
    exitAltitudeFt: setup.exitAltitudeFt,
  };
}

/** Inbound course true, for holds restored or built without it. */
const inboundTrue = (h: HoldState) => h.inboundCourseTrue ?? h.inboundCourseMag;
const outboundTrue = (h: HoldState) => norm360(inboundTrue(h) + 180);

function legLength(h: HoldState, tasKt: number, altitudeFt: number): number {
  if (h.legNm !== null && h.legNm > 0) return h.legNm;
  const minutes = h.legTimeMin ?? (altitudeFt > 14000 ? HIGH_LEG_MIN : DEFAULT_LEG_MIN);
  return Math.max((Math.max(tasKt, 60) * minutes) / 60, 0.5);
}

/** The airplane has reached the fix: pick the entry and size the racetrack. */
export function startHold(h: HoldState, now: AirplaneNow): HoldState {
  const entry = holdEntry(now.trackTrue, inboundTrue(h), h.turn);
  const radiusNm = RADIUS_MARGIN * standardRateRadiusNm(Math.max(now.tasKt, now.groundSpeedKt));
  const legLengthNm = legLength(h, now.tasKt, now.altitudeFt);
  const base = { ...h, entry, radiusNm, legLengthNm, circuits: 0, phaseStartedAt: now.time, exitArmed: h.exitArmed };
  if (entry === 'direct') {
    // Arriving roughly along the inbound course the turn at the fix is the racetrack's own.
    const aligned = Math.abs(angleDiff(now.trackTrue, inboundTrue(h))) <= 45;
    return aligned ? { ...base, phase: 'turnOutbound', entryStep: 'turn' } : { ...base, phase: 'entry', entryStep: 'turn' };
  }
  return { ...base, phase: 'entry', entryStep: 'leg' };
}

interface Frame {
  readonly u: Vec;
  readonly s: Vec;
  readonly r: number;
  readonly L: number;
}

function frame(h: HoldState): Frame {
  const u = unit(inboundTrue(h));
  // Holding side: right of the inbound course for right turns.
  const s = h.turn === 'R' ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  return { u, s, r: h.radiusNm ?? 0.6, L: h.legLengthNm ?? 2 };
}

const right = (v: Vec): Vec => ({ x: v.y, y: -v.x });

/** Guidance along a straight line through `q` (local) in direction `v`. */
function localLine(p: Vec, q: Vec, v: Vec, toFrom: 'TO' | 'FROM'): LegGuidance {
  const xtkNm = dot(sub(p, q), right(v));
  const dtkTrue = courseOf(v);
  return { dtkTrue, xtkNm, toFrom, remainingNm: Infinity, steer: { kind: 'track', courseTrue: dtkTrue, xtkNm } };
}

function localArc(p: Vec, center: Vec, r: number, turn: 'L' | 'R', toFrom: 'TO' | 'FROM'): LegGuidance {
  const d = sub(p, center);
  const dist = Math.hypot(d.x, d.y);
  const dtkTrue = norm360(courseOf(d) + (turn === 'R' ? 90 : -90));
  const xtkNm = turn === 'R' ? r - dist : dist - r;
  return { dtkTrue, xtkNm, toFrom, remainingNm: Infinity, steer: { kind: 'arc', courseTrue: dtkTrue, xtkNm, turn, radiusNm: r } };
}

const opposite = (t: 'L' | 'R'): 'L' | 'R' => (t === 'R' ? 'L' : 'R');

/** Course the teardrop entry flies: 30 degrees from the outbound course toward the holding side. */
const teardropCourse = (h: HoldState) => norm360(inboundTrue(h) + (h.turn === 'R' ? 150 : -150));
/** Heading that closes on the inbound course from the holding side after a parallel entry. */
const parallelReturn = (h: HoldState) => norm360(inboundTrue(h) + (h.turn === 'R' ? -45 : 45));

/** Guidance in the hold (not while flying to the fix: the leg to it guides then). */
export function holdGuidance(h: HoldState, pos: LatLon): LegGuidance {
  const f = frame(h);
  const p = toLocal(h.fix, pos);
  const origin = { x: 0, y: 0 };
  const back = { x: -f.u.x, y: -f.u.y };
  const outboundLine = { x: 2 * f.r * f.s.x, y: 2 * f.r * f.s.y };
  const heading = (headingTrue: number, turn: 'L' | 'R', cdi: LegGuidance): LegGuidance => {
    const steer: SteerTrue = { kind: 'heading', headingTrue, turn };
    return { ...cdi, dtkTrue: headingTrue, steer };
  };
  switch (h.phase) {
    case 'entry':
      switch (h.entryStep) {
        case 'leg':
          if (h.entry === 'teardrop') {
            const g = onCourseLine(h.fix, teardropCourse(h), pos);
            return { dtkTrue: g.dtkTrue, xtkNm: g.xtkNm, toFrom: 'FROM', remainingNm: Infinity, steer: { kind: 'track', courseTrue: g.dtkTrue, xtkNm: g.xtkNm } };
          }
          // Parallel: hold the outbound track on the non-holding side.
          return { ...localLine(p, origin, back, 'FROM'), steer: { kind: 'track', courseTrue: outboundTrue(h), xtkNm: 0 } };
        case 'return':
          return h.entry === 'parallel'
            ? heading(parallelReturn(h), opposite(h.turn), localLine(p, origin, f.u, 'TO'))
            : heading(inboundTrue(h), h.turn, localLine(p, origin, f.u, 'TO'));
        default:
          // Direct entry from well off the inbound course: turn the holding way to the outbound heading.
          return heading(outboundTrue(h), h.turn, localLine(p, outboundLine, back, 'FROM'));
      }
    case 'turnOutbound':
      return localArc(p, { x: f.r * f.s.x, y: f.r * f.s.y }, f.r, h.turn, 'FROM');
    case 'outbound':
      return localLine(p, outboundLine, back, 'FROM');
    case 'turnInbound':
      return localArc(p, { x: -f.L * f.u.x + f.r * f.s.x, y: -f.L * f.u.y + f.r * f.s.y }, f.r, h.turn, 'TO');
    case 'inbound':
      return localLine(p, origin, f.u, 'TO');
  }
}

export interface HoldStep {
  readonly hold: HoldState;
  /** Crossed the fix inbound: a circuit is complete. */
  readonly crossed: boolean;
}

/** Advances the racetrack state machine. */
export function stepHold(h: HoldState, now: AirplaneNow): HoldStep {
  const f = frame(h);
  const p = toLocal(h.fix, now.pos);
  const a = dot(p, f.u);
  const c = dot(p, f.s);
  const go = (patch: Partial<HoldState>): HoldStep => ({ hold: { ...h, ...patch, phaseStartedAt: now.time }, crossed: false });
  const aligned = (course: number, tol: number) => Math.abs(angleDiff(now.trackTrue, course)) < tol;
  switch (h.phase) {
    case 'entry':
      switch (h.entryStep) {
        case 'leg': {
          if (h.entry === 'teardrop') {
            const along = onCourseLine(h.fix, teardropCourse(h), now.pos).alongNm;
            return along >= f.L ? go({ entryStep: 'return' }) : { hold: h, crossed: false };
          }
          return a <= -f.L ? go({ entryStep: 'return' }) : { hold: h, crossed: false };
        }
        case 'return':
          if (h.entry === 'parallel') return aligned(parallelReturn(h), 15) ? go({ phase: 'inbound' }) : { hold: h, crossed: false };
          return aligned(inboundTrue(h), 50) ? go({ phase: 'inbound' }) : { hold: h, crossed: false };
        default:
          return aligned(outboundTrue(h), 20) ? go({ phase: 'outbound' }) : { hold: h, crossed: false };
      }
    case 'turnOutbound':
      return a <= 0 && c >= f.r ? go({ phase: 'outbound' }) : { hold: h, crossed: false };
    case 'outbound':
      return a <= -f.L ? go({ phase: 'turnInbound' }) : { hold: h, crossed: false };
    case 'turnInbound':
      return a >= -f.L && c <= f.r ? go({ phase: 'inbound' }) : { hold: h, crossed: false };
    case 'inbound':
      if (a < 0) return { hold: h, crossed: false };
      return { hold: { ...h, phase: 'turnOutbound', phaseStartedAt: now.time, circuits: (h.circuits ?? 0) + 1 }, crossed: true };
  }
}

/** Whether the hold ends at this crossing of the fix. */
export function holdExits(h: HoldState, altitudeFt: number): boolean {
  if (h.exitArmed) return true;
  switch (h.termination) {
    case 'fix':
      return true;
    case 'altitude':
      return h.exitAltitudeFt === null || h.exitAltitudeFt === undefined || altitudeFt >= h.exitAltitudeFt - 20;
    default:
      return false;
  }
}
