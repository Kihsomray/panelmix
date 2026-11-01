import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, crossTrackNm, distanceNm, FT_PER_NM } from '../../core/geo';
import type { SimCommand } from '../../sim/commands';
import { formatBearing } from '../../ui/format';
import { constantMag, FIX, ILS17, KJYO_PROCS, KJYO_WP, RNAV17 } from '../testFixtures';
import {
  approachHolds,
  compass8,
  constraintFt,
  finalAltitudeFt,
  finalGeometry,
  glidepathFt,
  holdEntry,
  holdStart,
  planScenario,
  transitionStart,
  type HoldEntry,
  type ScenarioEnv,
  type ScenarioRequest,
} from './scenario';

const mag = constantMag();
const THR = { lat: 39.08512, lon: -77.56061 };

const env = (over: Partial<ScenarioEnv> = {}): ScenarioEnv => ({
  mag,
  qnhInHg: 29.92,
  localizer: { ident: 'IJYO', freqKhz: 111750, courseMag: 171.3 },
  waypoint: (f) => ({ kind: f.kind === 'vor' ? 'vor' : 'fix', ident: f.ident, name: f.ident, lat: f.lat, lon: f.lon }),
  ...over,
});

const request = (over: Partial<ScenarioRequest>): ScenarioRequest => ({
  airport: KJYO_WP,
  fieldElevationFt: 390,
  procedures: KJYO_PROCS,
  approach: RNAV17,
  transition: 'MRB',
  start: { kind: 'transition' },
  load: 'activate',
  autopilot: true,
  setAltimeter: true,
  ...over,
});

function plan(over: Partial<ScenarioRequest>, e: ScenarioEnv = env()) {
  const p = planScenario(request(over), e);
  if ('error' in p) throw new Error(p.error);
  return p;
}

const find = <T extends SimCommand['type']>(cmds: readonly SimCommand[], type: T) =>
  cmds.find((c): c is Extract<SimCommand, { type: T }> => c.type === type);

describe('altitude constraints and compass words', () => {
  it('reads the altitude a constraint allows', () => {
    expect(constraintFt({ kind: 'atOrAbove', ft: 3000 })).toBe(3000);
    expect(constraintFt({ kind: 'between', aboveFt: 4000, belowFt: 6000 })).toBe(4000);
    expect(constraintFt({ kind: 'glideslope', ft: 2100 })).toBe(2100);
    expect(constraintFt(undefined)).toBeNull();
  });

  it('names eight compass points', () => {
    expect([0, 44, 46, 135, 180, 225, 290, 330, 338].map(compass8)).toEqual(['N', 'NE', 'NE', 'SE', 'S', 'SW', 'W', 'NW', 'N']);
  });
});

describe('transition starts', () => {
  it('puts the airplane 12 nm before MRB on the transition course, at 3,000 ft, heading for MRB', () => {
    const s = transitionStart(RNAV17, 'MRB', 12, mag, 390)!;
    expect(distanceNm(s, FIX.MRB)).toBeCloseTo(12, 2);
    // Lined up with the first leg: crossing MRB it flies straight on toward CACAS.
    expect(Math.abs(angleDiff(s.headingTrue, bearing(FIX.MRB, FIX.CACAS)))).toBeLessThan(0.5);
    expect(Math.abs(angleDiff(s.headingTrue, bearing(s, FIX.MRB)))).toBeLessThan(0.01);
    expect(s.altitudeFt).toBe(3000);
    expect(s.where).toBe('12 nm NW of MRB');
    expect(s.headingMag).toBeCloseTo(s.headingTrue + 10.5, 6);
  });

  it('lines up with the procedure course for a hold in lieu of a procedure turn', () => {
    const s = transitionStart(RNAV17, 'CACAS', 12, mag, 390)!;
    expect(distanceNm(s, FIX.CACAS)).toBeCloseTo(12, 2);
    expect(Math.abs(angleDiff(s.headingTrue, bearing(FIX.CACAS, FIX.DANMO)))).toBeLessThan(0.5);
    expect(s.altitudeFt).toBe(3000);
  });

  it('uses the first published altitude of an ILS transition', () => {
    const s = transitionStart(ILS17, 'MRB', 12, mag, 390)!;
    expect(s.altitudeFt).toBe(3000);
    expect(Math.abs(angleDiff(s.headingTrue, bearing(FIX.MRB, FIX.STILL)))).toBeLessThan(0.5);
  });

  it('refuses an unknown transition', () => {
    expect(transitionStart(RNAV17, 'NOPE', 12, mag, 390)).toBeNull();
  });
});

describe('final approach geometry', () => {
  const g = finalGeometry(RNAV17, KJYO_PROCS, mag, 390)!;

  it('runs the final course from the final approach fix to the threshold', () => {
    expect(g.anchor).toEqual(THR);
    expect(Math.abs(angleDiff(g.courseTrue, bearing(FIX.DANMO, THR)))).toBeLessThan(1e-9);
    expect(g.courseMag).toBe(171);
    expect(g.fafNm).toBeGreaterThan(5);
    expect(g.fafNm).toBeLessThan(5.6);
    expect(g.fixes.map((f) => f.fix.ident)).toEqual(['CACAS', 'DANMO', 'CEYAC', 'RW17']);
    expect(g.ifFloorFt).toBe(3000);
  });

  it('computes the glidepath height from the threshold, TCH and angle', () => {
    expect(glidepathFt(g, THR)).toBeCloseTo(378 + 44.8, 6);
    const at5 = { lat: THR.lat + 5 / 60, lon: THR.lon };
    expect(glidepathFt(g, at5)).toBeCloseTo(378 + 44.8 + distanceNm(at5, THR) * FT_PER_NM * Math.tan((3 * Math.PI) / 180), 6);
  });

  it('starts a 10 nm final on the extended centerline at 3,000 ft, below the glidepath', () => {
    const p = plan({ start: { kind: 'final' }, transition: null });
    const s = p.start;
    expect(distanceNm(s, THR)).toBeCloseTo(10, 2);
    expect(Math.abs(crossTrackNm(FIX.DANMO, THR, s))).toBeLessThan(0.01);
    expect(Math.abs(angleDiff(s.headingTrue, g.courseTrue))).toBeLessThan(1e-9);
    expect(s.altitudeFt).toBe(3000);
    expect(s.altitudeFt).toBeLessThan(glidepathFt(g, s)! - 150);
    expect(s.where).toBe('10 nm final RWY 17');
    expect(s.iasKt).toBe(95);
  });

  it('just outside the final approach fix holds the fix altitude, intercepting the path there', () => {
    expect(finalAltitudeFt(g, 6, pointOut(g, 6))).toBe(2100);
  });

  it('inside the final approach fix starts on the glidepath', () => {
    const p3 = pointOut(g, 3);
    expect(finalAltitudeFt(g, 3, p3)).toBe(Math.round(glidepathFt(g, p3)! / 10) * 10);
    expect(finalAltitudeFt(g, 3, p3)).toBe(1380);
  });

  it('beyond the intermediate fix uses the transition altitude at it', () => {
    const ils = finalGeometry(ILS17, KJYO_PROCS, mag, 390)!;
    expect(ils.fixes[0]!.fix.ident).toBe('STILL');
    expect(ils.fixes[0]!.toAnchorNm).toBeLessThan(12);
    expect(finalAltitudeFt(ils, 12, pointOut(ils, 12))).toBe(3000);
    expect(finalAltitudeFt(ils, 10, pointOut(ils, 10))).toBe(3000);
  });

  it('vectors to final: 2 nm right of the course on a 30 degree intercept heading', () => {
    const p = plan({ start: { kind: 'intercept' }, transition: null });
    const s = p.start;
    expect(crossTrackNm(FIX.DANMO, THR, s)).toBeCloseTo(2, 1);
    expect(angleDiff(s.headingTrue, g.courseTrue)).toBeCloseTo(-30, 6);
    expect(s.altitudeFt).toBe(3000);
    expect(s.where).toBe('12 nm out, 2 nm right of the final course');
  });

  it('can start left of the course too', () => {
    const p = plan({ start: { kind: 'intercept', side: -1, offsetNm: 3, angleDeg: 45, distanceNm: 11 }, transition: null });
    expect(crossTrackNm(FIX.DANMO, THR, p.start)).toBeCloseTo(-3, 1);
    expect(angleDiff(p.start.headingTrue, g.courseTrue)).toBeCloseTo(45, 6);
  });
});

/** A point `d` nm out on the extended final course. */
function pointOut(g: NonNullable<ReturnType<typeof finalGeometry>>, d: number) {
  const r = (deg: number) => (deg * Math.PI) / 180;
  const back = r(g.courseTrue + 180);
  // Small distances: a flat offset is plenty for the altitude rule under test.
  return {
    lat: g.anchor.lat + (d / 60) * Math.cos(back),
    lon: g.anchor.lon + ((d / 60) * Math.sin(back)) / Math.cos(r(g.anchor.lat)),
  };
}

describe('holds', () => {
  it('finds the missed approach hold first, then holds in lieu of a procedure turn', () => {
    const holds = approachHolds(RNAV17);
    expect(holds.map((h) => h.label)).toEqual(['Missed approach hold at KORNY', 'Course reversal hold at CACAS']);
    expect(holds[0]).toMatchObject({ inboundCourseMag: 81.1, turn: 'R', legNm: 4, legTimeMin: null, altitudeFt: 4000 });
    expect(approachHolds(ILS17)[0]).toMatchObject({ inboundCourseMag: 157.6, turn: 'R', legTimeMin: 1, legNm: null });
  });

  it('picks the entry from the 70 degree line (right turns)', () => {
    const at = (rel: number) => holdEntry(90 + rel, 90, 'R');
    expect([0, 69, 109.9, 110, 150, 179.9, 180, 250, 289.9, 290, 350].map(at)).toEqual([
      'direct', 'direct', 'direct', 'teardrop', 'teardrop', 'teardrop', 'parallel', 'parallel', 'parallel', 'direct', 'direct',
    ]);
  });

  it('mirrors the sectors for left turns', () => {
    const at = (rel: number) => holdEntry(90 + rel, 90, 'L');
    expect([0, 70, 71, 180, 181, 250, 251, 300].map(at)).toEqual([
      'direct', 'direct', 'parallel', 'parallel', 'teardrop', 'teardrop', 'direct', 'direct',
    ]);
  });

  it('lines the airplane up for the entry the instructor picked', () => {
    for (const hold of [...approachHolds(RNAV17), { ...approachHolds(RNAV17)[0]!, turn: 'L' as const }]) {
      for (const entry of ['direct', 'teardrop', 'parallel'] as HoldEntry[]) {
        const s = holdStart(hold, entry, 6, mag, 390);
        expect(distanceNm(s, hold.fix)).toBeCloseTo(6, 2);
        expect(holdEntry(s.headingTrue, mag.toTrue(hold.inboundCourseMag, 0, 0), hold.turn)).toBe(entry);
        expect(s.altitudeFt).toBe(hold.altitudeFt);
      }
    }
  });
});

describe('scenario commands', () => {
  it('repositions first, clears the old routing, then loads the approach', () => {
    const p = plan({ start: { kind: 'final' }, transition: null });
    expect(p.commands[0]).toMatchObject({ type: 'sim.reposition', altitudeFt: 3000, iasKt: 95 });
    const types = p.commands.map((c) => c.type);
    expect(types.indexOf('fms.removeApproach')).toBeLessThan(types.indexOf('fms.loadApproach'));
    expect(find(p.commands, 'fms.replacePlan')?.plan).toEqual([KJYO_WP]);
    expect(find(p.commands, 'fms.loadApproach')).toMatchObject({ activate: 'vtf', transition: null, approach: RNAV17 });
    expect(find(p.commands, 'cdi.source')?.source).toBe('GPS');
    expect(find(p.commands, 'baro.set')?.inHg).toBe(29.92);
  });

  it('on final the autopilot holds altitude in HDG with APR armed', () => {
    const p = plan({ start: { kind: 'final' }, transition: null });
    const ap = p.commands.filter((c) => c.type.startsWith('ap.'));
    expect(ap).toEqual([
      { type: 'ap.engage', on: true },
      { type: 'ap.vertical', mode: 'ALT' },
      { type: 'ap.lateral', mode: 'HDG' },
      { type: 'ap.approach', on: true },
    ]);
    expect(find(p.commands, 'bug.heading')?.mag).toBe(Math.round(p.start.headingMag));
    expect(p.summary).toContain('vectors to final');
  });

  it('from a transition activates it and flies NAV', () => {
    const p = plan({});
    expect(find(p.commands, 'fms.loadApproach')).toMatchObject({ activate: 'activate', transition: 'MRB' });
    expect(find(p.commands, 'ap.lateral')?.mode).toBe('NAV');
    expect(p.summary).toBe(`12 nm NW of MRB, 3,000 ft, heading ${formatBearing(p.start.headingMag)}. RNAV 17 active from MRB. Autopilot NAV, ALT.`);
  });

  it('leaves the approach to the pilot when asked, flying direct to the transition fix', () => {
    const p = plan({ load: 'none' });
    expect(find(p.commands, 'fms.loadApproach')).toBeUndefined();
    expect(find(p.commands, 'fms.directTo')?.waypoint.ident).toBe('MRB');
  });

  it('tunes and sets the localizer for an ILS, with the CDI on NAV1 when on final', () => {
    const p = plan({ approach: ILS17, start: { kind: 'final' }, transition: null });
    expect(find(p.commands, 'nav.setActive')).toEqual({ type: 'nav.setActive', radio: 0, khz: 111750 });
    expect(find(p.commands, 'obs.set')).toEqual({ type: 'obs.set', radio: 0, mag: 171 });
    expect(find(p.commands, 'cdi.source')?.source).toBe('NAV1');
    // From a transition the GPS flies the feeder; the pilot switches to the localizer.
    expect(find(plan({ approach: ILS17 }).commands, 'cdi.source')?.source).toBe('GPS');
  });

  it('can leave NAV1 for the pilot to tune, and says when the localizer is missing', () => {
    expect(find(plan({ approach: ILS17, tuneLocalizer: false }).commands, 'nav.setActive')).toBeUndefined();
    const p = plan({ approach: ILS17 }, env({ localizer: null }));
    expect(p.notes).toEqual(['Localizer IJYO is not in the database: NAV1 was left as it was.']);
  });

  it('starts at a holding fix with the published hold', () => {
    const p = plan({ start: { kind: 'hold', entry: 'teardrop' } });
    expect(find(p.commands, 'fms.directTo')?.waypoint.ident).toBe('KORNY');
    expect(find(p.commands, 'fms.hold')).toMatchObject({ inboundCourseMag: 81.1, turn: 'R', legNm: 4, legTimeMin: null });
    expect(find(p.commands, 'fms.loadApproach')).toBeUndefined();
    expect(p.start.altitudeFt).toBe(4000);
    expect(p.hold?.fix.ident).toBe('KORNY');
  });

  it('hand flying disengages the autopilot; a transition start needs a transition', () => {
    expect(find(plan({ autopilot: false }).commands, 'ap.engage')?.on).toBe(false);
    expect(planScenario(request({ transition: null }), env())).toEqual({ error: 'Pick a transition to start before its first fix.' });
  });
});
