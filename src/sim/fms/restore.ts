import type { Waypoint } from '../../core/navdb';
import type { ActiveLeg, FmsState, HoldState, LoadedApproach, RouteLeg } from './types';

/*
 * Restoring the FMS from a saved session. The generic merge in persist.ts
 * keeps only fields the defaults have, which would lose a loaded approach,
 * a hold and the extra fields of an approach leg; here each part is checked
 * for shape instead, and anything inconsistent (a leg pointing past the plan
 * or the approach) is dropped rather than flown.
 */

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown) => v === undefined || isNum(v);
const numOrNull = (v: unknown) => v === null || isNum(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);

const KINDS = ['airport', 'vor', 'ndb', 'fix', 'user'] as const;
const PATHS = ['IF', 'TF', 'CF', 'DF', 'FA', 'FC', 'FD', 'FM', 'CA', 'CD', 'CI', 'CR', 'RF', 'AF', 'VA', 'VD', 'VI', 'VM', 'VR', 'PI', 'HA', 'HF', 'HM'] as const;
const STAGES = ['outbound', 'away', 'turn', 'back', 'exited'] as const;

export function isWaypoint(v: unknown): v is Waypoint {
  return isPlain(v) && oneOf(v.kind, KINDS) && typeof v.ident === 'string' && typeof v.name === 'string' && isNum(v.lat) && isNum(v.lon);
}

function isRouteLeg(v: unknown): v is RouteLeg {
  return (
    isPlain(v) &&
    oneOf(v.path, PATHS) &&
    (v.to === null || isWaypoint(v.to)) &&
    oneOf(v.segment, ['transition', 'final', 'missed'] as const) &&
    typeof v.label === 'string' &&
    optNum(v.courseMag) &&
    optNum(v.courseTrue) &&
    optNum(v.distanceNm) &&
    optNum(v.legTimeMin) &&
    optNum(v.arcRadiusNm) &&
    (v.turn === undefined || v.turn === 'L' || v.turn === 'R')
  );
}

function isLoadedApproach(v: unknown): v is LoadedApproach {
  if (!isPlain(v) || !isWaypoint(v.airport) || !isPlain(v.approach)) return false;
  const a = v.approach;
  return (
    typeof a.id === 'string' &&
    typeof a.type === 'string' &&
    typeof a.name === 'string' &&
    Array.isArray(a.transitions) &&
    Array.isArray(a.final) &&
    Array.isArray(a.missed) &&
    Array.isArray(a.minima) &&
    (v.transition === null || typeof v.transition === 'string') &&
    Array.isArray(v.legs) &&
    v.legs.every(isRouteLeg) &&
    typeof v.vectorsToFinal === 'boolean' &&
    typeof v.activated === 'boolean'
  );
}

function activeLegOf(v: unknown): ActiveLeg | null {
  if (!isPlain(v) || !isWaypoint(v.from) || !isWaypoint(v.to) || !numOrNull(v.planIndex) || typeof v.isDirectTo !== 'boolean') return null;
  const approachIndex = isNum(v.approachIndex) ? v.approachIndex : null;
  return {
    from: v.from,
    to: v.to,
    planIndex: v.planIndex as number | null,
    isDirectTo: v.isDirectTo,
    approachIndex,
    ...(isNum(v.courseMag) && { courseMag: v.courseMag }),
    ...(oneOf(v.stage, STAGES) && { stage: v.stage }),
  };
}

function isHold(v: unknown): v is HoldState {
  return (
    isPlain(v) &&
    isWaypoint(v.fix) &&
    isNum(v.inboundCourseMag) &&
    (v.turn === 'L' || v.turn === 'R') &&
    numOrNull(v.legTimeMin) &&
    numOrNull(v.legNm) &&
    oneOf(v.entry, ['direct', 'teardrop', 'parallel'] as const) &&
    oneOf(v.phase, ['entry', 'outbound', 'inbound', 'turnOutbound', 'turnInbound'] as const) &&
    isNum(v.phaseStartedAt) &&
    typeof v.exitArmed === 'boolean' &&
    oneOf(v.source, ['procedure', 'pilot'] as const) &&
    (v.entryStep === undefined || oneOf(v.entryStep, ['toFix', 'turn', 'leg', 'return'] as const)) &&
    optNum(v.inboundCourseTrue) &&
    optNum(v.radiusNm) &&
    optNum(v.legLengthNm) &&
    optNum(v.circuits) &&
    (v.termination === undefined || oneOf(v.termination, ['manual', 'fix', 'altitude'] as const)) &&
    (v.exitAltitudeFt === undefined || numOrNull(v.exitAltitudeFt))
  );
}

/** The FMS from a saved session, over `merged` (the generic merge of the saved state onto the defaults). */
export function restoreFms(merged: FmsState, saved: unknown): FmsState {
  if (!isPlain(saved)) return merged;
  const plan = Array.isArray(saved.plan) && saved.plan.every(isWaypoint) ? (saved.plan as Waypoint[]) : merged.plan;
  const approach = isLoadedApproach(saved.approach) ? saved.approach : null;
  let leg = 'activeLeg' in saved ? activeLegOf(saved.activeLeg) : merged.activeLeg;
  if (leg) {
    const planOk = leg.planIndex === null || plan[leg.planIndex]?.ident === leg.to.ident;
    const ai = leg.approachIndex ?? null;
    const approachOk = ai === null || (approach !== null && ai >= 0 && ai < approach.legs.length && leg.planIndex === null);
    if (!planOk || !approachOk) leg = null;
  }
  const hold = leg && isHold(saved.hold) ? saved.hold : null;
  return {
    ...merged,
    plan,
    activeLeg: leg,
    approach,
    hold,
    suspended: leg !== null && saved.suspended === true,
  };
}
