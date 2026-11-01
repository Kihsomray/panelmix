import { describe, expect, it } from 'vitest';
import { destination } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import type { ProcFix } from '../../core/procedures';
import type { Derived } from '../../sim/simulator';
import type { ApproachDerived, LoadedApproach, RouteLeg, SimState, VerticalDerived } from '../../sim/types';
import { FIX, KJYO_WP, live, navData, RNAV17, stateWith } from '../testFixtures';
import * as c from './checks';
import { snapshot } from './runner';
import type { CheckContext } from './types';

/** The check context for a hand-built state (and derived overrides). */
function ctx(state: SimState, derived: Partial<Derived> = {}): CheckContext {
  const input = live(state, derived);
  return { ...input, stepStart: snapshot(input) };
}

const wp = (f: ProcFix): Waypoint => ({ kind: f.kind === 'vor' ? 'vor' : 'fix', ident: f.ident, name: f.ident, lat: f.lat, lon: f.lon });

/** The RNAV 17 as the FMS would load it, flying leg `index`. */
function onApproach(index: number | null, patch: Partial<LoadedApproach> = {}): SimState {
  const legs: RouteLeg[] = [
    { path: 'IF', to: wp(FIX.CACAS), segment: 'final', role: 'IF', label: 'CACAS' },
    { path: 'TF', to: wp(FIX.DANMO), segment: 'final', role: 'FAF', label: 'DANMO' },
    { path: 'TF', to: wp(FIX.RW17), segment: 'final', role: 'MAP', label: 'RW17' },
    { path: 'CA', to: null, segment: 'missed', courseMag: 171.3, label: '1100ft' },
    { path: 'DF', to: wp(FIX.KORNY), segment: 'missed', label: 'KORNY' },
    { path: 'HM', to: wp(FIX.KORNY), segment: 'missed', courseMag: 81.1, turn: 'R', label: 'HOLD' },
  ];
  const approach: LoadedApproach = { airport: KJYO_WP, approach: RNAV17, transition: 'MRB', legs, vectorsToFinal: false, activated: true, ...patch };
  return stateWith((s) => {
    const leg = index === null ? null : legs[index]!;
    const activeLeg = leg?.to ? { from: wp(FIX.CACAS), to: leg.to, planIndex: null, isDirectTo: false, approachIndex: index } : s.fms.activeLeg;
    return { ...s, fms: { ...s.fms, approach, activeLeg } };
  });
}

const apprDerived = (over: Partial<ApproachDerived>): ApproachDerived => ({
  airport: 'KJYO',
  name: 'RNAV 17',
  mode: 'LPV',
  phase: 'APR',
  activated: true,
  vectorsToFinal: false,
  suspended: false,
  distanceToFafNm: null,
  distanceToMapNm: 3,
  distanceToThresholdNm: 3,
  activeLegIndex: 2,
  ...over,
});

const vertical = (needle: number): VerticalDerived => ({ source: 'GP', advisory: false, needle, deviationFt: -needle * 100, angleDeg: 3, valid: true });

describe('radio and transponder checks', () => {
  const s0 = stateWith();

  it('reads COM and NAV standby and active frequencies', () => {
    const s = stateWith((s) => ({ ...s, radios: { ...s.radios, com: [{ activeKhz: 121500, standbyKhz: 118000 }, s.radios.com[1]] } }));
    expect(c.comStandby(0, 121500)(ctx(s0))).toBe(false);
    expect(c.comActive(0, 121500)(ctx(s))).toBe(true);
    expect(c.comStandby(0, 118000)(ctx(s))).toBe(true);
    expect(c.navActive(0, 112100)(ctx(s0))).toBe(true);
    expect(c.navIdentOn(0)(ctx(s0))).toBe(false);
  });

  it('reads the squawk, the mode and an ident in progress', () => {
    const s = stateWith((s) => ({ ...s, time: 50, xpdr: { code: '4521', mode: 'ALT', identUntil: 68 } }));
    expect(c.squawk('4521')(ctx(s))).toBe(true);
    expect(c.xpdrMode('ALT')(ctx(s))).toBe(true);
    expect(c.identing(ctx(s))).toBe(true);
    expect(c.identing(ctx({ ...s, time: 70 }))).toBe(false);
    expect(c.identing(ctx(s0))).toBe(false);
  });

  it('wants the Kollsman window on the real pressure, not STD', () => {
    const off = stateWith((s) => ({ ...s, env: { ...s.env, qnhInHg: 29.87 } }));
    expect(c.altimeterSet(ctx(s0))).toBe(true);
    expect(c.altimeterSet(ctx(off))).toBe(false);
    expect(c.altimeterSet(ctx({ ...s0, bugs: { ...s0.bugs, baroStd: true } }))).toBe(false);
  });
});

describe('autopilot and flying checks', () => {
  it('needs the autopilot or the flight director for a mode to count', () => {
    const off = stateWith((s) => ({ ...s, ap: { ...s.ap, lateral: 'HDG' } }));
    expect(c.apLateral('HDG')(ctx(off))).toBe(false);
    const on = { ...off, ap: { ...off.ap, engaged: true } };
    expect(c.apLateral('HDG')(ctx(on))).toBe(true);
    expect(c.all(c.apEngaged, c.apLateral('HDG'))(ctx(on))).toBe(true);
    expect(c.apOff(ctx(on))).toBe(false);
  });

  it('counts NAV armed as selected, and reads the altitude capture', () => {
    const s = stateWith((s) => ({ ...s, ap: { ...s.ap, engaged: true, lateral: 'HDG', lateralArmed: 'NAV', altitudeArmed: true, vertical: 'VS' } }));
    expect(c.navSelected(ctx(s))).toBe(true);
    expect(c.apLateral('NAV')(ctx(s))).toBe(false);
    expect(c.altitudeArmed(ctx(s))).toBe(true);
    expect(c.apVertical('VS')(ctx(s))).toBe(true);
  });

  it('reads bugs with a tolerance', () => {
    const s = stateWith((s) => ({ ...s, bugs: { ...s.bugs, headingMag: 359, altitudeFt: 4500 } }));
    expect(c.headingBug(360)(ctx(s))).toBe(true);
    expect(c.headingBug(5)(ctx(s))).toBe(false);
    expect(c.altitudeBug(4500)(ctx(s))).toBe(true);
    expect(c.altitudeBug(4400)(ctx(s))).toBe(false);
  });

  it('flies headings, altitudes and climbs', () => {
    const s = stateWith((s) => ({ ...s, aircraft: { ...s.aircraft, verticalSpeedFpm: 500, bankDeg: 3, engine: { ...s.aircraft.engine, throttle: 1 } } }));
    const x = ctx(s, { headingMag: 272, trackMag: 265, indicatedAltitudeFt: 4460 });
    expect(c.onHeading(270, 5)(x)).toBe(true);
    expect(c.onHeading(260, 5)(x)).toBe(false);
    expect(c.onHeadingOrTrack(262, 4)(x)).toBe(true);
    expect(c.atAltitude(4500, 50)(x)).toBe(true);
    expect(c.climbing(250)(x)).toBe(true);
    expect(c.levelFlight(200)(x)).toBe(false);
    expect(c.wingsLevel(5)(x)).toBe(true);
    expect(c.goingAround(x)).toBe(true);
    expect(c.goingAround(ctx({ ...s, aircraft: { ...s.aircraft, engine: { ...s.aircraft.engine, throttle: 0.6 } } }))).toBe(false);
  });
});

describe('CDI and flight plan checks', () => {
  it('reads the needle, the flag and the course', () => {
    const base = live(stateWith()).derived.cdi;
    const centered = ctx(stateWith(), { cdi: { ...base, needle: 0.1, toFrom: 'TO', flag: false, courseMag: 300 }, trackMag: 310 });
    expect(c.needleWithin(0.2)(centered)).toBe(true);
    expect(c.toFlag(centered)).toBe(true);
    expect(c.fromFlag(centered)).toBe(false);
    expect(c.trackAlongCourse(15)(centered)).toBe(true);
    expect(c.trackAlongCourse(5)(centered)).toBe(false);
    const flagged = ctx(stateWith(), { cdi: { ...base, needle: 0, flag: true } });
    expect(c.needleWithin(1)(flagged)).toBe(false);
  });

  it('finds waypoints in the plan in order', () => {
    const s = stateWith();
    expect(c.planHas(['KJYO', 'MRB', 'KHGR'])(ctx(s))).toBe(true);
    expect(c.planHas(['KJYO', 'KHGR'])(ctx(s))).toBe(true);
    expect(c.planHas(['KHGR', 'MRB'])(ctx(s))).toBe(false);
    expect(c.activeTo('MRB')(ctx(s))).toBe(true);
    expect(c.activeLegOnPlan(ctx(s))).toBe(true);
    expect(c.directTo('MRB')(ctx(s))).toBe(false);
  });

  it('knows a direct-to and a diversion to a nearby airport', () => {
    const s = stateWith((s) => ({ ...s, fms: { ...s.fms, activeLeg: { from: s.fms.plan[0]!, to: KJYO_WP, planIndex: null, isDirectTo: true } } }));
    expect(c.directTo('KJYO')(ctx(s))).toBe(true);
    expect(c.directToNearbyAirport(25)(ctx(s))).toBe(true);
    expect(c.directToNearbyAirport(1)(ctx(s))).toBe(false);
    const vor = { ...s, fms: { ...s.fms, activeLeg: { ...s.fms.activeLeg!, to: wp(FIX.MRB) } } };
    expect(c.directToNearbyAirport(50)(ctx(vor))).toBe(false);
  });

  it('measures cross-track and track error on the GPS leg', () => {
    const gps = live(stateWith()).derived.gps;
    const x = ctx(stateWith(), { gps: { ...gps, active: true, crossTrackNm: -0.25, trackErrorDeg: 4 } });
    expect(c.gpsCrossTrackWithin(0.3)(x)).toBe(true);
    expect(c.gpsCrossTrackWithin(0.2)(x)).toBe(false);
    expect(c.trackingDesiredTrack(5)(x)).toBe(true);
  });
});

describe('approach checks', () => {
  it('finds the loaded approach by CIFP id or Garmin name, and its activation', () => {
    const s = onApproach(1);
    expect(c.approachLoaded('KJYO', 'R17')(ctx(s))).toBe(true);
    expect(c.approachLoaded('KJYO', 'RNAV 17')(ctx(s))).toBe(true);
    expect(c.approachLoaded('KJYO', 'I17')(ctx(s))).toBe(false);
    expect(c.approachActivated(ctx(s))).toBe(true);
    expect(c.approachActivated(ctx(onApproach(null, { activated: false })))).toBe(false);
    expect(c.approachLoaded('KJYO', 'R17')(ctx(stateWith()))).toBe(false);
  });

  it('reads the annunciated approach mode, phase and the glidepath', () => {
    const s = onApproach(2);
    expect(c.all(c.approachMode('LPV'), c.approachPhase('APR'))(ctx(s, { approach: apprDerived({}) }))).toBe(true);
    expect(c.approachMode('LPV')(ctx(s, { approach: apprDerived({ mode: 'LNAV' }) }))).toBe(false);
    expect(c.approachMode('LPV')(ctx(s, { approach: null }))).toBe(false);
    expect(c.onGlidepath(0.3)(ctx(s, { vertical: vertical(0.2) }))).toBe(true);
    expect(c.onGlidepath(0.3)(ctx(s, { vertical: vertical(-0.5) }))).toBe(false);
    expect(c.onGlidepath(0.3)(ctx(s, { vertical: { ...vertical(0), valid: false } }))).toBe(false);
  });

  it('glidepath captured means the GS vertical mode with the autopilot or director on', () => {
    const s = onApproach(2);
    const armed = { ...s, ap: { ...s.ap, engaged: true, approach: true, verticalArmed: 'GS' as const } };
    expect(c.all(c.approachArmed, c.glidepathArmedOrCaptured)(ctx(armed))).toBe(true);
    expect(c.glidepathCaptured(ctx(armed))).toBe(false);
    const captured = { ...armed, ap: { ...armed.ap, verticalArmed: null, vertical: 'GS' as const } };
    expect(c.glidepathCaptured(ctx(captured))).toBe(true);
    expect(c.glidepathArmedOrCaptured(ctx(captured))).toBe(true);
  });

  it('uses 200 ft above the threshold as the DA unless the pilot set minimums', () => {
    const s = onApproach(2);
    expect(c.decisionAltitudeFt(s, 999)).toBe(580);
    expect(c.decisionAltitudeFt(stateWith(), 378)).toBe(580);
    expect(c.atDecisionAltitude(378)(ctx(s, { indicatedAltitudeFt: 625 }))).toBe(true);
    expect(c.atDecisionAltitude(378)(ctx(s, { indicatedAltitudeFt: 700 }))).toBe(false);
    const mins = { ...s, bugs: { ...s.bugs, minimumsFt: 650 } };
    expect(c.decisionAltitudeFt(mins, 378)).toBe(650);
    expect(c.trainerDecisionAltitudeFt(mins, 378)).toBe(580);
    expect(c.atDecisionAltitude(378)(ctx(mins, { indicatedAltitudeFt: 700 }))).toBe(true);
  });

  it('knows the missed approach and the published hold', () => {
    expect(c.inMissedApproach(ctx(onApproach(1)))).toBe(false);
    expect(c.inMissedApproach(ctx(onApproach(4)))).toBe(true);
    expect(c.activeTo('KORNY')(ctx(onApproach(4)))).toBe(true);
    expect(c.holdingAt('KORNY')(ctx(onApproach(4)))).toBe(false);
    expect(c.holdingAt('KORNY')(ctx(onApproach(5)))).toBe(true);
    const s = stateWith((s) => ({ ...s, fms: { ...s.fms, suspended: true } }));
    expect(c.suspended(ctx(s))).toBe(true);
  });
});

describe('holding checks', () => {
  const { mag } = navData();
  const variation = mag.variation(FIX.MRB.lat, FIX.MRB.lon);
  const inboundTrue = 300 + variation;
  const at = (distance: number, bearingFromFix: number, trackTrue: number) =>
    stateWith((s) => {
      const p = destination(FIX.MRB, bearingFromFix, distance);
      return { ...s, aircraft: { ...s.aircraft, lat: p.lat, lon: p.lon, trackTrue, headingTrue: trackTrue } };
    });

  it('accepts a pilot hold or the GNS OBS method', () => {
    const hold = stateWith((s) => ({
      ...s,
      fms: {
        ...s.fms,
        hold: {
          fix: wp(FIX.MRB),
          inboundCourseMag: 300,
          turn: 'R',
          legTimeMin: 1,
          legNm: null,
          entry: 'direct',
          phase: 'entry',
          phaseStartedAt: 0,
          exitArmed: false,
          source: 'pilot',
        },
      },
    }));
    expect(c.holdEntered('MRB', 300, 'R')(ctx(hold))).toBe(true);
    expect(c.holdEntered('MRB', 300, 'L')(ctx(hold))).toBe(false);
    const obs = stateWith((s) => ({ ...s, fms: { ...s.fms, obsMode: true, obsCourseMag: 299 } }));
    expect(c.holdEntered('MRB', 300, 'R')(ctx(obs))).toBe(true);
    expect(c.holdEntered('MRB', 120, 'R')(ctx(obs))).toBe(false);
  });

  it('tracks the inbound course to the fix', () => {
    // 3 nm out on the inbound course (southeast of MRB), flying it.
    expect(c.inboundOn(FIX.MRB, 300, 0.5, 20)(ctx(at(3, inboundTrue + 180, inboundTrue)))).toBe(true);
    // Off to one side by a mile.
    const off = stateWith((s) => {
      const p = destination(destination(FIX.MRB, inboundTrue + 180, 3), inboundTrue + 90, 1);
      return { ...s, aircraft: { ...s.aircraft, lat: p.lat, lon: p.lon, trackTrue: inboundTrue } };
    });
    expect(c.inboundOn(FIX.MRB, 300, 0.5, 20)(ctx(off))).toBe(false);
    // On the line but flying the other way (outbound).
    expect(c.inboundOn(FIX.MRB, 300, 0.5, 20)(ctx(at(3, inboundTrue + 180, inboundTrue + 180)))).toBe(false);
  });

  it('sees the crossing inbound and the outbound leg', () => {
    expect(c.crossingInbound(FIX.MRB, 300)(ctx(at(0.3, inboundTrue + 180, inboundTrue)))).toBe(true);
    expect(c.crossingInbound(FIX.MRB, 300)(ctx(at(0.3, inboundTrue + 180, inboundTrue + 90)))).toBe(false);
    expect(c.outboundFrom(FIX.MRB, 1.3)(ctx(at(2, inboundTrue + 180, inboundTrue + 180)))).toBe(true);
    expect(c.outboundFrom(FIX.MRB, 1.3)(ctx(at(2, inboundTrue + 180, inboundTrue)))).toBe(false);
    expect(c.nearFix(FIX.MRB, 0.7)(ctx(at(0.5, 10, 0)))).toBe(true);
  });

  it('notices an attitude failure of either kind', () => {
    const s = stateWith();
    const vac = { ...s, systems: { ...s.systems, failures: { ...s.systems.failures, vacuum: true } } };
    const ahrs = { ...s, systems: { ...s.systems, failures: { ...s.systems.failures, ahrs: true } } };
    expect([c.attitudeFailed(ctx(s)), c.attitudeFailed(ctx(vac)), c.attitudeFailed(ctx(ahrs))]).toEqual([false, true, true]);
  });
});
