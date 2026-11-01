import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, distanceNm, norm360, type LatLon } from '../../core/geo';
import type { Approach, ProcFix, ProcLeg } from '../../core/procedures';
import * as fms from '../fms';
import { loadSimState, saveSimState } from '../persist';
import { vorSolution } from '../radionav';
import type { Simulator } from '../simulator';
import { approach, db, destination, engageNav, fly, KJYO, kjyoProcedures, mag, simAt, wp } from './testkit';

/*
 * Closed-loop flights of real KJYO procedures (FAA CIFP) and of synthetic
 * legs where the real data has none nearby, with the shared autopilot.
 */

const labels = (a: Approach, transition: string | null) =>
  fms.buildApproachLegs(a, transition, KJYO, { mag, db }).map((l) => `${l.label}${l.role ? `(${l.role})` : ''}`);

const activeIndex = (sim: Simulator) => sim.getState().fms.activeLeg?.approachIndex ?? null;
const legIndex = (sim: Simulator, label: string) => sim.getState().fms.approach!.legs.findIndex((l) => l.label === label);

describe('approach legs built from the CIFP', () => {
  it('builds RNAV 17 through the MRB transition, the final and the missed approach', () => {
    expect(labels(approach('R17'), 'MRB')).toEqual([
      'MRB(IAF)',
      'CACAS(IF)',
      'DANMO(FAF)',
      'CEYAC',
      'RW17(MAP)',
      '1100ft',
      'KORNY(MAHP)',
      'HOLD',
    ]);
  });

  it('flies the CACAS hold in lieu of a procedure turn: to the fix, the hold, then on to the FAF', () => {
    const legs = fms.buildApproachLegs(approach('R17'), 'CACAS', KJYO, { mag, db });
    expect(legs.slice(0, 3).map((l) => [l.path, l.label, l.role ?? ''])).toEqual([
      ['IF', 'CACAS', 'IAF'],
      ['HF', 'HOLD', ''],
      ['TF', 'DANMO', 'FAF'],
    ]);
    expect(legs[1]).toMatchObject({ courseMag: 171.2, distanceNm: 4, turn: 'R' });
  });

  it('builds ILS 17 with its DME leg, the localizer courses and the intercept in the missed approach', () => {
    expect(labels(approach('I17'), 'MRB')).toEqual([
      'MRB(IAF)',
      'D134J',
      'STILL(IF)',
      'JOTUP',
      'DANMO(FAF)',
      'RW17(MAP)',
      '1200ft',
      'INTRCPT',
      'GAWDD(MAHP)',
      'HOLD',
    ]);
    const final = fms.buildApproachLegs(approach('I17'), null, KJYO, { mag, db }).find((l) => l.label === 'DANMO')!;
    // Localizer-based courses use the localizer's own declination (W10): 171 magnetic is 161 true.
    expect(final.courseTrue).toBeCloseTo(161, 5);
  });

  it('annunciates the service level from the type and the minima', () => {
    expect(fms.approachMode(approach('R17'))).toBe('LPV');
    expect(fms.approachMode(approach('I17'))).toBe('ILS');
    const lnav: Approach = { ...approach('R17'), minima: ['LNAV'] };
    expect(fms.approachMode(lnav)).toBe('LNAV+V');
    const { path: _path, ...withoutPath } = lnav;
    expect(fms.approachMode({ ...withoutPath, final: lnav.final.map(({ verticalAngleDeg: _v, ...l }) => l) })).toBe('LNAV');
  });
});

describe('loading, activating and removing an approach', () => {
  const pos = { lat: 39.5, lon: -77.9 };

  it('replaces the destination airport and flows from the enroute plan into the approach', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KHGR'), KJYO], pos);
    expect(f.activeLeg?.to.ident).toBe('KJYO');
    f = fms.loadApproach(f, KJYO, approach('R17'), 'MRB', 'load', pos, { mag, db });
    expect(f.plan.map((w) => w.ident)).toEqual(['KHGR']);
    expect(f.approach).toMatchObject({ transition: 'MRB', destinationRemoved: true, activated: true });
    // The leg that went to KJYO now goes to the first fix of the approach.
    expect(f.activeLeg).toMatchObject({ approachIndex: 0, to: { ident: 'MRB' }, from: { ident: 'KHGR' } });
    f = fms.removeApproach(f, pos);
    expect(f.plan.map((w) => w.ident)).toEqual(['KHGR', 'KJYO']);
    expect(f.activeLeg).toMatchObject({ to: { ident: 'KJYO' }, isDirectTo: true });
  });

  it('sequences from the last enroute waypoint into the approach, skipping the duplicate IAF', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KHGR'), wp('MRB')], pos);
    f = fms.loadApproach(f, KJYO, approach('R17'), 'MRB', 'load', pos, { mag, db });
    expect(f.approach?.activated).toBe(false);
    f = fms.sequence(f, wp('MRB'), 100, { trackTrue: 180 });
    expect(f.activeLeg).toMatchObject({ approachIndex: 1, from: { ident: 'MRB' }, to: { ident: 'CACAS' } });
    expect(f.approach?.activated).toBe(true);
  });

  it('activates direct to the first fix, or vectors to final along the extended final approach course', () => {
    let f = fms.loadApproach(fms.EMPTY_FMS, KJYO, approach('R17'), 'ZAXEN', 'activate', pos, { mag, db });
    expect(f.activeLeg).toMatchObject({ approachIndex: 0, isDirectTo: true, from: { ident: 'P.POS' }, to: { ident: 'ZAXEN' } });
    f = fms.activateApproach(f, true, pos, { mag, db });
    const faf = f.approach!.legs.findIndex((l) => l.role === 'FAF');
    expect(f.activeLeg).toMatchObject({ approachIndex: faf, from: { ident: 'VTF' }, to: { ident: 'DANMO' } });
    expect(f.approach?.vectorsToFinal).toBe(true);
    // The VTF line is the CACAS-DANMO course extended outward.
    const c = bearing(f.activeLeg!.from, f.activeLeg!.to);
    expect(Math.abs(angleDiff(c, bearing(wp('CACAS'), wp('DANMO'))))).toBeLessThan(0.5);
  });

  it('goes direct to a fix in the approach and continues the procedure from it', () => {
    let f = fms.loadApproach(fms.EMPTY_FMS, KJYO, approach('R17'), 'MRB', 'load', pos, { mag, db });
    f = fms.directTo(f, wp('CACAS'), pos);
    expect(f.activeLeg).toMatchObject({ approachIndex: 1, isDirectTo: true });
    f = fms.sequence(f, wp('CACAS'), 100, { trackTrue: 160 });
    expect(f.activeLeg?.to.ident).toBe('DANMO');
  });
});

describe('CDI scaling', () => {
  const r17 = () => {
    const s = simAt({ lat: 39.3, lon: -77.7 }, 2100, 160);
    s.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: null, activate: 'activate' });
    return s;
  };
  const at = (s: Simulator, p: LatLon, index: number) => {
    const st = s.getState();
    const f = fms.activateApproachLeg(st.fms, index, p, { mag });
    return fms.gpsSolution(f, p, 160, 100, mag);
  };

  it('ramps from 1.0 nm 2 nm before the FAF to 0.3 nm at it, then narrows angularly toward the runway', () => {
    const s = r17();
    const legs = s.getState().fms.approach!.legs;
    const faf = legs.findIndex((l) => l.role === 'FAF');
    const danmo = legs[faf]!.to!;
    const cacas = legs[faf - 1]!.to!;
    const course = bearing(cacas, danmo);
    const before = (nm: number) => destination(danmo, course + 180, nm);
    expect(at(s, before(3), faf)).toMatchObject({ scale: 'TERM', phase: 'TERM', fullScaleNm: 1 });
    expect(at(s, before(1), faf).scale).toBe('APR');
    expect(at(s, before(1), faf).fullScaleNm).toBeCloseTo(0.65, 2);
    expect(at(s, before(0.05), faf).fullScaleNm).toBeCloseTo(0.3175, 2);
    const thr = legs[faf + 2]!.to!;
    const fac = bearing(danmo, thr);
    const final = (nm: number) => destination(thr, fac + 180, nm);
    expect(at(s, final(4.5), faf + 1).fullScaleNm).toBeCloseTo(0.3, 5);
    const near = at(s, final(1), faf + 2);
    expect(near).toMatchObject({ scale: 'APR', phase: 'APR' });
    expect(near.fullScaleNm).toBeLessThan(0.13);
    expect(near.fullScaleNm).toBeGreaterThan(0.1);
  });

  it('keeps LNAV linear at 0.3 nm inside the FAF', () => {
    const s = simAt({ lat: 39.3, lon: -77.7 }, 2100, 160);
    // LNAV only, without a vertical angle (with one it would be LNAV+V, scaled angularly).
    const { path: _path, ...r17 } = approach('R17');
    const lnav: Approach = { ...r17, minima: ['LNAV'], final: r17.final.map(({ verticalAngleDeg: _v, ...l }) => l) };
    expect(fms.approachMode(lnav)).toBe('LNAV');
    s.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: lnav, transition: null, activate: 'activate' });
    const legs = s.getState().fms.approach!.legs;
    const thr = legs.find((l) => l.role === 'MAP')!.to!;
    const p = destination(thr, bearing(wp('DANMO'), thr) + 180, 1);
    expect(at(s, p, legs.findIndex((l) => l.role === 'MAP')).fullScaleNm).toBe(0.3);
  });
});

describe('RNAV 17 (LPV) at KJYO flown with the autopilot', () => {
  it('flies the MRB transition to the MAP on the glidepath, suspends, and flies the missed approach into the KORNY hold', () => {
    const start = destination(db.get('MRB')!, 290, 12);
    const sim = simAt(start, 3000, 110, 100);
    const d = sim.dispatch;
    d({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'MRB', activate: 'activate' });
    d({ type: 'engine.throttle', value: 0.55 });
    engageNav(sim);
    d({ type: 'ap.approach', on: true });
    expect(sim.getState().ap).toMatchObject({ approach: true, lateral: 'NAV', verticalArmed: 'GS' });
    expect(sim.getDerived().approach).toMatchObject({ name: 'RNAV 17', mode: 'LPV', activated: true, activeLegIndex: 0, transition: 'MRB' });
    // About 32 nm from KJYO: enroute scaling, 2 nm full scale.
    expect(sim.getDerived().gps).toMatchObject({ scale: 'ENR', fullScaleNm: 2 });

    const faf = legIndex(sim, 'DANMO');
    const map = legIndex(sim, 'RW17');
    const scales: string[] = [];
    const note = () => {
      const sc = sim.getDerived().gps.scale;
      if (scales[scales.length - 1] !== sc) scales.push(sc);
    };
    expect(fly(sim, 1500, () => activeIndex(sim) === faf, note)).toBeLessThan(1500);
    expect(scales).toEqual(['ENR', 'TERM']);
    d({ type: 'bug.altitude', ft: 2100 });
    d({ type: 'ap.vertical', mode: 'VS' });
    d({ type: 'bug.verticalSpeed', fpm: -600 });
    d({ type: 'ap.armAltitude', on: true });

    // The approach scale ramps over the last 2 nm to the FAF; the glidepath captures from level at about the FAF.
    const ramp: [number, number][] = [];
    fly(
      sim,
      600,
      () => sim.getState().ap.vertical === 'GS',
      () => {
        note();
        const ap = sim.getDerived().approach!;
        if (ap.distanceToFafNm !== null) ramp.push([ap.distanceToFafNm, sim.getDerived().gps.fullScaleNm]);
      },
    );
    expect(sim.getState().ap.vertical).toBe('GS');
    expect(Math.abs(sim.getState().aircraft.altitudeFt - 2100)).toBeLessThan(60);
    expect(distanceNm(sim.getState().aircraft, wp('DANMO'))).toBeLessThan(1);
    for (const [dist, fs] of ramp) {
      if (dist > 2.05) expect(fs).toBe(1);
      else expect(fs).toBeCloseTo(0.3 + 0.35 * Math.max(dist, 0), 1);
    }
    d({ type: 'engine.throttle', value: 0.3 });

    let maxDev = 0;
    let maxXtk = 0;
    let minScale = 1;
    let onPath = false;
    fly(
      sim,
      900,
      () => sim.getState().fms.suspended,
      () => {
        note();
        const dv = sim.getDerived();
        onPath ||= dv.vertical !== null && Math.abs(dv.vertical.deviationFt) < 15;
        if (onPath && dv.vertical) maxDev = Math.max(maxDev, Math.abs(dv.vertical.deviationFt));
        if (activeIndex(sim)! > faf) {
          maxXtk = Math.max(maxXtk, Math.abs(dv.gps.crossTrackNm));
          minScale = Math.min(minScale, dv.gps.fullScaleNm);
        }
      },
    );
    const susp = sim.getDerived();
    expect(sim.getState().fms.suspended).toBe(true);
    expect(activeIndex(sim)).toBe(map);
    expect(susp.approach).toMatchObject({ suspended: true, phase: 'MAPR' });
    expect(susp.gps).toMatchObject({ scale: 'MAPR', fullScaleNm: 1, toFrom: 'FROM' });
    expect(maxDev).toBeLessThan(40);
    expect(maxXtk).toBeLessThan(0.05);
    expect(minScale).toBeLessThan(0.08); // angular: about 350 ft either side at the threshold
    expect(Math.abs(sim.getState().aircraft.altitudeFt - (378 + 44.8))).toBeLessThan(40);
    expect(scales).toEqual(['ENR', 'TERM', 'APR', 'MAPR']);

    // Missed approach: climb at Vy and go on to the missed approach legs.
    d({ type: 'engine.throttle', value: 1 });
    d({ type: 'bug.altitude', ft: 4000 });
    d({ type: 'ap.vertical', mode: 'IAS' });
    d({ type: 'bug.airspeed', kt: 80 });
    d({ type: 'ap.armAltitude', on: true });
    d({ type: 'fms.unsuspend' });
    expect(sim.getState().fms.suspended).toBe(false);
    expect(sim.getDerived().gps.legLabel).toBe('1100ft');
    const korny = legIndex(sim, 'KORNY');
    fly(sim, 300, () => activeIndex(sim) === korny);
    expect(activeIndex(sim)).toBe(korny);
    expect(Math.abs(sim.getState().aircraft.altitudeFt - 1100)).toBeLessThan(40);
    // DF KORNY with a published right turn: about 140 degrees to the right, never to the left.
    let minBank = 0;
    let maxBank = 0;
    fly(sim, 60, () => false, () => {
      minBank = Math.min(minBank, sim.getState().aircraft.bankDeg);
      maxBank = Math.max(maxBank, sim.getState().aircraft.bankDeg);
    });
    expect(maxBank).toBeGreaterThan(15);
    expect(minBank).toBeGreaterThan(-3);
    expect(Math.abs(angleDiff(sim.getDerived().trackMag, sim.getDerived().gps.bearingMag!))).toBeLessThan(5);
    d({ type: 'engine.throttle', value: 0.6 });

    // The missed approach hold: parallel entry from the southeast, then racetrack circuits.
    fly(sim, 900, () => sim.getState().fms.hold !== null && sim.getState().fms.hold!.entryStep !== 'toFix');
    const entered = sim.getState().fms.hold!;
    expect(entered).toMatchObject({ entry: 'parallel', source: 'procedure', turn: 'R', legNm: 4, termination: 'manual' });
    expect(sim.getState().fms.suspended).toBe(true);
    expect(sim.getDerived().approach?.holding).toBe(true);
    let farthest = 0;
    const phases = new Set<string>();
    fly(
      sim,
      1200,
      () => (sim.getState().fms.hold?.circuits ?? 0) >= 2,
      () => {
        farthest = Math.max(farthest, distanceNm(sim.getState().aircraft, wp('KORNY')));
        phases.add(sim.getState().fms.hold!.phase);
      },
    );
    const h = sim.getState().fms.hold!;
    expect(h.circuits).toBeGreaterThanOrEqual(2);
    expect([...phases].sort()).toEqual(['entry', 'inbound', 'outbound', 'turnInbound', 'turnOutbound']);
    expect(farthest).toBeLessThan(h.legLengthNm! + 2 * h.radiusNm! + 1);
    expect(sim.getState().fms.suspended).toBe(true);
    expect(sim.getDerived().gps.legLabel).toBe('HOLD');
  }, 60_000);
});

describe('ILS 17 at KJYO', () => {
  const loc = db.localizer('IJYO')!;
  const courseTrue = norm360(loc.courseMag + loc.magVar);
  const thr = loc.threshold!;

  it('reads the localizer with its published width and the glideslope', () => {
    // 6 degree course: 3 degrees right of the course (seen inbound) is full scale left.
    const right = destination(loc, courseTrue + 180 - 3, 8);
    const v = vorSolution(db, 111750, right, 2500, 90);
    expect(v.localizer?.ident).toBe('IJYO');
    expect(v.needle).toBeCloseTo(-1, 2);
    expect(v.courseMag).toBe(171.3);
    const onPath = destination(thr, courseTrue + 180, 5);
    const gs = vorSolution(db, 111750, onPath, 0, 0).glideslope!;
    const pathFt = gs.pathAltitudeFt;
    expect(vorSolution(db, 111750, onPath, pathFt, 0).glideslope!.needle).toBeCloseTo(0, 3);
    // 0.7 degrees full scale: above the path the needle says fly down.
    const above = vorSolution(db, 111750, onPath, pathFt + 300, 0).glideslope!;
    expect(above.needle).toBeLessThan(-0.6);
    expect(above.valid).toBe(true);
  });

  it('senses in reverse on the back course and has no glideslope there', () => {
    // Beyond the antenna, east of the course line: flying the back course inbound (northwest), right of it.
    const p = destination(destination(loc, courseTrue, 6), courseTrue - 90, 0.15);
    const v = vorSolution(db, 111750, p, 2000, 171);
    expect(v.backCourse).toBe(true);
    expect(v.glideslope).toBeNull();
    expect(v.needle).toBeGreaterThan(0.2); // shows fly right although the course is to the airplane's left
  });

  it('captures the localizer and the glideslope with APR and tracks both down to minimums', () => {
    const onCourse = destination(thr, courseTrue + 180, 11);
    const start = destination(onCourse, courseTrue + 90, 1.5);
    const sim = simAt(start, 2500, courseTrue - 30, 95);
    const d = sim.dispatch;
    d({ type: 'nav.setActive', radio: 0, khz: 111750 });
    d({ type: 'cdi.source', source: 'NAV1' });
    d({ type: 'obs.set', radio: 0, mag: 90 });
    const cdi = sim.getDerived().cdi;
    expect(cdi).toMatchObject({ label: 'ILS1', kind: 'ILS', courseMag: 171.3, flag: false, ident: 'IJYO' });
    expect(cdi.needle).toBeLessThan(-0.9);
    d({ type: 'bug.heading', mag: Math.round(mag.toMagnetic(courseTrue - 30, start.lat, start.lon)) });
    d({ type: 'engine.throttle', value: 0.55 });
    d({ type: 'ap.engage', on: true });
    d({ type: 'ap.lateral', mode: 'HDG' });
    d({ type: 'ap.vertical', mode: 'ALT' });
    d({ type: 'ap.approach', on: true });
    expect(sim.getState().ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV', verticalArmed: 'GS', approach: true });

    fly(sim, 400, () => sim.getState().ap.lateral === 'NAV');
    expect(sim.getState().ap.lateral).toBe('NAV');
    fly(sim, 600, () => sim.getState().ap.vertical === 'GS');
    expect(sim.getState().ap.vertical).toBe('GS');
    expect(sim.getDerived().vertical).toMatchObject({ source: 'GS', advisory: false, valid: true });
    d({ type: 'engine.throttle', value: 0.3 });

    let maxLoc = 0;
    let maxGs = 0;
    let onPath = false;
    fly(
      sim,
      600,
      () => sim.getState().aircraft.altitudeFt < 378 + 250,
      () => {
        const dv = sim.getDerived();
        // Captured from below the airplane waits level for the glideslope; measure once it is on it.
        onPath ||= Math.abs(dv.vertical!.deviationFt) < 15;
        if (!onPath) return;
        maxLoc = Math.max(maxLoc, Math.abs(dv.cdi.needle));
        maxGs = Math.max(maxGs, Math.abs(dv.vertical!.deviationFt));
      },
    );
    expect(onPath).toBe(true);
    expect(sim.getState().aircraft.altitudeFt).toBeLessThan(378 + 250);
    expect(sim.getDerived().approach).toBeNull(); // flown on the NAV receiver alone, no approach loaded
    expect(maxLoc).toBeLessThan(0.2);
    expect(maxGs).toBeLessThan(40);
    expect(distanceNm(sim.getState().aircraft, thr)).toBeLessThan(1.5);
  }, 30_000);
});

describe('ILS 17 missed approach', () => {
  it('climbs to 1200, turns right to heading 340 for MRB R-157, and holds at GAWDD', () => {
    const loc = db.localizer('IJYO')!;
    const courseTrue = norm360(loc.courseMag + loc.magVar);
    const sim = simAt(destination(loc.threshold!, courseTrue + 180, 0.3), 450, courseTrue, 85);
    const d = sim.dispatch;
    d({ type: 'fms.loadApproach', airport: KJYO, approach: approach('I17'), transition: null, activate: 'load' });
    d({ type: 'fms.activateApproachLeg', index: legIndex(sim, 'RW17') });
    engageNav(sim);
    d({ type: 'engine.throttle', value: 1 });
    d({ type: 'bug.altitude', ft: 4000 });
    d({ type: 'ap.vertical', mode: 'IAS' });
    d({ type: 'bug.airspeed', kt: 80 });
    d({ type: 'ap.armAltitude', on: true });
    fly(sim, 60, () => sim.getState().fms.suspended);
    d({ type: 'fms.unsuspend' });
    expect(sim.getDerived().gps.legLabel).toBe('1200ft');
    fly(sim, 200, () => sim.getDerived().gps.legLabel === 'INTRCPT');
    expect(Math.abs(sim.getState().aircraft.altitudeFt - 1200)).toBeLessThan(40);
    let minBank = 0;
    fly(sim, 60, () => false, () => (minBank = Math.min(minBank, sim.getState().aircraft.bankDeg)));
    expect(minBank).toBeGreaterThan(-3); // the published right turn
    expect(Math.abs(angleDiff(sim.getDerived().headingMag, 340))).toBeLessThan(3);
    // Heading 340 and R-157 are nearly parallel here: abeam GAWDD the FMS gives up the intercept and goes to the fix.
    fly(sim, 1500, () => (sim.getState().fms.hold?.entryStep ?? 'toFix') !== 'toFix');
    expect(distanceNm(sim.getState().aircraft, wp('GAWDD'))).toBeLessThan(0.3);
    expect(sim.getState().fms.hold).toMatchObject({ legTimeMin: 1, turn: 'R', inboundCourseMag: 157.6 });
    expect(sim.getState().fms.suspended).toBe(true);
  }, 30_000);
});

describe('holding', () => {
  const fix = { kind: 'user' as const, ident: 'HOLDX', name: 'HOLDX', lat: 39.6, lon: -77.4 };

  const holdFrom = (entry: 'direct' | 'teardrop' | 'parallel', turn: 'L' | 'R') => {
    const inboundTrue = mag.toTrue(360, fix.lat, fix.lon);
    const rel = { direct: { R: 0, L: 0 }, teardrop: { R: 145, L: 215 }, parallel: { R: 235, L: 125 } }[entry][turn];
    const arrival = norm360(inboundTrue + rel);
    const start = destination(fix, arrival + 180, 5);
    const sim = simAt(start, 4000, arrival, 95);
    sim.dispatch({ type: 'engine.throttle', value: 0.6 });
    sim.dispatch({ type: 'fms.directTo', waypoint: fix });
    sim.dispatch({ type: 'fms.hold', waypoint: fix, inboundCourseMag: 360, turn, legTimeMin: 1, legNm: null });
    engageNav(sim);
    return sim;
  };

  for (const [entry, turn] of [
    ['direct', 'R'],
    ['teardrop', 'R'],
    ['parallel', 'R'],
    ['teardrop', 'L'],
    ['parallel', 'L'],
  ] as const) {
    it(`enters with a ${entry} entry (${turn === 'R' ? 'right' : 'left'} turns) and flies the racetrack`, () => {
      const sim = holdFrom(entry, turn);
      expect(sim.getState().fms.hold).toMatchObject({ entryStep: 'toFix', source: 'pilot' });
      fly(sim, 400, () => sim.getState().fms.hold?.entryStep !== 'toFix');
      const h0 = sim.getState().fms.hold!;
      expect(h0.entry).toBe(entry);
      expect(sim.getState().fms.suspended).toBe(true);
      let farthest = 0;
      let wrongSide = 0;
      const inboundTrue = mag.toTrue(360, fix.lat, fix.lon);
      fly(
        sim,
        900,
        () => (sim.getState().fms.hold?.circuits ?? 0) >= 2,
        () => {
          const p = sim.getState().aircraft;
          farthest = Math.max(farthest, distanceNm(p, fix));
          // Once established, the racetrack stays on the holding side of the inbound course.
          const side = angleDiff(bearing(fix, p), inboundTrue + 180);
          const holdingSide = turn === 'R' ? side < 0 : side > 0;
          if ((sim.getState().fms.hold?.circuits ?? 0) >= 1 && !holdingSide && distanceNm(p, fix) > 1.2) wrongSide += 1;
        },
      );
      const h = sim.getState().fms.hold!;
      expect(h.circuits).toBeGreaterThanOrEqual(2);
      expect(farthest).toBeLessThan(h.legLengthNm! + 2 * h.radiusNm! + 1.2);
      expect(wrongSide).toBe(0);
    }, 20_000);
  }

  it('leaves a pilot hold at the fix when exited and resumes the flight plan', () => {
    const mrb = wp('MRB');
    const kjyo = wp('KJYO');
    const sim = simAt(destination(mrb, 140, 6), 4000, 320, 95);
    sim.dispatch({ type: 'fms.replacePlan', plan: [kjyo, mrb, wp('KHGR')] });
    sim.dispatch({ type: 'fms.activateLeg', index: 1 });
    sim.dispatch({ type: 'fms.hold', waypoint: mrb, inboundCourseMag: 300, turn: 'R', legTimeMin: 1, legNm: null });
    engageNav(sim);
    fly(sim, 600, () => (sim.getState().fms.hold?.circuits ?? 0) >= 1);
    expect(sim.getState().fms.activeLeg?.to.ident).toBe('MRB');
    sim.dispatch({ type: 'fms.exitHold' });
    expect(sim.getState().fms.hold?.exitArmed).toBe(true);
    fly(sim, 600, () => sim.getState().fms.hold === null);
    expect(sim.getState().fms).toMatchObject({ hold: null, suspended: false, activeLeg: { from: { ident: 'MRB' }, to: { ident: 'KHGR' } } });
  }, 20_000);
});

describe('vectors to final', () => {
  it('captures the extended final approach course from a heading and sequences past the FAF onto the glidepath', () => {
    const legs = fms.buildApproachLegs(approach('R17'), null, KJYO, { mag, db });
    const danmo = legs.find((l) => l.role === 'FAF')!.to!;
    const course = bearing(wp('CACAS'), danmo);
    const start = destination(destination(danmo, course + 180, 7), course - 90, 3);
    const sim = simAt(start, 2100, course + 45, 95);
    const d = sim.dispatch;
    d({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: null, activate: 'vtf' });
    expect(sim.getDerived().approach).toMatchObject({ vectorsToFinal: true, activated: true });
    d({ type: 'engine.throttle', value: 0.55 });
    d({ type: 'bug.heading', mag: Math.round(mag.toMagnetic(course + 45, start.lat, start.lon)) });
    d({ type: 'ap.engage', on: true });
    d({ type: 'ap.lateral', mode: 'HDG' });
    d({ type: 'ap.vertical', mode: 'ALT' });
    d({ type: 'ap.approach', on: true });
    expect(sim.getState().ap).toMatchObject({ lateralArmed: 'NAV', verticalArmed: 'GS' });
    fly(sim, 400, () => sim.getState().ap.lateral === 'NAV');
    expect(sim.getState().ap.lateral).toBe('NAV');
    const faf = legs.findIndex((l) => l.role === 'FAF');
    fly(sim, 600, () => activeIndex(sim) === faf + 1);
    expect(sim.getState().fms.activeLeg?.to.ident).toBe('CEYAC');
    fly(sim, 120, () => sim.getState().ap.vertical === 'GS');
    expect(sim.getState().ap.vertical).toBe('GS');
    expect(Math.abs(sim.getDerived().gps.crossTrackNm)).toBeLessThan(0.05);
  }, 20_000);
});

// Synthetic procedures ---------------------------------------------------

const P = (ident: string, p: LatLon): ProcFix => ({ ident, lat: p.lat, lon: p.lon, kind: 'fix' });

function synthetic(final: ProcLeg[], missed: ProcLeg[] = []): Approach {
  return { id: 'R99', type: 'RNAV', name: 'RNAV (GPS) RWY 99', runway: '99', minima: ['LNAV'], transitions: [], final, missed };
}

describe('procedure legs', () => {
  it('climbs on a course to an altitude (CA), then turns left the long way direct to a fix (DF)', () => {
    const base = { lat: 39.4, lon: -77.3 };
    const target = destination(base, 90, 6);
    const a = synthetic(
      [{ path: 'IF', fix: P('AAAAA', destination(base, 180, 5)) }, { path: 'TF', fix: P('MAPPP', base), map: true, flyover: true }],
      [
        { path: 'CA', courseMag: 0, altitude: { kind: 'atOrAbove', ft: 1500 } },
        { path: 'DF', fix: P('EASTT', target), turn: 'L', altitude: { kind: 'atOrAbove', ft: 3000 } },
        { path: 'HM', fix: P('EASTT', target), turn: 'R', courseMag: 270, legTimeMin: 1 },
      ],
    );
    const sim = simAt(base, 900, mag.toTrue(0, base.lat, base.lon), 80);
    const d = sim.dispatch;
    d({ type: 'fms.loadApproach', airport: KJYO, approach: a, transition: null, activate: 'load' });
    d({ type: 'fms.activateMissed' });
    expect(sim.getDerived().gps.legLabel).toBe('1500ft');
    d({ type: 'engine.throttle', value: 1 });
    engageNav(sim);
    d({ type: 'bug.airspeed', kt: 80 });
    d({ type: 'ap.vertical', mode: 'IAS' });
    d({ type: 'bug.altitude', ft: 3000 });
    d({ type: 'ap.armAltitude', on: true });
    let maxXtk = 0;
    fly(sim, 300, () => sim.getDerived().gps.legLabel !== '1500ft', () => (maxXtk = Math.max(maxXtk, Math.abs(sim.getDerived().gps.crossTrackNm))));
    expect(sim.getDerived().gps.legLabel).toBe('EASTT');
    expect(Math.abs(sim.getState().aircraft.altitudeFt - 1500)).toBeLessThan(40);
    expect(maxXtk).toBeLessThan(0.05);
    // The fix is 90 degrees to the right, but the turn is published left: about 270 degrees left.
    let maxBank = 0;
    let turned = 0;
    let lastHdg = sim.getState().aircraft.headingTrue;
    fly(sim, 90, () => false, () => {
      const h = sim.getState().aircraft.headingTrue;
      turned += angleDiff(h, lastHdg);
      lastHdg = h;
      maxBank = Math.max(maxBank, sim.getState().aircraft.bankDeg);
    });
    expect(maxBank).toBeLessThan(2);
    expect(turned).toBeLessThan(-230);
    fly(sim, 600, () => (sim.getState().fms.hold?.entryStep ?? 'toFix') !== 'toFix');
    expect(distanceNm(sim.getState().aircraft, target)).toBeLessThan(0.3);
  }, 20_000);

  it('tracks an RF arc within 0.1 nm', () => {
    const a0 = { lat: 39.0, lon: -78.3 };
    const b = destination(a0, 0, 6);
    const center = destination(b, 90, 2);
    const c = destination(center, 0, 2);
    const e = destination(c, 90, 6);
    const appr = synthetic([
      { path: 'IF', fix: P('ARCAA', a0) },
      { path: 'TF', fix: P('ARCBB', b) },
      { path: 'RF', fix: P('ARCCC', c), turn: 'R', arcCenter: center, arcRadiusNm: 2 },
      { path: 'TF', fix: P('ARCDD', e), map: true, flyover: true },
    ]);
    const sim = simAt(destination(a0, 0, 1), 3000, 0, 100);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: appr, transition: null, activate: 'load' });
    sim.dispatch({ type: 'fms.activateApproachLeg', index: 1 });
    sim.dispatch({ type: 'engine.throttle', value: 0.6 });
    engageNav(sim);
    let onArc = 0;
    let maxXtk = 0;
    fly(sim, 900, () => activeIndex(sim) === 3, () => {
      if (activeIndex(sim) !== 2) return;
      onArc += 1;
      maxXtk = Math.max(maxXtk, Math.abs(sim.getDerived().gps.crossTrackNm));
      expect(sim.getDerived().steering?.kind).toBe('arc');
    });
    expect(activeIndex(sim)).toBe(3);
    expect(onArc).toBeGreaterThan(60);
    expect(maxXtk).toBeLessThan(0.1);
  }, 20_000);

  it('flies a DME arc (AF) around its navaid', () => {
    const navaid = { lat: 39.2, lon: -78.6 };
    const start = destination(navaid, 270, 10);
    const end = destination(navaid, 0, 10);
    const appr = synthetic([
      { path: 'IF', fix: P('DMEAA', destination(start, 180, 5)) },
      { path: 'TF', fix: P('DMEBB', start) },
      { path: 'AF', fix: P('DMECC', end), turn: 'R', arcCenter: navaid, arcRadiusNm: 10, recommendedNavaid: { ident: 'NAVV', ...navaid, kind: 'vor' } },
      { path: 'TF', fix: P('DMEDD', destination(end, 90, 5)), map: true, flyover: true },
    ]);
    const sim = simAt(destination(start, 180, 4), 3000, 0, 100);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: appr, transition: null, activate: 'load' });
    sim.dispatch({ type: 'fms.activateApproachLeg', index: 1 });
    sim.dispatch({ type: 'engine.throttle', value: 0.6 });
    engageNav(sim);
    let maxXtk = 0;
    let onArc = 0;
    fly(sim, 1200, () => activeIndex(sim) === 3, () => {
      if (activeIndex(sim) !== 2) return;
      onArc += 1;
      if (onArc > 20) maxXtk = Math.max(maxXtk, Math.abs(distanceNm(sim.getState().aircraft, navaid) - 10));
    });
    expect(activeIndex(sim)).toBe(3);
    expect(maxXtk).toBeLessThan(0.1);
  }, 20_000);

  it('flies a procedure turn (PI) and intercepts the inbound course', () => {
    const fixP = { lat: 39.8, lon: -78.0 };
    const inboundTrue = mag.toTrue(125, fixP.lat, fixP.lon);
    const appr = synthetic([
      { path: 'PI', fix: P('PTFIX', fixP), turn: 'R', courseMag: 260, distanceNm: 10 },
      { path: 'CF', fix: P('PTFIX', fixP), courseMag: 125 },
      { path: 'TF', fix: P('PTMAP', destination(fixP, inboundTrue, 6)), map: true, flyover: true },
    ]);
    // Arriving from the southeast, against the inbound course: the procedure turn reverses it.
    const sim = simAt(destination(fixP, inboundTrue, 5), 3000, norm360(inboundTrue + 180), 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: appr, transition: null, activate: 'activate' });
    expect(sim.getState().fms.approach!.legs.map((l) => l.path)).toEqual(['IF', 'PI', 'CF', 'TF']);
    sim.dispatch({ type: 'engine.throttle', value: 0.6 });
    engageNav(sim);
    const stages: string[] = [];
    fly(sim, 900, () => activeIndex(sim) === 2, () => {
      const st = sim.getState().fms.activeLeg?.stage;
      if (st && stages[stages.length - 1] !== st) stages.push(st);
    });
    expect(stages).toEqual(['outbound', 'away', 'turn', 'back']);
    expect(activeIndex(sim)).toBe(2);
    let maxDist = 0;
    fly(sim, 600, () => activeIndex(sim) === 3, () => (maxDist = Math.max(maxDist, distanceNm(sim.getState().aircraft, fixP))));
    expect(activeIndex(sim)).toBe(3);
    expect(maxDist).toBeLessThan(10);
    expect(Math.abs(sim.getDerived().gps.crossTrackNm)).toBeLessThan(0.2);
  }, 20_000);
});

describe('more leg types', () => {
  it('flies the CACAS hold in lieu of a procedure turn once (HF), then continues to the FAF', () => {
    const cacas = wp('CACAS');
    const sim = simAt(destination(cacas, 320, 6), 3000, 140, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'CACAS', activate: 'activate' });
    sim.dispatch({ type: 'engine.throttle', value: 0.6 });
    engageNav(sim);
    let circuits = 0;
    let entry: string | null = null;
    fly(sim, 1200, () => sim.getState().fms.activeLeg?.to.ident === 'DANMO', () => {
      const h = sim.getState().fms.hold;
      if (h && h.entryStep !== 'toFix') entry = h.entry;
      circuits = Math.max(circuits, h?.circuits ?? 0);
      // HF ends by itself: no SUSP.
      expect(sim.getState().fms.suspended).toBe(false);
    });
    expect(entry).toBe('direct');
    expect(sim.getState().fms.activeLeg?.to.ident).toBe('DANMO');
    expect(sim.getState().fms.hold).toBeNull();
    expect(distanceNm(sim.getState().aircraft, cacas)).toBeLessThan(0.6);
    expect(circuits).toBe(0); // the circuit completes as the hold is left at the fix
  }, 20_000);

  it('flies an FC leg (course from MRB for 10.2 nm) into the ILS 17 CF legs', () => {
    const mrb = db.get('MRB')!;
    const sim = simAt(destination(mrb, 270, 3), 3000, 90, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('I17'), transition: 'MRB', activate: 'activate' });
    engageNav(sim);
    fly(sim, 300, () => activeIndex(sim) === 1);
    expect(sim.getDerived().gps.to?.ident).toBe('D134J');
    fly(sim, 600, () => activeIndex(sim) === 2);
    expect(sim.getDerived().gps.to?.ident).toBe('STILL');
    expect(distanceNm(sim.getState().aircraft, mrb)).toBeGreaterThan(9.6);
    expect(distanceNm(sim.getState().aircraft, mrb)).toBeLessThan(10.4);
  }, 20_000);

  it('turns on a heading until the next course is intercepted (VI), then tracks it (CF)', () => {
    const base = { lat: 39.0, lon: -78.8 };
    const x = destination(destination(base, 90, 5), 180, 4);
    const appr = synthetic(
      [{ path: 'IF', fix: P('VIAAA', destination(base, 180, 5)) }, { path: 'TF', fix: P('VIMAP', base), map: true, flyover: true }],
      [
        { path: 'VI', courseMag: mag.toMagnetic(90, base.lat, base.lon), turn: 'R' },
        { path: 'CF', fix: P('VIFIX', x), courseMag: mag.toMagnetic(180, x.lat, x.lon) },
      ],
    );
    const sim = simAt(base, 3000, 0, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: appr, transition: null, activate: 'load' });
    sim.dispatch({ type: 'fms.activateMissed' });
    expect(sim.getDerived().gps.legLabel).toBe('INTRCPT');
    expect(sim.getDerived().steering).toMatchObject({ kind: 'heading', turn: 'R' });
    engageNav(sim);
    fly(sim, 400, () => activeIndex(sim) === 3);
    expect(activeIndex(sim)).toBe(3);
    fly(sim, 90, () => false);
    expect(Math.abs(sim.getDerived().gps.crossTrackNm)).toBeLessThan(0.1);
  }, 20_000);

  it('holds a heading until sequenced by hand (VM, MANSEQ)', () => {
    const base = { lat: 39.0, lon: -78.8 };
    const appr = synthetic(
      [{ path: 'IF', fix: P('VMAAA', destination(base, 180, 5)) }, { path: 'TF', fix: P('VMMAP', base), map: true, flyover: true }],
      [{ path: 'VM', courseMag: 270 }, { path: 'DF', fix: P('VMFIX', destination(base, 0, 8)) }],
    );
    const sim = simAt(base, 3000, 0, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: appr, transition: null, activate: 'load' });
    sim.dispatch({ type: 'fms.activateMissed' });
    engageNav(sim);
    sim.step(180);
    expect(sim.getDerived().gps.legLabel).toBe('MANSEQ');
    expect(Math.abs(angleDiff(sim.getDerived().headingMag, 270))).toBeLessThan(3);
    sim.dispatch({ type: 'fms.unsuspend' });
    expect(sim.getDerived().gps.legLabel).toBe('VMFIX');
  }, 20_000);

  it('flies a course into a waypoint after a direct-to with a course (D-> CRS)', () => {
    const mrb = wp('MRB');
    // 8 nm out, about 2.7 nm south of the course line through MRB.
    const sim = simAt(destination(mrb, 250, 8), 4000, 0, 100);
    sim.dispatch({ type: 'fms.directTo', waypoint: mrb, courseMag: 90 });
    expect(sim.getState().fms.activeLeg).toMatchObject({ courseMag: 90, isDirectTo: true, to: { ident: 'MRB' } });
    expect(Math.abs(angleDiff(sim.getDerived().gps.dtkMag!, 90))).toBeLessThan(1);
    engageNav(sim);
    fly(sim, 360, () => false);
    expect(Math.abs(sim.getDerived().gps.crossTrackNm)).toBeLessThan(0.1);
    expect(Math.abs(angleDiff(sim.getDerived().gps.dtkMag!, 90))).toBeLessThan(1);
  }, 20_000);

  it('shows an advisory glidepath on LNAV+V that the autopilot does not couple to', () => {
    const lnavV: Approach = { ...approach('R17'), minima: ['LNAV'] };
    const legs = fms.buildApproachLegs(lnavV, null, KJYO, { mag, db });
    const danmo = legs.find((l) => l.role === 'FAF')!.to!;
    const course = bearing(wp('CACAS'), danmo);
    const sim = simAt(destination(danmo, course + 180, 3), 2100, course, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: lnavV, transition: null, activate: 'vtf' });
    engageNav(sim);
    sim.dispatch({ type: 'ap.approach', on: true });
    expect(sim.getState().ap.verticalArmed).toBeNull();
    sim.dispatch({ type: 'ap.armGlidepath', on: true });
    expect(sim.getDerived().approach?.mode).toBe('LNAV+V');
    fly(sim, 240, () => sim.getState().ap.vertical === 'GS');
    expect(sim.getDerived().vertical).toMatchObject({ source: 'GP', advisory: true });
    expect(sim.getState().ap.vertical).toBe('ALT');
  }, 20_000);

  it('cancels the approach modes when APR is pressed again', () => {
    const sim = simAt({ lat: 39.3, lon: -77.7 }, 3000, 160);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: null, activate: 'activate' });
    engageNav(sim);
    sim.dispatch({ type: 'ap.approach', on: true });
    expect(sim.getState().ap).toMatchObject({ approach: true, verticalArmed: 'GS', lateral: 'NAV' });
    sim.dispatch({ type: 'ap.approach', on: false });
    expect(sim.getState().ap).toMatchObject({ approach: false, verticalArmed: null, lateral: 'ROL' });
  });
});

describe('session restore', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('restores a loaded approach, the active procedure leg, a hold and the armed glidepath', () => {
    const sim = simAt(destination(wp('KORNY'), 120, 3), 4000, 300, 95);
    sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'MRB', activate: 'activate' });
    const hold = legIndex(sim, 'HOLD');
    sim.dispatch({ type: 'fms.activateApproachLeg', index: hold });
    sim.dispatch({ type: 'ap.armGlidepath', on: true });
    sim.step(1);
    expect(sim.getState().fms.hold).not.toBeNull();
    const store = memory();
    saveSimState(sim.getState(), store);
    const restored = loadSimState(store);
    expect(restored.fms.approach?.legs).toEqual(sim.getState().fms.approach?.legs);
    expect(restored.fms.activeLeg).toMatchObject({ approachIndex: hold, to: { ident: 'KORNY' } });
    expect(restored.fms.hold).toEqual(sim.getState().fms.hold);
    expect(restored.ap.verticalArmed).toBe('GS');
  });

  it('drops a leg that points past the restored approach', () => {
    const store = memory();
    const state = simAt({ lat: 39, lon: -77.5 }, 3000, 0).getState();
    const broken = { ...state, fms: { ...state.fms, activeLeg: { from: KJYO, to: KJYO, planIndex: null, isDirectTo: false, approachIndex: 4 } } };
    saveSimState(broken, store);
    expect(loadSimState(store).fms.activeLeg).toBeNull();
  });
});

describe('procedure data', () => {
  it('comes from the FAA CIFP cycle in the build', () => {
    expect(kjyoProcedures.airport).toBe('KJYO');
    expect(approach('R17').path).toMatchObject({ angleDeg: 3 });
  });
});
