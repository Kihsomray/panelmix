import { angleDiff, bearing, destination, distanceNm, FT_PER_NM, norm360, toDeg, toRad, type LatLon } from '../../core/geo';
import type { MagneticModel } from '../../core/magvar';
import type { Waypoint } from '../../core/navdb';
import { shortApproachName, type Approach } from '../../core/procedures';
import type { AirplaneNow, LegGuidance } from './guidance';
import { presentPosition } from './legs';
import { angularLateral, approachIndices, approachMode, buildApproachLegs, gpsVertical, type ProcedureContext } from './procedure';
import { activeGuidance, activeRouteLeg, approachEntryIndex, bump, distanceAlongToNm, enterApproachLeg, sameWaypoint } from './route';
import type { ActiveLeg, ApproachDerived, FlightPhase, FmsState, LoadedApproach, RouteLeg, VerticalDerived } from './types';

/*
 * Instrument approaches in the flight plan: loading one after the enroute
 * waypoints (it replaces the destination airport, the way Garmin units do),
 * activating it from the transition's first fix or as vectors to final,
 * removing it, and what the approach looks like this frame: the flight phase
 * and CDI scale, the annunciated service level and the GPS glidepath.
 */

export type CdiScale = 'ENR' | 'TERM' | 'APR' | 'MAPR';

/** Full-scale CDI deflection by phase, nm (Garmin defaults). APR is where the ramp ends. */
export const CDI_FULL_SCALE_NM: Record<CdiScale, number> = { ENR: 2, TERM: 1, APR: 0.3, MAPR: 1 };

/** Terminal scaling within this distance of the departure or destination airport. */
const TERMINAL_NM = 30;
/** The approach scale ramps from TERM to APR over the last 2 nm to the FAF. */
const APR_RAMP_NM = 2;
/** Angular (LPV-like) lateral scaling: 350 ft either side at the threshold, opening toward the GARP. */
const ANGULAR_THRESHOLD_NM = 350 / FT_PER_NM;
/** Ground point of azimuth reference beyond the threshold (runway length plus 1,000 ft, typical). */
const GARP_BEYOND_THRESHOLD_NM = 1;
/** Vectors to final: the extended final approach course is drawn this far out from the FAF. */
const VTF_LINE_NM = 30;
/** GPS vertical full scale: a quarter of the path angle (angular), limited like WAAS VDIs. */
const GP_MIN_FULL_SCALE_FT = 49;
const GP_MAX_FULL_SCALE_FT = 492;

// Loading ----------------------------------------------------------------

/**
 * Loads an approach after the enroute plan. When the plan ends at the same
 * airport, that waypoint is replaced by the approach; a leg that was flying
 * to it now leads into the approach's first leg.
 */
export function loadApproach(
  s: FmsState,
  airport: Waypoint,
  approach: Approach,
  transition: string | null,
  now: AirplaneNow,
  ctx: ProcedureContext,
): FmsState {
  const legs = buildApproachLegs(approach, transition, airport, ctx);
  const last = s.plan[s.plan.length - 1];
  const destinationRemoved = !!last && last.kind === 'airport' && last.ident === airport.ident;
  const plan = destinationRemoved ? s.plan.slice(0, -1) : s.plan;
  const loaded: LoadedApproach = { airport, approach, transition, legs, vectorsToFinal: false, activated: false, destinationRemoved };
  const base: FmsState = { ...s, plan, approach: loaded, suspended: false, hold: s.hold?.source === 'pilot' ? s.hold : null };

  let leg = s.activeLeg;
  if (leg && leg.approachIndex !== null && leg.approachIndex !== undefined) {
    // Replacing an approach that was being flown: keep going to the same point, off the plan.
    leg = { from: leg.from, to: leg.to, planIndex: null, isDirectTo: leg.isDirectTo };
    return bump(base, { activeLeg: leg, hold: null });
  }
  if (leg && destinationRemoved && leg.planIndex === s.plan.length - 1) {
    if (leg.isDirectTo) return bump(base, { activeLeg: { ...leg, planIndex: null } });
    // The leg to the destination now flows into the approach.
    const f = enterApproachLeg(loaded, approachEntryIndex(loaded, leg.from), leg.from, now, base.hold);
    return bump(base, { activeLeg: f.activeLeg, approach: f.approach, hold: f.hold, suspended: f.suspended });
  }
  return bump(base, {});
}

/** Course into the final approach fix, true: the course the extended final approach course follows. */
function finalCourseTrue(legs: readonly RouteLeg[], faf: number): number {
  const leg = legs[faf]!;
  const fix = leg.to!;
  if (leg.path === 'CF' && leg.courseTrue !== undefined) return leg.courseTrue;
  const prev = legs[faf - 1]?.to;
  const next = legs[faf + 1]?.to;
  const after = next && distanceNm(fix, next) > 0.1 ? bearing(fix, next) : null;
  if (prev && distanceNm(prev, fix) > 0.1) {
    const into = norm360(bearing(fix, prev) + 180);
    if (after === null || Math.abs(angleDiff(into, after)) < 30) return into;
  }
  return after ?? leg.courseTrue ?? 0;
}

/**
 * Activates the loaded approach: direct to the first fix of the transition
 * (or the IF), or vectors to final: the leg into the FAF along the extended
 * final approach course.
 */
export function activateApproach(s: FmsState, vectorsToFinal: boolean, now: AirplaneNow): FmsState {
  const a = s.approach;
  if (!a || a.legs.length === 0) return s;
  const faf = approachIndices(a.legs).faf;
  const fafFix = faf !== null ? a.legs[faf]!.to : null;
  if (vectorsToFinal && faf !== null && fafFix) {
    const course = finalCourseTrue(a.legs, faf);
    const vtf: Waypoint = { kind: 'user', ident: 'VTF', name: 'Vectors to final', ...pick(destination(fafFix, course + 180, VTF_LINE_NM)) };
    const activeLeg: ActiveLeg = { from: vtf, to: fafFix, planIndex: null, isDirectTo: false, approachIndex: faf };
    return bump(s, { activeLeg, approach: { ...a, vectorsToFinal: true, activated: true }, suspended: false, hold: null, obsMode: false });
  }
  const f = enterApproachLeg({ ...a, vectorsToFinal: false }, 0, null, now, null);
  return bump(s, { activeLeg: f.activeLeg, approach: f.approach, hold: f.hold, suspended: f.suspended, obsMode: false });
}

const pick = (p: LatLon) => ({ lat: p.lat, lon: p.lon });

/** Activates one approach leg as published (from the fix before it), e.g. from a flight plan page. */
export function activateApproachLeg(s: FmsState, index: number, now: AirplaneNow): FmsState {
  const a = s.approach;
  if (!a || !a.legs[index]) return s;
  const start = index > 0 ? a.legs[index - 1]!.to : null;
  const f = enterApproachLeg({ ...a, vectorsToFinal: false }, index, start, now, null);
  return bump(s, { activeLeg: f.activeLeg, approach: f.approach, hold: f.hold, suspended: f.suspended, obsMode: false });
}

/** Removes the approach; the destination airport comes back, flown direct if the approach was being flown. */
export function removeApproach(s: FmsState, pos: LatLon): FmsState {
  const a = s.approach;
  if (!a) return s;
  const last = s.plan[s.plan.length - 1];
  const plan = a.destinationRemoved && !(last && sameWaypoint(last, a.airport)) ? [...s.plan, a.airport] : s.plan;
  const leg = s.activeLeg;
  const onApproach = !!leg && leg.approachIndex !== null && leg.approachIndex !== undefined;
  const activeLeg: ActiveLeg | null = onApproach
    ? { from: presentPosition(pos), to: a.airport, planIndex: plan.length > 0 && sameWaypoint(plan[plan.length - 1]!, a.airport) ? plan.length - 1 : null, isDirectTo: true }
    : leg;
  return bump(s, { plan, approach: null, activeLeg, suspended: false, hold: onApproach ? null : s.hold, obsMode: onApproach ? false : s.obsMode });
}

/** Leaves SUSP: past the MAP into the missed approach, out of a hold at the fix, or past a manually terminated leg. */
export function unsuspend(s: FmsState, now: AirplaneNow): FmsState {
  const leg = s.activeLeg;
  if (!leg) return s.suspended ? bump(s, { suspended: false }) : s;
  if (s.hold && s.hold.entryStep !== 'toFix') return bump(s, { hold: { ...s.hold, exitArmed: true } });
  const r = activeRouteLeg(s);
  if (r && s.approach && (s.suspended || r.leg.path === 'VM' || r.leg.path === 'FM') && r.next) {
    const f = enterApproachLeg(s.approach, r.index + 1, leg.to, now, s.hold);
    return bump(s, { activeLeg: f.activeLeg, approach: f.approach, hold: f.hold, suspended: f.suspended });
  }
  return s.suspended ? bump(s, { suspended: false }) : s;
}

// Phase and CDI scaling ----------------------------------------------------

export interface Scaling {
  readonly phase: FlightPhase;
  readonly scale: CdiScale;
  readonly fullScaleNm: number;
}

const fixed = (phase: FlightPhase, scale: CdiScale): Scaling => ({ phase, scale, fullScaleNm: CDI_FULL_SCALE_NM[scale] });

/** Landing threshold (or the MAP when the data has no path) of an approach. */
export function thresholdOf(a: LoadedApproach): (LatLon & { readonly elevationFt: number | null }) | null {
  const p = a.approach.path;
  if (p) return { lat: p.thresholdLat, lon: p.thresholdLon, elevationFt: p.thresholdElevationFt };
  const map = approachIndices(a.legs).map;
  const fix = map !== null ? a.legs[map]!.to : null;
  return fix ? { lat: fix.lat, lon: fix.lon, elevationFt: null } : null;
}

/** Whether the airplane is past the missed approach point (SUSP there, or into the missed approach). */
export function pastMap(s: FmsState, g: LegGuidance | null): boolean {
  const r = activeRouteLeg(s);
  if (!r || !s.approach) return false;
  const map = approachIndices(s.approach.legs).map;
  if (map === null) return false;
  return r.index > map || (r.index === map && (s.suspended || (g !== null && g.remainingNm <= 0)));
}

/**
 * Flight phase and CDI full scale: ENR 2.0 nm; TERM 1.0 within 30 nm of the
 * departure or destination airport; APR from 2 nm before the FAF, ramping to
 * 0.3 nm at it, then 0.3 (LNAV) or angular like a localizer (LPV, LP, +V);
 * MAPR 1.0 after the missed approach point.
 */
export function cdiScaling(s: FmsState, pos: LatLon, g: LegGuidance | null): Scaling {
  const a = s.approach;
  const r = activeRouteLeg(s);
  if (r && a) {
    const { faf, map } = approachIndices(a.legs);
    if (pastMap(s, g)) return fixed('MAPR', 'MAPR');
    const final = faf !== null ? r.index > faf : map !== null && r.index === map;
    if (final) {
      if (!angularLateral(approachMode(a.approach))) return fixed('APR', 'APR');
      const thr = thresholdOf(a);
      const d = thr ? distanceNm(pos, thr) : 0;
      const fullScaleNm = Math.min(Math.max((ANGULAR_THRESHOLD_NM * (d + GARP_BEYOND_THRESHOLD_NM)) / GARP_BEYOND_THRESHOLD_NM, ANGULAR_THRESHOLD_NM), CDI_FULL_SCALE_NM.APR);
      return { phase: 'APR', scale: 'APR', fullScaleNm };
    }
    const holdingHere = s.hold !== null && s.hold.entryStep !== 'toFix' && !!s.activeLeg && sameWaypoint(s.hold.fix, s.activeLeg.to);
    if (faf !== null && r.index === faf && g && g.remainingNm <= APR_RAMP_NM && !holdingHere) {
      const k = Math.min(Math.max(g.remainingNm / APR_RAMP_NM, 0), 1);
      return { phase: 'APR', scale: 'APR', fullScaleNm: CDI_FULL_SCALE_NM.APR + (CDI_FULL_SCALE_NM.TERM - CDI_FULL_SCALE_NM.APR) * k };
    }
    return distanceNm(pos, a.airport) <= TERMINAL_NM ? fixed('TERM', 'TERM') : fixed('ENR', 'ENR');
  }
  const near = (w: Waypoint | undefined | null) => !!w && w.kind === 'airport' && distanceNm(pos, w) <= TERMINAL_NM;
  const dest = a ? a.airport : s.plan[s.plan.length - 1];
  const leg = s.activeLeg;
  if (near(dest) || (leg?.isDirectTo && near(leg.to))) return fixed('TERM', 'TERM');
  if (near(s.plan[0])) return fixed('DPRT', 'TERM');
  return fixed('ENR', 'ENR');
}

// Derived ------------------------------------------------------------------

export function approachDerived(s: FmsState, pos: LatLon, trackTrue: number): ApproachDerived | null {
  const a = s.approach;
  if (!a) return null;
  const g = activeGuidance(s, pos, trackTrue);
  const scaling = s.activeLeg ? cdiScaling(s, pos, g) : fixed('ENR', 'ENR');
  const { faf, map, missed } = approachIndices(a.legs);
  const r = activeRouteLeg(s);
  const past = pastMap(s, g);
  const thr = thresholdOf(a);
  const along = (target: number | null) => {
    if (target === null) return null;
    if (r && r.index === target) return g && g.remainingNm > 0 ? (Number.isFinite(g.remainingNm) ? g.remainingNm : distanceNm(pos, s.activeLeg!.to)) : null;
    return distanceAlongToNm(s, pos, target);
  };
  return {
    airport: a.airport.ident,
    name: shortApproachName(a.approach),
    mode: approachMode(a.approach),
    phase: scaling.phase,
    activated: a.activated && r !== null,
    vectorsToFinal: a.vectorsToFinal,
    suspended: s.suspended,
    distanceToFafNm: along(faf),
    distanceToMapNm: past ? null : along(map),
    distanceToThresholdNm: past || !thr ? null : distanceNm(pos, thr),
    activeLegIndex: r ? r.index : null,
    transition: a.transition,
    fafIndex: faf,
    mapIndex: map,
    missedIndex: missed,
    fullScaleNm: scaling.fullScaleNm,
    holding: s.hold !== null && s.hold.entryStep !== 'toFix',
  };
}

/** The final approach path: threshold, elevation, crossing height and angle. */
interface Glidepath {
  readonly threshold: LatLon;
  readonly elevationFt: number;
  readonly tchFt: number;
  readonly angleDeg: number;
  readonly courseTrue: number;
}

function glidepathOf(a: LoadedApproach, mag: MagneticModel): Glidepath | null {
  const p = a.approach.path;
  const { map, faf } = approachIndices(a.legs);
  const mapFix = map !== null ? a.legs[map]!.to : null;
  const fafFix = faf !== null ? a.legs[faf]!.to : null;
  if (p) {
    const threshold = { lat: p.thresholdLat, lon: p.thresholdLon };
    const courseTrue = fafFix && distanceNm(fafFix, threshold) > 0.5 ? bearing(fafFix, threshold) : mag.toTrue(p.courseMag, threshold.lat, threshold.lon);
    return { threshold, elevationFt: p.thresholdElevationFt, tchFt: p.tchFt, angleDeg: p.angleDeg, courseTrue };
  }
  // No FAS data block: a published vertical angle down to the MAP, which is crossed at its altitude.
  const angle = a.legs.find((l) => l.segment === 'final' && l.verticalAngleDeg !== undefined)?.verticalAngleDeg;
  const mapLeg = map !== null ? a.legs[map]! : null;
  const alt = mapLeg?.altitude && mapLeg.altitude.kind !== 'between' ? mapLeg.altitude.ft : null;
  if (angle === undefined || !mapFix || alt === null) return null;
  const courseTrue = fafFix && distanceNm(fafFix, mapFix) > 0.5 ? bearing(fafFix, mapFix) : 0;
  return { threshold: mapFix, elevationFt: alt, tchFt: 0, angleDeg: Math.abs(angle), courseTrue };
}

/** Height above or below a glidepath that meets the ground `tchFt / tan(angle)` past `threshold`. */
export function pathDeviation(
  pos: LatLon,
  altitudeFt: number,
  origin: LatLon,
  courseTrue: number,
  elevationFt: number,
  tchFt: number,
  angleDeg: number,
): { readonly alongNm: number; readonly pathFt: number; readonly deviationFt: number; readonly angularDeg: number; readonly rangeFt: number } {
  const d = distanceNm(origin, pos);
  // Along-course distance before the origin (positive on the approach side).
  const alongNm = d * Math.cos(toRad(angleDiff(bearing(origin, pos), courseTrue + 180)));
  const tan = Math.tan(toRad(angleDeg));
  const rangeFt = alongNm * FT_PER_NM + tchFt / tan;
  const pathFt = elevationFt + tchFt + alongNm * FT_PER_NM * tan;
  const angularDeg = rangeFt > 1 ? toDeg(Math.atan2(altitudeFt - elevationFt, rangeFt)) - angleDeg : 0;
  return { alongNm, pathFt, deviationFt: altitudeFt - pathFt, angularDeg, rangeFt };
}

/**
 * GPS glidepath (LPV, L/VNAV, advisory +V): available on the leg into the FAF
 * and the final approach segment of an active RNAV approach, until the MAP.
 */
export function glidepathDerived(s: FmsState, pos: LatLon, altitudeFt: number, trackTrue: number, mag: MagneticModel): VerticalDerived | null {
  const a = s.approach;
  const r = activeRouteLeg(s);
  if (!a || !r) return null;
  const mode = approachMode(a.approach);
  const kind = gpsVertical(mode);
  if (!kind) return null;
  const { faf, map } = approachIndices(a.legs);
  const first = faf ?? map;
  if (first === null || r.index < first || (map !== null && r.index > map)) return null;
  const g = activeGuidance(s, pos, trackTrue);
  if (pastMap(s, g)) return null;
  const gp = glidepathOf(a, mag);
  if (!gp) return null;
  const dev = pathDeviation(pos, altitudeFt, gp.threshold, gp.courseTrue, gp.elevationFt, gp.tchFt, gp.angleDeg);
  const fullScaleFt = Math.min(Math.max(dev.rangeFt * Math.tan(toRad(gp.angleDeg / 4)), GP_MIN_FULL_SCALE_FT), GP_MAX_FULL_SCALE_FT);
  return {
    source: 'GP',
    advisory: kind === 'advisory',
    needle: Math.min(Math.max(-dev.deviationFt / fullScaleFt, -1), 1),
    deviationFt: dev.deviationFt,
    angleDeg: gp.angleDeg,
    valid: dev.rangeFt > 0,
    fullScaleFt,
    pathAltitudeFt: dev.pathFt,
    distanceNm: dev.alongNm,
  };
}

/** Whether a loaded approach offers a glidepath the autopilot can couple to (not advisory +V). */
export function hasCoupledGlidepath(a: LoadedApproach | null): boolean {
  return !!a && gpsVertical(approachMode(a.approach)) === 'coupled';
}
