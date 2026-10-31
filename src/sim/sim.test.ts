import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, destination, distanceNm } from '../core/geo';
import { MagneticModel, type MagvarGrid } from '../core/magvar';
import { NavDatabase, type RawNavdata, type Waypoint } from '../core/navdb';
import { initialSimState } from './defaults';
import { excessPowerFpm, powerRequired } from './flight';
import * as fms from './fms';
import { loadSimState, mergeOver, saveSimState } from './persist';
import { vorSolution } from './radionav';
import { Simulator } from './simulator';
import type { SimState } from './types';

const db = new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata);
const mag = new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid);

const wp = (ident: string): Waypoint => NavDatabase.toWaypoint(db.get(ident)!);
const sim = (state: SimState = initialSimState()) => new Simulator(db, mag, state);

describe('flight model', () => {
  it('cruises a 172 at about 110 kt on 75% power and climbs about 700 fpm at Vy', () => {
    // Level flight speed where power required equals 75 %.
    let v = 60;
    while (powerRequired(v, 1) < 0.75) v += 0.5;
    expect(v).toBeGreaterThan(105);
    expect(v).toBeLessThan(115);
    expect(excessPowerFpm(74, 1, 1)).toBeGreaterThan(650);
    expect(excessPowerFpm(74, 1, 1)).toBeLessThan(800);
  });

  it('holds altitude and speed hands-off in trimmed cruise', () => {
    const s = sim();
    const before = s.getState().aircraft;
    s.step(60);
    const after = s.getState().aircraft;
    expect(Math.abs(after.altitudeFt - before.altitudeFt)).toBeLessThan(250);
    expect(after.iasKt).toBeGreaterThan(85);
    expect(after.iasKt).toBeLessThan(130);
  });

  it('stalls when the autopilot is asked to climb steeply at low power', () => {
    const s = sim();
    s.dispatch({ type: 'engine.throttle', value: 0.2 });
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.vertical', mode: 'VS' });
    s.dispatch({ type: 'bug.verticalSpeed', fpm: 1500 });
    s.step(90);
    expect(s.getState().messages.some((m) => m.text === 'STALL')).toBe(true);
  });
});

describe('autopilot', () => {
  it('turns to and holds the heading bug', () => {
    const s = sim();
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.lateral', mode: 'HDG' });
    s.dispatch({ type: 'bug.heading', mag: 90 });
    s.step(120);
    expect(Math.abs(s.getDerived().headingMag - 90)).toBeLessThan(2);
  });

  it('captures the preselected altitude from a climb', () => {
    const s = sim();
    s.dispatch({ type: 'engine.throttle', value: 1 });
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.vertical', mode: 'VS' });
    s.dispatch({ type: 'bug.verticalSpeed', fpm: 500 });
    s.dispatch({ type: 'bug.altitude', ft: 4500 });
    s.dispatch({ type: 'ap.armAltitude', on: true });
    s.step(240);
    const st = s.getState();
    expect(st.ap.vertical).toBe('ALT');
    expect(Math.abs(st.aircraft.altitudeFt - 4500)).toBeLessThan(40);
  });

  it('intercepts and tracks a GPS leg in NAV mode', () => {
    const start = initialSimState();
    // Start 1.5 nm right of the KJYO-MRB leg, heading parallel to it.
    const leg = start.fms.activeLeg!;
    const course = bearing(leg.from, leg.to);
    const mid = destination(leg.from, course, 6);
    const offset = destination(mid, course + 90, 1.5);
    const s = sim({ ...start, aircraft: { ...start.aircraft, lat: offset.lat, lon: offset.lon } });
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.lateral', mode: 'NAV' });
    s.dispatch({ type: 'ap.vertical', mode: 'ALT' });
    expect(Math.abs(s.getDerived().gps.crossTrackNm)).toBeGreaterThan(1);
    s.step(150);
    expect(Math.abs(s.getDerived().gps.crossTrackNm)).toBeLessThan(0.15);
  });

  it('flies the heading with NAV armed, then captures the course', () => {
    const start = initialSimState();
    const leg = start.fms.activeLeg!;
    const course = bearing(leg.from, leg.to);
    // 3 nm left of the leg, heading to intercept at 30 degrees.
    const offset = destination(destination(leg.from, course, 6), course - 90, 3);
    const s = sim({ ...start, aircraft: { ...start.aircraft, lat: offset.lat, lon: offset.lon } });
    const interceptHeading = Math.round(s.getDerived().gps.dtkMag! + 30);
    s.dispatch({ type: 'bug.heading', mag: interceptHeading });
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.lateral', mode: 'HDG' });
    s.dispatch({ type: 'ap.armNav', on: true });
    s.step(5);
    expect(s.getState().ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    s.step(240);
    expect(s.getState().ap).toMatchObject({ lateral: 'NAV', lateralArmed: null });
    expect(Math.abs(s.getDerived().gps.crossTrackNm)).toBeLessThan(0.3);
  });

  it('follows the GPS course in HDG mode with GPS steering on', () => {
    const start = initialSimState();
    const leg = start.fms.activeLeg!;
    const course = bearing(leg.from, leg.to);
    const offset = destination(destination(leg.from, course, 5), course + 90, 1);
    const s = sim({ ...start, aircraft: { ...start.aircraft, lat: offset.lat, lon: offset.lon } });
    // The bug points far away from the course; GPSS ignores it.
    s.dispatch({ type: 'bug.heading', mag: 180 });
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.lateral', mode: 'HDG' });
    s.dispatch({ type: 'ap.gpss', on: true });
    s.step(150);
    expect(Math.abs(s.getDerived().gps.crossTrackNm)).toBeLessThan(0.15);
    expect(s.getState().ap.lateral).toBe('HDG');
  });

  it('can level the wings in ROL whatever the current bank', () => {
    const s = sim();
    s.dispatch({ type: 'controls.set', roll: 1, pitch: 0 });
    s.step(2);
    s.dispatch({ type: 'controls.set', roll: 0, pitch: 0 });
    expect(Math.abs(s.getState().aircraft.bankDeg)).toBeGreaterThan(10);
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'ap.lateral', mode: 'ROL', rollRefDeg: 0 });
    s.step(10);
    expect(Math.abs(s.getState().aircraft.bankDeg)).toBeLessThan(1);
  });

  it('does not bring back a stale arm when the director comes back on', () => {
    const s = sim();
    s.dispatch({ type: 'ap.flightDirector', on: true });
    s.dispatch({ type: 'ap.armNav', on: true });
    s.dispatch({ type: 'ap.flightDirector', on: false });
    s.dispatch({ type: 'ap.flightDirector', on: true });
    expect(s.getState().ap.lateralArmed).toBeNull();
    s.dispatch({ type: 'ap.armNav', on: true });
    s.dispatch({ type: 'ap.engage', on: true });
    expect(s.getState().ap.lateralArmed).toBe('NAV'); // a live selection survives engagement
  });

  it('disconnects when the pilot moves the yoke', () => {
    const s = sim();
    s.dispatch({ type: 'ap.engage', on: true });
    s.dispatch({ type: 'controls.set', roll: 0.8, pitch: 0 });
    expect(s.getState().ap.engaged).toBe(false);
    expect(s.getState().messages.at(-1)?.text).toBe('Autopilot disconnected');
  });
});

describe('flight plan', () => {
  const pos = { lat: 39.1, lon: -77.6 };

  it('activates the first leg once the plan has two waypoints', () => {
    let f = fms.EMPTY_FMS;
    f = fms.insertWaypoint(f, 0, wp('KJYO'), pos);
    expect(f.activeLeg).toBeNull();
    f = fms.insertWaypoint(f, 1, wp('KFDK'), pos);
    expect(f.activeLeg?.to.ident).toBe('KFDK');
    expect(f.activeLeg?.from.ident).toBe('KJYO');
  });

  it('keeps the active waypoint when editing elsewhere, and replaces it when removed', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB'), wp('KHGR')], pos);
    expect(f.activeLeg?.to.ident).toBe('MRB');
    f = fms.insertWaypoint(f, 3, wp('KFDK'), pos);
    expect(f.activeLeg?.to.ident).toBe('MRB');
    f = fms.insertWaypoint(f, 0, wp('KIAD'), pos);
    expect(f.activeLeg).toMatchObject({ planIndex: 2, to: { ident: 'MRB' }, from: { ident: 'KJYO' } });
    f = fms.removeWaypoint(f, 2, pos);
    expect(f.activeLeg?.to.ident).toBe('KHGR');
  });

  it('sequences to the next leg at the waypoint', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB'), wp('KHGR')], pos);
    const mrb = db.get('MRB')!;
    f = fms.sequence(f, { lat: mrb.lat - 0.002, lon: mrb.lon + 0.002 }, 110);
    expect(f.activeLeg?.to.ident).toBe('KHGR');
    expect(f.activeLeg?.from.ident).toBe('MRB');
  });

  it('does not sequence in OBS mode', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB'), wp('KHGR')], pos);
    f = fms.setObsMode(f, true, 300);
    const mrb = db.get('MRB')!;
    expect(fms.sequence(f, mrb, 110).activeLeg?.to.ident).toBe('MRB');
  });

  it('flies direct-to from the present position and resumes the plan after', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB'), wp('KHGR')], pos);
    f = fms.directTo(f, wp('MRB'), pos, 1);
    expect(f.activeLeg).toMatchObject({ isDirectTo: true, planIndex: 1, from: { ident: 'P.POS' } });
    const mrb = db.get('MRB')!;
    f = fms.sequence(f, mrb, 110);
    expect(f.activeLeg?.to.ident).toBe('KHGR');
  });

  it('computes the GPS needle: right of course deflects it left', () => {
    let f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB')], pos);
    const leg = f.activeLeg!;
    const brg = bearing(leg.from, leg.to);
    const right = destination(destination(leg.from, brg, 5), brg + 90, 1);
    const sol = fms.gpsSolution(f, right, brg, 110, mag);
    expect(sol.crossTrackNm).toBeGreaterThan(0.5);
    expect(sol.needle).toBeLessThan(0);
    expect(sol.toFrom).toBe('TO');
    expect(sol.scale).toBe('TERM');
    f = fms.replacePlan(fms.EMPTY_FMS, [], pos);
    expect(fms.gpsSolution(f, right, brg, 110, mag).active).toBe(false);
  });

  it('reports cumulative distances for the plan page', () => {
    const f = fms.replacePlan(fms.EMPTY_FMS, [wp('KJYO'), wp('MRB'), wp('KHGR')], pos);
    const legs = fms.planLegs(f, pos, mag);
    expect(legs[0]!.cumulativeNm).toBeNull();
    expect(legs[1]!.cumulativeNm).toBeCloseTo(distanceNm(pos, wp('MRB')), 6);
    expect(legs[2]!.cumulativeNm!).toBeGreaterThan(legs[1]!.cumulativeNm!);
  });
});

describe('VOR receiver', () => {
  const aml = db.get('AML')!;

  it('reads the radial and FROM when on the selected course outbound', () => {
    const p = destination(aml, 360 + (aml as { magVar: number }).magVar, 12);
    const v = vorSolution(db, 113500, p, 4000, 0);
    expect(Math.abs(angleDiff(v.radialMag!, 0))).toBeLessThan(0.5);
    expect(v.toFrom).toBe('FROM');
    expect(Math.abs(v.needle)).toBeLessThan(0.05);
    expect(v.dmeNm).toBeGreaterThan(11.9);
  });

  it('deflects the needle toward the course, TO and FROM', () => {
    const magVar = (aml as { magVar: number }).magVar;
    // On the 010 radial with 000 selected FROM: right of course, fly left.
    const r010 = destination(aml, 10 + magVar, 15);
    expect(vorSolution(db, 113500, r010, 4000, 0).needle).toBeLessThan(-0.9);
    // On the 170 radial inbound on 360 (TO): right of course, fly left.
    const r170 = destination(aml, 170 + magVar, 15);
    const to = vorSolution(db, 113500, r170, 4000, 0);
    expect(to.toFrom).toBe('TO');
    expect(to.needle).toBeLessThan(-0.9);
  });

  it('flags when nothing is in range', () => {
    expect(vorSolution(db, 108000, { lat: 39, lon: -77.5 }, 3000, 0).station).toBeNull();
    expect(vorSolution(db, 110300, { lat: 39, lon: -77.5 }, 3000, 0).isLocalizer).toBe(true);
  });
});

describe('commands', () => {
  it('swaps radios and validates transponder codes', () => {
    const s = sim();
    const before = s.getState().radios.com[0];
    s.dispatch({ type: 'com.swap', radio: 0 });
    expect(s.getState().radios.com[0]).toEqual({ activeKhz: before.standbyKhz, standbyKhz: before.activeKhz });
    s.dispatch({ type: 'xpdr.code', code: '7700' });
    expect(s.getState().xpdr.code).toBe('7700');
    s.dispatch({ type: 'xpdr.code', code: '7800' });
    expect(s.getState().xpdr.code).toBe('7700');
  });

  it('times out the transponder ident after 18 seconds', () => {
    const s = sim();
    s.dispatch({ type: 'xpdr.ident' });
    expect(s.getState().xpdr.identUntil).not.toBeNull();
    s.step(19);
    expect(s.getState().xpdr.identUntil).toBeNull();
  });

  it('enters OBS mode on the current desired track', () => {
    const s = sim();
    const dtk = s.getDerived().gps.dtkMag!;
    s.dispatch({ type: 'fms.obs', on: true });
    expect(s.getState().fms.obsMode).toBe(true);
    expect(s.getState().fms.obsCourseMag).toBe(Math.round(dtk));
    s.dispatch({ type: 'course.set', mag: 250 });
    expect(s.getState().fms.obsCourseMag).toBe(250);
  });

  it('sets the GPS OBS course whatever the CDI source', () => {
    const s = sim();
    s.dispatch({ type: 'fms.obs', on: true });
    s.dispatch({ type: 'cdi.source', source: 'NAV1' });
    s.dispatch({ type: 'fms.obsCourse', mag: 123 });
    expect(s.getState().fms.obsCourseMag).toBe(123);
    expect(s.getState().nav.obsMag[0]).not.toBe(123);
  });

  it('cycles the CDI through the sources the panel has', () => {
    const s = sim();
    s.dispatch({ type: 'cdi.cycle', sources: ['GPS', 'NAV1'] });
    expect(s.getState().nav.cdiSource).toBe('NAV1');
    s.dispatch({ type: 'cdi.cycle', sources: ['GPS', 'NAV1'] });
    expect(s.getState().nav.cdiSource).toBe('GPS');
  });
});

describe('persistence', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('restores a saved session', () => {
    const store = memory();
    const s = sim();
    s.dispatch({ type: 'com.setStandby', radio: 0, khz: 119550 });
    s.dispatch({ type: 'fms.clear' });
    saveSimState(s.getState(), store);
    const restored = loadSimState(store);
    expect(restored.radios.com[0].standbyKhz).toBe(119550);
    expect(restored.fms.plan).toEqual([]);
    expect(restored.fms.activeLeg).toBeNull();
  });

  it('ignores corrupt or mistyped values', () => {
    const defaults = initialSimState();
    const merged = mergeOver(defaults, { aircraft: { lat: 'x', altitudeFt: Number.NaN }, radios: { com: [1] } });
    expect(merged.aircraft.lat).toBe(defaults.aircraft.lat);
    expect(merged.radios.com).toEqual(defaults.radios.com);
    const store = memory();
    store.setItem('panelmix:sim:v1', '{bad json');
    expect(loadSimState(store).aircraft.lat).toBe(defaults.aircraft.lat);
  });
});
