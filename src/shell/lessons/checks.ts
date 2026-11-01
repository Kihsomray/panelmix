import { angleDiff, bearing, crossTrackNm, destination, distanceNm, type LatLon } from '../../core/geo';
import { shortApproachName } from '../../core/procedures';
import type { ApproachMode, CdiSource, FlightPhase, LateralMode, RouteLeg, SimState, TransponderMode, VerticalMode } from '../../sim/types';
import type { CheckContext } from './types';

/*
 * Building blocks for lesson steps: small predicates over the live state.
 * A step's check is one of these or a combination, so every check reads
 * like the instruction it verifies.
 */

export type Check = (ctx: CheckContext) => boolean;

export const all =
  (...checks: Check[]): Check =>
  (ctx) =>
    checks.every((c) => c(ctx));
export const any =
  (...checks: Check[]): Check =>
  (ctx) =>
    checks.some((c) => c(ctx));

// Radios and transponder ---------------------------------------------------

export const comStandby =
  (radio: 0 | 1, khz: number): Check =>
  ({ state }) =>
    state.radios.com[radio].standbyKhz === khz;
export const comActive =
  (radio: 0 | 1, khz: number): Check =>
  ({ state }) =>
    state.radios.com[radio].activeKhz === khz;
export const navActive =
  (radio: 0 | 1, khz: number): Check =>
  ({ state }) =>
    state.radios.nav[radio].activeKhz === khz;
export const navIdentOn =
  (radio: 0 | 1): Check =>
  ({ state }) =>
    state.radios.navIdent[radio];
export const squawk =
  (code: string): Check =>
  ({ state }) =>
    state.xpdr.code === code;
export const xpdrMode =
  (mode: TransponderMode): Check =>
  ({ state }) =>
    state.xpdr.mode === mode;
export const identing: Check = ({ state }) => state.xpdr.identUntil !== null && state.xpdr.identUntil > state.time;

/** The Kollsman window matches the real pressure (not STD). */
export const altimeterSet: Check = ({ state }) => !state.bugs.baroStd && Math.abs(state.bugs.baroInHg - state.env.qnhInHg) < 0.005;

// Bugs and flying ------------------------------------------------------------

export const headingBug =
  (mag: number, tolerance = 2): Check =>
  ({ state }) =>
    Math.abs(angleDiff(state.bugs.headingMag, mag)) <= tolerance;
export const altitudeBug =
  (ft: number): Check =>
  ({ state }) =>
    Math.abs(state.bugs.altitudeFt - ft) < 50;
export const onHeading =
  (mag: number, tolerance: number): Check =>
  ({ derived }) =>
    Math.abs(angleDiff(derived.headingMag, mag)) <= tolerance;
/** Heading or ground track: partial panel pilots steer by the GPS track. */
export const onHeadingOrTrack =
  (mag: number, tolerance: number): Check =>
  ({ derived }) =>
    Math.abs(angleDiff(derived.headingMag, mag)) <= tolerance || Math.abs(angleDiff(derived.trackMag, mag)) <= tolerance;
export const atAltitude =
  (ft: number, tolerance: number): Check =>
  ({ derived }) =>
    Math.abs(derived.indicatedAltitudeFt - ft) <= tolerance;
export const levelFlight =
  (fpm = 200): Check =>
  ({ state }) =>
    Math.abs(state.aircraft.verticalSpeedFpm) <= fpm;
export const wingsLevel =
  (deg = 5): Check =>
  ({ state }) =>
    Math.abs(state.aircraft.bankDeg) <= deg;
export const climbing =
  (fpm = 200): Check =>
  ({ state }) =>
    state.aircraft.verticalSpeedFpm >= fpm;
/** Missed approach: power up and climbing. */
export const goingAround: Check = ({ state }) => state.aircraft.verticalSpeedFpm > 300 && state.aircraft.engine.throttle >= 0.85;

// Autopilot ------------------------------------------------------------------

export const apEngaged: Check = ({ state }) => state.ap.engaged;
export const apOff: Check = ({ state }) => !state.ap.engaged;
const apActive = (s: SimState) => s.ap.engaged || s.ap.flightDirector;
export const apLateral =
  (mode: LateralMode): Check =>
  ({ state }) =>
    apActive(state) && state.ap.lateral === mode;
export const apVertical =
  (mode: VerticalMode): Check =>
  ({ state }) =>
    apActive(state) && state.ap.vertical === mode;
/** NAV selected or armed (it captures as the needle comes in). */
export const navSelected: Check = ({ state }) => apActive(state) && (state.ap.lateral === 'NAV' || state.ap.lateralArmed === 'NAV');
export const altitudeArmed: Check = ({ state }) => apActive(state) && state.ap.altitudeArmed;
export const approachArmed: Check = ({ state }) => apActive(state) && state.ap.approach;
export const glidepathArmedOrCaptured: Check = ({ state }) => apActive(state) && (state.ap.verticalArmed === 'GS' || state.ap.vertical === 'GS');
export const glidepathCaptured: Check = ({ state }) => apActive(state) && state.ap.vertical === 'GS';

// CDI ------------------------------------------------------------------------

export const cdiSource =
  (source: CdiSource): Check =>
  ({ state }) =>
    state.nav.cdiSource === source;
export const needleWithin =
  (fraction: number): Check =>
  ({ derived }) =>
    !derived.cdi.flag && Math.abs(derived.cdi.needle) <= fraction;
export const toFlag: Check = ({ derived }) => !derived.cdi.flag && derived.cdi.toFrom === 'TO';
export const fromFlag: Check = ({ derived }) => !derived.cdi.flag && derived.cdi.toFrom === 'FROM';
/** Flying along the selected course, not across or away from it. */
export const trackAlongCourse =
  (tolerance: number): Check =>
  ({ derived }) =>
    Math.abs(angleDiff(derived.trackMag, derived.cdi.courseMag)) <= tolerance;

// GPS and the flight plan ----------------------------------------------------

export const directTo =
  (ident: string): Check =>
  ({ state }) =>
    !!state.fms.activeLeg?.isDirectTo && state.fms.activeLeg.to.ident === ident;
export const activeTo =
  (ident: string): Check =>
  ({ state }) =>
    state.fms.activeLeg?.to.ident === ident;
export const activeLegOnPlan: Check = ({ state }) => !!state.fms.activeLeg && state.fms.activeLeg.planIndex !== null;

/** The plan has these waypoints in this order (others may sit between them). */
export const planHas =
  (idents: readonly string[]): Check =>
  ({ state }) => {
    let i = 0;
    for (const w of state.fms.plan) if (w.ident === idents[i]) i++;
    return i === idents.length;
  };
export const gpsCrossTrackWithin =
  (nm: number): Check =>
  ({ derived }) =>
    derived.gps.active && Math.abs(derived.gps.crossTrackNm) <= nm;
export const trackingDesiredTrack =
  (deg: number): Check =>
  ({ derived }) =>
    derived.gps.active && derived.gps.trackErrorDeg !== null && Math.abs(derived.gps.trackErrorDeg) <= deg;
/** A direct-to an airport within `nm`: a diversion to a nearby field. */
export const directToNearbyAirport =
  (nm: number): Check =>
  ({ state }) => {
    const leg = state.fms.activeLeg;
    return !!leg?.isDirectTo && leg.to.kind === 'airport' && distanceNm(state.aircraft, leg.to) <= nm;
  };

// Approaches -----------------------------------------------------------------

/** The loaded approach is `approach` (CIFP id "R17" or Garmin name "RNAV 17") at `airport`. */
export const approachLoaded =
  (airport: string, approach: string): Check =>
  ({ state }) => {
    const a = state.fms.approach;
    return !!a && a.airport.ident === airport && (a.approach.id === approach || shortApproachName(a.approach) === approach);
  };
export const approachActivated: Check = ({ state }) => !!state.fms.approach?.activated;
export const approachMode =
  (mode: ApproachMode): Check =>
  ({ derived }) =>
    derived.approach?.mode === mode;
export const approachPhase =
  (phase: FlightPhase): Check =>
  ({ derived }) =>
    derived.approach?.phase === phase;
/** Vertical deviation within `fraction` of full scale, on a valid path. */
export const onGlidepath =
  (fraction: number): Check =>
  ({ derived }) =>
    !!derived.vertical?.valid && Math.abs(derived.vertical.needle) <= fraction;

/** The approach leg being flown, if any. */
export function activeApproachLeg(state: SimState): RouteLeg | null {
  const a = state.fms.approach;
  const i = state.fms.activeLeg?.approachIndex;
  if (!a || i === null || i === undefined) return null;
  return a.legs[i] ?? null;
}

export const inMissedApproach: Check = ({ state }) => activeApproachLeg(state)?.segment === 'missed';
export const suspended: Check = ({ state }) => state.fms.suspended;
/** In a hold at `ident`: the FMS hold, or a published hold leg as the active approach leg. */
export const holdingAt =
  (ident: string): Check =>
  ({ state }) => {
    if (state.fms.hold?.fix.ident === ident) return true;
    const leg = activeApproachLeg(state);
    return !!leg && (leg.path === 'HM' || leg.path === 'HA' || leg.path === 'HF') && leg.to?.ident === ident;
  };

/**
 * Decision altitude for the lesson: the pilot's minimums when set, else
 * 200 ft above the threshold of the loaded approach (`fallbackThresholdFt`
 * when no approach is loaded). Real DAs come from the chart.
 */
export function decisionAltitudeFt(state: SimState, fallbackThresholdFt: number): number {
  return state.bugs.minimumsFt ?? trainerDecisionAltitudeFt(state, fallbackThresholdFt);
}

/** 200 ft above the threshold of the loaded approach, whatever the minimums setting. */
export function trainerDecisionAltitudeFt(state: SimState, fallbackThresholdFt: number): number {
  const thr = state.fms.approach?.approach.path?.thresholdElevationFt ?? fallbackThresholdFt;
  return Math.round((thr + 200) / 10) * 10;
}
export const atDecisionAltitude =
  (fallbackThresholdFt: number): Check =>
  ({ state, derived }) =>
    derived.indicatedAltitudeFt <= decisionAltitudeFt(state, fallbackThresholdFt) + 50;

// Holding geometry -------------------------------------------------------------

/** True course from a magnetic one, with the variation at the airplane. */
const trueOf = (ctx: CheckContext, mag: number) => mag + ctx.derived.magVar;

export const nearFix =
  (fix: LatLon, nm: number): Check =>
  ({ state }) =>
    distanceNm(state.aircraft, fix) <= nm;
/** Flying away from the fix, at least `minNm` from it. */
export const outboundFrom =
  (fix: LatLon, minNm: number): Check =>
  ({ state }) =>
    distanceNm(state.aircraft, fix) >= minNm && Math.abs(angleDiff(state.aircraft.trackTrue, bearing(state.aircraft, fix))) > 100;
/** On the inbound course to the fix: within `xtkNm` of it, tracking it, the fix ahead. */
export const inboundOn =
  (fix: LatLon, inboundMag: number, xtkNm: number, trackTolerance: number): Check =>
  (ctx) => {
    const a = ctx.state.aircraft;
    const inbound = trueOf(ctx, inboundMag);
    const origin = destination(fix, inbound + 180, 10);
    return (
      distanceNm(a, fix) > 0.3 &&
      Math.abs(crossTrackNm(origin, fix, a)) <= xtkNm &&
      Math.abs(angleDiff(a.trackTrue, inbound)) <= trackTolerance &&
      Math.abs(angleDiff(bearing(a, fix), inbound)) < 60
    );
  };
/** Crossing the fix while flying the inbound course. */
export const crossingInbound =
  (fix: LatLon, inboundMag: number, nm = 0.7, trackTolerance = 30): Check =>
  (ctx) =>
    distanceNm(ctx.state.aircraft, fix) <= nm && Math.abs(angleDiff(ctx.state.aircraft.trackTrue, trueOf(ctx, inboundMag))) <= trackTolerance;

/** A pilot hold at `ident` with this inbound course and turn, or the OBS-mode equivalent on a GNS. */
export const holdEntered =
  (ident: string, inboundMag: number, turn: 'L' | 'R'): Check =>
  ({ state }) => {
    const h = state.fms.hold;
    if (h && h.fix.ident === ident) return Math.abs(angleDiff(h.inboundCourseMag, inboundMag)) <= 3 && h.turn === turn;
    return state.fms.obsMode && state.fms.activeLeg?.to.ident === ident && Math.abs(angleDiff(state.fms.obsCourseMag, inboundMag)) <= 3;
  };

// Failures ---------------------------------------------------------------------

export const attitudeFailed: Check = ({ state }) => state.systems.failures.vacuum || state.systems.failures.ahrs;
