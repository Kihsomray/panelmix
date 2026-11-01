import { describe, expect, it } from 'vitest';
import { NO_AIRSPACE } from '../../core/airspace';
import { angleDiff, destination, projectNm, toRad, type LatLon } from '../../core/geo';
import { NO_TERRAIN } from '../../core/terrain';
import { initialSimState } from '../defaults';
import { windmillRpm } from '../flight';
import type { Simulator } from '../simulator';
import type { FailureState, SimState, TurbulenceLevel } from '../types';
import { applySystemsCommand } from './commands';
import { ELECTRICAL } from './electrical';
import { stepSystems, type SystemsContext } from './index';
import {
  airspaceOf,
  boxVolume,
  count,
  fly,
  holdVerticalSpeed,
  holdWingsLevel,
  makeSim,
  navdata,
  terrainOf,
  texts,
} from './testKit';
import { windAt } from './weather';

/*
 * The systems driven through the real simulator: each failure and weather
 * effect as a pilot (or an instructor) would see it, with stub terrain and
 * airspace providers. The default session starts at 3,500 ft west of
 * Leesburg, heading 300 true at 105 KIAS (about 99 kt over the ground).
 */

const ORIGIN = initialSimState().aircraft;
/** Open water off Ocean City: no airport within 8 nm. */
const OCEAN: LatLon = { lat: 38.3, lon: -74.4 };

const reposition = (s: Simulator, at: LatLon, altitudeFt: number, headingTrue: number, iasKt = 105) =>
  s.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt, headingTrue, iasKt });

const fail = (s: Simulator, failure: Exclude<keyof FailureState, 'engine'>, failed = true) =>
  s.dispatch({ type: 'failure.set', failure, failed });

/** Terrain at `topFt` between `fromNm` and `toNm` along `courseTrue` from `origin`, `baseFt` elsewhere. */
function ridge(origin: LatLon, courseTrue: number, fromNm: number, toNm: number, topFt: number, baseFt = 500) {
  return terrainOf((lat, lon) => {
    const { x, y } = projectNm(origin, { lat, lon });
    const along = x * Math.sin(toRad(courseTrue)) + y * Math.cos(toRad(courseTrue));
    return along >= fromNm && along <= toNm ? topFt : baseFt;
  });
}

describe('with nothing failed', () => {
  it('indicates the truth and leaves the systems state alone', () => {
    const s = makeSim();
    holdWingsLevel(s);
    s.step(1);
    const before = s.getState().systems;
    s.step(30);
    const st = s.getState();
    const a = st.aircraft;
    const d = s.getDerived();
    const sys = d.systems;
    expect(st.systems).toBe(before);
    expect(sys.air).toEqual({
      valid: true,
      iasKt: a.iasKt,
      altitudeFt: d.indicatedAltitudeFt,
      pressureAltitudeFt: d.pressureAltitudeFt,
      verticalSpeedFpm: a.verticalSpeedFpm,
      tasKt: a.tasKt,
      oatC: d.oatC,
    });
    expect(sys.attitude).toEqual({
      valid: true,
      pitchDeg: a.pitchDeg,
      bankDeg: a.bankDeg,
      slip: a.slip,
      turnRateDps: a.turnRateDps,
      headingValid: true,
      headingMag: d.headingMag,
    });
    expect(sys.vacuum).toEqual({ suctionInHg: 5, rigidity: 1, pitchDeg: a.pitchDeg, bankDeg: a.bankDeg, headingErrorDeg: 0 });
    expect(sys.turnCoordinator).toEqual({ powered: true, turnRateDps: a.turnRateDps, slip: a.slip });
    expect(sys.electrical).toMatchObject({
      batteryAmps: 1,
      batteryCharge: 1,
      avionicsPowered: true,
      alternatorFailed: false,
      alternatorOnline: true,
      batteryMinutes: null,
    });
    expect(sys.electrical.busVolts).toBeGreaterThan(28);
    expect(a.engine.volts).toBeCloseTo(sys.electrical.busVolts, 6);
    expect(sys.annunciators).toEqual({ lowVolts: false, lowVacuum: false, oilPressure: false, lowFuelL: false, lowFuelR: false });
    expect(sys.displays).toEqual({ pfd: 'normal', mfd: 'normal' });
    expect(sys).toMatchObject({ gpsValid: true, engineRunning: true, windFromTrue: 280, windKt: 12 });
    expect(sys.terrain).toEqual({ elevationFt: null, heightAglFt: null, alert: 'none', suppressed: false });
    expect(sys.airspace).toEqual({ inside: [], ahead: [] });
    expect(st.messages).toEqual([]);
  });

  it('hands the flight model the wind, the ground, the engine power and the bus', () => {
    const { mag } = navdata();
    const ctx = (over: Partial<SystemsContext> = {}): SystemsContext => ({
      mag,
      terrain: NO_TERRAIN,
      airspace: NO_AIRSPACE,
      fieldElevationFt: 389,
      indicatedAltitudeFt: 3500,
      headingMag: 310,
      oatC: 8,
      ...over,
    });
    const st = initialSimState();
    const step = stepSystems(st, 0.05, ctx());
    expect(step.systems).toBe(st.systems);
    expect(step.messages).toEqual([]);
    expect(step.effects).toMatchObject({
      powerFactor: 1,
      engineRunning: true,
      windFromTrue: 280,
      windKt: 12,
      gustBankDeg: 0,
      gustVerticalFpm: 0,
      gustAirspeedKt: 0,
      groundElevationFt: 389,
    });
    expect(step.effects.busVolts).toBeCloseTo(28.07, 2);
    expect(stepSystems(st, 0.05, ctx({ terrain: terrainOf(() => 1234) })).effects.groundElevationFt).toBe(1234);
    const failed = applySystemsCommand(st, { type: 'failure.engine', condition: 'failed' });
    expect(stepSystems(failed, 0.05, ctx()).effects).toMatchObject({ powerFactor: 0, engineRunning: false });
  });
});

describe('vacuum failure', () => {
  it('lets the attitude and heading indicators spin down and tumble over a few minutes', { timeout: 30000 }, () => {
    const a = makeSim();
    const b = makeSim();
    for (const s of [a, b]) {
      holdWingsLevel(s);
      fail(s, 'vacuum');
    }
    a.step(1);
    expect(a.getDerived().systems.vacuum.suctionInHg).toBe(0);
    expect(a.getDerived().systems.annunciators.lowVacuum).toBe(true);
    expect(a.getState().messages.at(-1)).toMatchObject({ text: 'LOW VACUUM', level: 'caution' });

    // The rotors keep their rigidity for a little while...
    a.step(14);
    let v = a.getDerived().systems.vacuum;
    expect(v.rigidity).toBe(1);
    expect(v.bankDeg).toBe(a.getState().aircraft.bankDeg);
    // ...are half spun down after two minutes...
    a.step(105);
    v = a.getDerived().systems.vacuum;
    expect(v.rigidity).toBeGreaterThan(0.3);
    expect(v.rigidity).toBeLessThan(0.7);
    expect(Math.abs(v.bankDeg - a.getState().aircraft.bankDeg)).toBeGreaterThan(5);
    // ...and show a steep bank with the wings level after four.
    a.step(120);
    v = a.getDerived().systems.vacuum;
    expect(Math.abs(a.getState().aircraft.bankDeg)).toBeLessThan(1);
    expect(Math.abs(v.bankDeg)).toBeGreaterThan(15);
    // The glass AHRS is unaffected.
    expect(a.getDerived().systems.attitude).toMatchObject({ valid: true, bankDeg: a.getState().aircraft.bankDeg });

    // Fully spun down, the attitude indicator no longer follows the airplane at all.
    a.step(180);
    b.step(420);
    b.dispatch({ type: 'ap.lateral', mode: 'ROL', rollRefDeg: 20 });
    a.step(10);
    b.step(10);
    expect(a.getState().time).toBeCloseTo(b.getState().time, 6);
    expect(b.getState().aircraft.bankDeg - a.getState().aircraft.bankDeg).toBeGreaterThan(15);
    expect(b.getDerived().systems.vacuum.rigidity).toBe(0);
    expect(b.getDerived().systems.vacuum.bankDeg).toBeCloseTo(a.getDerived().systems.vacuum.bankDeg, 9);

    // And the heading indicator card stands still through a 90 degree turn.
    const card = () => b.getDerived().headingMag + b.getDerived().systems.vacuum.headingErrorDeg;
    const heading0 = b.getDerived().headingMag;
    const card0 = card();
    b.dispatch({ type: 'bug.heading', mag: heading0 + 90 });
    b.dispatch({ type: 'ap.lateral', mode: 'HDG' });
    b.step(60);
    expect(Math.abs(angleDiff(b.getDerived().headingMag, heading0 + 90))).toBeLessThan(3);
    expect(Math.abs(angleDiff(card(), card0))).toBeLessThan(1);
    expect(count(b, 'LOW VACUUM')).toBe(1);
  });

  it('drifts the heading indicator faster as the gyro spins down', { timeout: 30000 }, () => {
    const s = makeSim();
    holdWingsLevel(s);
    fail(s, 'vacuum');
    s.step(60);
    const early = s.getDerived().systems.vacuum.headingErrorDeg;
    s.step(120);
    const later = s.getDerived().systems.vacuum.headingErrorDeg;
    // Flying straight: a working gyro drifts 4 degrees in 15 minutes, this one several a minute.
    expect(Math.abs(later - early)).toBeGreaterThan(8);
  });

  it('spins back up when the vacuum returns, leaving the heading indicator to be reset', { timeout: 30000 }, () => {
    const s = makeSim();
    holdWingsLevel(s);
    fail(s, 'vacuum');
    s.step(420);
    fail(s, 'vacuum', false);
    // Rigid again within two minutes: the attitude indicator shows the truth...
    s.step(120);
    const v = s.getDerived().systems.vacuum;
    expect(v).toMatchObject({ suctionInHg: 5, rigidity: 1, bankDeg: s.getState().aircraft.bankDeg, pitchDeg: s.getState().aircraft.pitchDeg });
    // ...but the heading indicator keeps the error it built up until the pilot resets it.
    expect(Math.abs(v.headingErrorDeg)).toBeGreaterThan(5);
    s.step(420);
    expect(s.getDerived().systems.vacuum.headingErrorDeg).toBe(v.headingErrorDeg);
    expect(s.getState().systems).toMatchObject({ gyroRotor: 1, vacuumLostAt: null });
    s.dispatch({ type: 'systems.alignHeadingIndicator' });
    expect(s.getDerived().systems.vacuum.headingErrorDeg).toBe(0);
  });
});

describe('pitot-static blockages', () => {
  it('makes the airspeed indicator an altimeter when the pitot tube blocks', () => {
    const s = makeSim();
    fail(s, 'pitot');
    s.step(1);
    const blockedAt = s.getDerived().systems.air.iasKt;
    expect(blockedAt).toBeCloseTo(s.getState().aircraft.iasKt, 0);
    s.dispatch({ type: 'engine.throttle', value: 1 });
    holdVerticalSpeed(s, 500);
    s.step(30);
    let air = s.getDerived().systems.air;
    let a = s.getState().aircraft;
    expect(a.iasKt).toBeLessThan(blockedAt);
    expect(air.iasKt).toBeGreaterThan(blockedAt + 15);
    // The altimeter and VSI use the static port, which still works.
    expect(air.altitudeFt).toBeCloseTo(s.getDerived().indicatedAltitudeFt, 6);
    expect(air.verticalSpeedFpm).toBe(a.verticalSpeedFpm);
    // Back down below where it blocked, it reads slow.
    s.dispatch({ type: 'bug.verticalSpeed', fpm: -500 });
    s.step(75);
    air = s.getDerived().systems.air;
    a = s.getState().aircraft;
    expect(a.altitudeFt).toBeLessThan(3400);
    expect(air.iasKt).toBeLessThan(a.iasKt - 20);
  });

  it('ignores real speed changes with the pitot tube blocked', () => {
    const s = makeSim();
    holdWingsLevel(s);
    fail(s, 'pitot');
    s.step(1);
    const indicated = s.getDerived().systems.air.iasKt;
    const truth = s.getState().aircraft.iasKt;
    s.dispatch({ type: 'engine.throttle', value: 0.45 });
    s.step(60);
    expect(truth - s.getState().aircraft.iasKt).toBeGreaterThan(10);
    expect(Math.abs(s.getDerived().systems.air.iasKt - indicated)).toBeLessThan(3);
  });

  it('freezes the altimeter and VSI and skews the airspeed when the static port blocks', () => {
    const s = makeSim();
    fail(s, 'static');
    s.step(1);
    const blocked = s.getDerived().systems.air;
    s.dispatch({ type: 'engine.throttle', value: 1 });
    holdVerticalSpeed(s, 500);
    s.step(30);
    let air = s.getDerived().systems.air;
    let a = s.getState().aircraft;
    expect(a.altitudeFt - ORIGIN.altitudeFt).toBeGreaterThan(200);
    expect(air.altitudeFt).toBeCloseTo(blocked.altitudeFt, 6);
    expect(air.pressureAltitudeFt).toBeCloseTo(blocked.pressureAltitudeFt, 6);
    expect(air.verticalSpeedFpm).toBe(0);
    // Above the blockage altitude the airspeed reads slow (about 10 kt per 100 ft).
    expect(air.iasKt).toBeLessThan(a.iasKt - 15);
    // The Kollsman window still moves the frozen needles.
    s.dispatch({ type: 'baro.set', inHg: s.getState().bugs.baroInHg + 0.1 });
    expect(s.getDerived().systems.air.altitudeFt).toBeCloseTo(blocked.altitudeFt + 100, 3);
    // Below it, the airspeed reads fast.
    s.dispatch({ type: 'bug.verticalSpeed', fpm: -500 });
    s.step(75);
    air = s.getDerived().systems.air;
    a = s.getState().aircraft;
    expect(a.altitudeFt).toBeLessThan(3300);
    expect(air.iasKt).toBeGreaterThan(a.iasKt + 15);
    // Clearing the failure opens the port.
    fail(s, 'static', false);
    s.step(0.05);
    air = s.getDerived().systems.air;
    expect(air.altitudeFt).toBeCloseTo(s.getDerived().indicatedAltitudeFt, 6);
    expect(air.verticalSpeedFpm).toBe(s.getState().aircraft.verticalSpeedFpm);
    expect(s.getState().systems.staticTrappedInHg).toBeNull();
  });

  it('freezes the airspeed too when both are blocked', () => {
    const s = makeSim();
    fail(s, 'pitot');
    fail(s, 'static');
    s.step(1);
    const indicated = s.getDerived().systems.air.iasKt;
    s.dispatch({ type: 'engine.throttle', value: 1 });
    holdVerticalSpeed(s, 700);
    s.step(40);
    expect(Math.abs(s.getDerived().systems.air.iasKt - indicated)).toBeLessThan(0.5);
    expect(Math.abs(s.getState().aircraft.iasKt - indicated)).toBeGreaterThan(5);
  });
});

describe('alternator failure', () => {
  it('runs the bus on the battery for about 35 minutes, then the avionics go dark', { timeout: 60000 }, () => {
    const s = makeSim();
    holdWingsLevel(s);
    fail(s, 'alternator');
    s.step(1);
    let sys = s.getDerived().systems;
    expect(sys.electrical).toMatchObject({
      alternatorFailed: true,
      alternatorOnline: false,
      avionicsPowered: true,
      batteryAmps: -ELECTRICAL.loadAmps,
    });
    expect(sys.electrical.busVolts).toBeGreaterThan(24);
    expect(sys.electrical.busVolts).toBeLessThan(24.5);
    expect(sys.electrical.batteryMinutes).toBeCloseTo(35, 0);
    expect(s.getState().aircraft.engine.volts).toBeCloseTo(sys.electrical.busVolts, 2);
    expect(sys.annunciators.lowVolts).toBe(true);
    expect(s.getState().messages.at(-1)).toMatchObject({ text: 'LOW VOLTS', level: 'caution' });

    let voltsAt20: number | null = null;
    let flatAt: number | null = null;
    fly(s, 45 * 60, 60, (t) => {
      const e = s.getDerived().systems.electrical;
      if (Math.abs(t - 20 * 60) < 1) voltsAt20 = e.busVolts;
      if (flatAt === null && !e.avionicsPowered) flatAt = t;
    });
    expect(voltsAt20).toBeGreaterThan(22);
    expect(voltsAt20).toBeLessThan(23.5);
    expect(flatAt).not.toBeNull();
    expect(flatAt! / 60).toBeGreaterThan(30);
    expect(flatAt! / 60).toBeLessThan(40);
    sys = s.getDerived().systems;
    expect(sys.electrical.batteryCharge).toBe(0);
    expect(sys.gpsValid).toBe(false);
    expect(sys.turnCoordinator).toMatchObject({ powered: false, turnRateDps: 0 });
    expect(count(s, 'LOW VOLTS')).toBe(1);

    // A charged battery brings the avionics back, still without an alternator.
    s.dispatch({ type: 'systems.chargeBattery' });
    sys = s.getDerived().systems;
    expect(sys.electrical).toMatchObject({ avionicsPowered: true, alternatorOnline: false, batteryCharge: 1 });
    expect(sys.gpsValid).toBe(true);
    // With the alternator back on line the bus returns to 28 V and charges the battery.
    s.dispatch({ type: 'systems.chargeBattery' });
    s.step(300);
    fail(s, 'alternator', false);
    s.step(1);
    sys = s.getDerived().systems;
    expect(sys.electrical.busVolts).toBeGreaterThan(28);
    expect(sys.electrical.batteryAmps).toBeGreaterThan(1);
    expect(sys.annunciators.lowVolts).toBe(false);
    const charge = sys.electrical.batteryCharge;
    s.step(60);
    expect(s.getDerived().systems.electrical.batteryCharge).toBeGreaterThan(charge);
  });
});

describe('AHRS, air data, GPS and display failures', () => {
  it('raises the flags glass units red-X on, and nothing else', () => {
    const s = makeSim();
    for (const failure of ['ahrs', 'adc', 'gps', 'pfdDisplay'] as const) fail(s, failure);
    s.step(1);
    const a = s.getState().aircraft;
    let sys = s.getDerived().systems;
    expect(sys.attitude).toMatchObject({ valid: false, headingValid: false });
    expect(sys.air.valid).toBe(false);
    // The pneumatic gauges and the vacuum gyros don't depend on them.
    expect(sys.air.iasKt).toBe(a.iasKt);
    expect(sys.vacuum.bankDeg).toBe(a.bankDeg);
    expect(sys.gpsValid).toBe(false);
    expect(sys.displays).toEqual({ pfd: 'failed', mfd: 'reversionary' });
    expect(s.getState().messages.at(-1)).toMatchObject({ text: 'GPS NAVIGATION LOST', level: 'caution' });
    s.step(30);
    expect(count(s, 'GPS NAVIGATION LOST')).toBe(1);
    fail(s, 'mfdDisplay');
    expect(s.getDerived().systems.displays).toEqual({ pfd: 'failed', mfd: 'failed' });
    s.dispatch({ type: 'failure.clearAll' });
    sys = s.getDerived().systems;
    expect(sys.attitude.valid && sys.attitude.headingValid && sys.air.valid && sys.gpsValid).toBe(true);
    expect(sys.displays).toEqual({ pfd: 'normal', mfd: 'normal' });
  });

  it('shows the MFD failed and the PFD in reversion for an MFD failure', () => {
    const s = makeSim();
    fail(s, 'mfdDisplay');
    expect(s.getDerived().systems.displays).toEqual({ pfd: 'reversionary', mfd: 'failed' });
  });
});

describe('engine failures', () => {
  it('runs rough: lower, surging RPM and not enough power to hold cruise speed', { timeout: 30000 }, () => {
    const rough = makeSim();
    const ok = makeSim();
    for (const s of [rough, ok]) holdWingsLevel(s);
    rough.dispatch({ type: 'failure.engine', condition: 'rough' });
    const rpms: number[] = [];
    fly(rough, 120, 0.5, () => {
      ok.step(0.5);
      rpms.push(rough.getState().aircraft.engine.rpm);
    });
    const mean = rpms.reduce((p, q) => p + q, 0) / rpms.length;
    const sd = Math.sqrt(rpms.reduce((p, q) => p + (q - mean) ** 2, 0) / rpms.length);
    expect(ok.getState().aircraft.engine.rpm - mean).toBeGreaterThan(250);
    expect(sd).toBeGreaterThan(40);
    expect(rough.getState().aircraft.iasKt).toBeLessThan(ok.getState().aircraft.iasKt - 10);
    expect(rough.getDerived().systems.engineRunning).toBe(true);
  });

  it('windmills and glides with a failed engine, stops the propeller when slow and restarts it in a dive', { timeout: 30000 }, () => {
    const s = makeSim();
    reposition(s, ORIGIN, 9000, 300, 100);
    holdVerticalSpeed(s, -720);
    s.dispatch({ type: 'failure.engine', condition: 'failed' });
    s.step(180);
    let a = s.getState().aircraft;
    let sys = s.getDerived().systems;
    expect(sys.engineRunning).toBe(false);
    expect(a.engine.fuelFlowGph).toBeLessThan(0.01);
    // Settles near best glide, gliding about 9 to 11 to 1.
    expect(a.iasKt).toBeGreaterThan(56);
    expect(a.iasKt).toBeLessThan(70);
    const glideRatio = (a.tasKt * 101.27) / -a.verticalSpeedFpm;
    expect(glideRatio).toBeGreaterThan(9);
    expect(glideRatio).toBeLessThan(11.5);
    expect(Math.abs(a.engine.rpm - windmillRpm(a.tasKt))).toBeLessThan(50);
    // The windmilling engine still turns the alternator, the vacuum pump and the oil pump.
    expect(sys.electrical.alternatorOnline).toBe(true);
    expect(sys.annunciators).toMatchObject({ oilPressure: false, lowVacuum: false, lowVolts: false });

    // Slowed to the stall, the propeller stops: no oil pressure, no vacuum, no alternator.
    s.dispatch({ type: 'bug.verticalSpeed', fpm: 0 });
    s.step(60);
    a = s.getState().aircraft;
    sys = s.getDerived().systems;
    expect(a.engine.rpm).toBe(0);
    expect(sys.annunciators).toMatchObject({ oilPressure: true, lowVacuum: true, lowVolts: true });
    expect(sys.electrical.alternatorOnline).toBe(false);
    expect(s.getState().systems.alerts.map((m) => m.key)).toEqual(expect.arrayContaining(['OIL PRESSURE', 'LOW VACUUM', 'LOW VOLTS']));

    // A dive past 100 KIAS gets it windmilling again.
    s.dispatch({ type: 'bug.verticalSpeed', fpm: -2000 });
    s.step(40);
    a = s.getState().aircraft;
    expect(a.iasKt).toBeGreaterThan(100);
    expect(a.engine.rpm).toBeGreaterThan(1000);
  });

  it('stops the engine when both tanks run dry', () => {
    const st = initialSimState();
    const s = makeSim({ ...st, aircraft: { ...st.aircraft, engine: { ...st.aircraft.engine, fuelGal: [0.002, 0.002] } } });
    holdWingsLevel(s);
    s.step(6);
    const sys = s.getDerived().systems;
    expect(sys.engineRunning).toBe(false);
    expect(s.getState().aircraft.engine.fuelFlowGph).toBeLessThan(1);
    expect(sys.annunciators).toMatchObject({ lowFuelL: true, lowFuelR: true });
    expect(count(s, 'LOW FUEL L')).toBe(1);
    expect(count(s, 'LOW FUEL R')).toBe(1);
  });
});

describe('winds aloft', () => {
  const layers = [
    { altitudeFt: 3000, fromTrue: 270, kt: 20 },
    { altitudeFt: 6000, fromTrue: 300, kt: 40 },
  ];

  it('publishes the wind interpolated at the airplane', () => {
    const s = makeSim();
    holdWingsLevel(s);
    s.dispatch({ type: 'weather.windsAloft', layers });
    s.step(0.1);
    const d = s.getDerived();
    // Above the lowest layer the ground below doesn't matter.
    const expected = windAt(s.getState().aircraft.altitudeFt, 0, { fromTrue: 280, kt: 12 }, layers);
    expect(d.systems.windKt).toBeCloseTo(expected.kt, 6);
    expect(d.systems.windFromTrue).toBeCloseTo(expected.fromTrue, 6);
    expect(d.windComponents.headwindKt).toBeCloseTo(d.systems.windKt * Math.cos(toRad(d.windRelativeDeg)), 6);
  });

  it('flies the airplane in the wind at its altitude', () => {
    const head = makeSim();
    const calm = makeSim();
    for (const s of [head, calm]) holdWingsLevel(s);
    head.dispatch({ type: 'weather.windsAloft', layers: [{ altitudeFt: 2000, fromTrue: 300, kt: 40 }] });
    head.step(10);
    calm.step(10);
    expect(calm.getState().aircraft.groundSpeedKt - head.getState().aircraft.groundSpeedKt).toBeGreaterThan(20);
    expect(head.getDerived().systems.windKt).toBeCloseTo(40, 6);
  });
});

describe('turbulence', () => {
  function bumps(level: TurbulenceLevel, seconds = 120) {
    const s = makeSim();
    const calm = makeSim();
    for (const x of [s, calm]) holdWingsLevel(x);
    s.dispatch({ type: 'weather.turbulence', level });
    const out = { bank: 0, vs: 0, ias: 0, alt: 0, meanIas: 0, meanCalm: 0, bankStep: 0, iasStep: 0, vsStep: 0 };
    let prev = s.getState().aircraft;
    let n = 0;
    fly(s, seconds, 0.05, () => {
      calm.step(0.05);
      const a = s.getState().aircraft;
      const c = calm.getState().aircraft;
      out.bank = Math.max(out.bank, Math.abs(a.bankDeg - c.bankDeg));
      out.vs = Math.max(out.vs, Math.abs(a.verticalSpeedFpm - c.verticalSpeedFpm));
      out.ias = Math.max(out.ias, Math.abs(a.iasKt - c.iasKt));
      out.alt = Math.max(out.alt, Math.abs(a.altitudeFt - c.altitudeFt));
      out.bankStep = Math.max(out.bankStep, Math.abs(a.bankDeg - prev.bankDeg));
      out.iasStep = Math.max(out.iasStep, Math.abs(a.iasKt - prev.iasKt));
      out.vsStep = Math.max(out.vsStep, Math.abs(a.verticalSpeedFpm - prev.verticalSpeedFpm));
      out.meanIas += a.iasKt;
      out.meanCalm += c.iasKt;
      prev = a;
      n++;
    });
    return { ...out, meanIas: out.meanIas / n, meanCalm: out.meanCalm / n };
  }

  it('leaves calm air calm', () => {
    const r = bumps(0, 20);
    expect(r.bank + r.vs + r.ias + r.alt).toBe(0);
  });

  it('barely moves the needles when light', { timeout: 30000 }, () => {
    const r = bumps(1);
    expect(r.bank).toBeGreaterThan(0.3);
    expect(r.bank).toBeLessThan(4);
    expect(r.vs).toBeLessThan(300);
    expect(r.ias).toBeLessThan(4);
    expect(r.alt).toBeLessThan(30);
  });

  it('is a handful when severe, but smooth and without draining the airspeed', { timeout: 30000 }, () => {
    const r = bumps(3);
    expect(r.bank).toBeGreaterThan(10);
    expect(r.vs).toBeGreaterThan(800);
    expect(r.ias).toBeGreaterThan(6);
    expect(r.alt).toBeLessThan(400);
    expect(Math.abs(r.meanIas - r.meanCalm)).toBeLessThan(4);
    // No jumps from one 50 ms step to the next.
    expect(r.bankStep).toBeLessThanOrEqual(12 * 0.05 + 1e-9);
    expect(r.iasStep).toBeLessThan(1.5);
    expect(r.vsStep).toBeLessThan(200);
  });

  it('repeats exactly for the same session', () => {
    const [p, q] = [makeSim(), makeSim()];
    for (const s of [p, q]) {
      holdWingsLevel(s);
      s.dispatch({ type: 'weather.turbulence', level: 2 });
      s.step(30);
    }
    expect(p.getState().aircraft).toEqual(q.getState().aircraft);
    expect(p.getState().aircraft).not.toEqual(makeSim().getState().aircraft);
  });
});

describe('terrain', () => {
  it('reads the ground below and keeps the airplane above it', () => {
    const s = makeSim(initialSimState(), { terrain: terrainOf(() => 800) });
    expect(s.getDerived().systems.terrain).toMatchObject({ elevationFt: 800, heightAglFt: ORIGIN.altitudeFt - 800 });
    holdVerticalSpeed(s, -1500);
    let lowest = Infinity;
    fly(s, 180, 1, () => {
      lowest = Math.min(lowest, s.getState().aircraft.altitudeFt);
    });
    expect(lowest).toBeGreaterThanOrEqual(800 - 1e-6);
    expect(s.getState().aircraft.altitudeFt).toBeCloseTo(800, 0);
    expect(s.getDerived().systems.terrain.heightAglFt).toBeCloseTo(0, 0);
  });

  it('falls back to the field elevation where no terrain is loaded', () => {
    const field = navdata().db.airport('KJYO')!;
    const s = makeSim();
    reposition(s, field, field.elevationFt + 1000, 300, 90);
    holdVerticalSpeed(s, -1000);
    s.step(90);
    expect(s.getDerived().systems.terrain).toMatchObject({ elevationFt: null, heightAglFt: null, alert: 'none' });
    expect(s.getState().aircraft.altitudeFt).toBeCloseTo(field.elevationFt, 0);
  });

  it('cautions, then warns, once each, flying level toward a ridge', { timeout: 30000 }, () => {
    const s = makeSim(initialSimState(), { terrain: ridge(ORIGIN, 300, 3.0, 4.0, 3450) });
    holdWingsLevel(s);
    let cautionAt: number | null = null;
    let warningAt: number | null = null;
    let last = '';
    fly(s, 170, 1, (t) => {
      last = s.getDerived().systems.terrain.alert;
      if (last === 'caution') cautionAt ??= t;
      if (last === 'warning') warningAt ??= t;
    });
    // The ridge is 110 s away: inside the one-minute look-ahead after 50 s, 30 s away after 80 s.
    expect(cautionAt).toBeGreaterThan(40);
    expect(cautionAt).toBeLessThan(60);
    expect(warningAt).toBeGreaterThan(70);
    expect(warningAt).toBeLessThan(90);
    expect(last).toBe('none');
    expect(texts(s)).toEqual(['CAUTION TERRAIN', 'TERRAIN AHEAD, PULL UP']);
  });

  it('warns of a steep descent toward flat ground', () => {
    const s = makeSim(initialSimState(), { terrain: terrainOf(() => 0) });
    reposition(s, OCEAN, 2500, 90);
    holdVerticalSpeed(s, -1500);
    let cautionAt: number | null = null;
    let warningAt: number | null = null;
    fly(s, 75, 1, (t) => {
      const alert = s.getDerived().systems.terrain.alert;
      if (alert === 'caution') cautionAt ??= t;
      if (alert === 'warning') warningAt ??= t;
    });
    expect(cautionAt).not.toBeNull();
    expect(warningAt).toBeGreaterThan(cautionAt!);
    expect(s.getState().aircraft.altitudeFt).toBeGreaterThan(500);
    expect(texts(s)).toEqual(['CAUTION TERRAIN', 'TERRAIN AHEAD, PULL UP']);
  });

  it('stays quiet on an approach to the nearest airport, low and slow, but not over open country', { timeout: 30000 }, () => {
    const { db, mag } = navdata();
    const field = db.airport('KJYO')!;
    const approach = (to: LatLon, groundFt: number) => {
      const start = destination(to, 0, 4);
      const s = makeSim(initialSimState(), { terrain: terrainOf(() => groundFt) });
      reposition(s, start, groundFt + 1270, 180, 80);
      s.dispatch({ type: 'engine.throttle', value: 0.1 });
      s.dispatch({ type: 'bug.heading', mag: mag.toMagnetic(180, start.lat, start.lon) });
      holdVerticalSpeed(s, -430);
      s.dispatch({ type: 'ap.lateral', mode: 'HDG' });
      return s;
    };

    const landing = approach(field, field.elevationFt);
    let alerts = 0;
    fly(landing, 170, 1, () => {
      const sys = landing.getDerived().systems;
      expect(sys.terrain.suppressed).toBe(true);
      expect(landing.getState().aircraft.iasKt).toBeLessThan(110);
      if (sys.terrain.alert !== 'none') alerts++;
    });
    expect(alerts).toBe(0);
    expect(texts(landing)).toEqual([]);

    const nowhere = approach(OCEAN, 0);
    fly(nowhere, 170, 1, () => {});
    expect(texts(nowhere)).toEqual(['CAUTION TERRAIN', 'TERRAIN AHEAD, PULL UP']);
  });
});

describe('airspace', () => {
  const ahead = (nm: number) => destination(ORIGIN, 300, nm);

  it('announces the airspace it is in and the airspace ahead, once each', () => {
    const source = airspaceOf([
      boxVolume('B', 'WASHINGTON CLASS B', 0, 10000, ORIGIN, 3),
      boxVolume('C', 'TESTVILLE CLASS C', 0, 5000, ahead(2), 0.5),
      boxVolume('D', 'LEESBURG CLASS D', 0, 2500, ahead(2), 0.6),
      boxVolume('D', 'BEHIND CLASS D', 0, 5000, destination(ORIGIN, 120, 2), 0.5),
    ]);
    const s = makeSim(initialSimState(), { airspace: source });
    holdWingsLevel(s);
    const first = s.getDerived().systems.airspace;
    expect(first.inside).toEqual([{ cls: 'B', name: 'WASHINGTON' }]);
    expect(first.ahead.map((v) => `${v.cls} ${v.name}`)).toEqual(['C TESTVILLE']);
    expect(first.ahead[0]!.minutes).toBeGreaterThan(0.6);
    expect(first.ahead[0]!.minutes).toBeLessThan(1);
    s.step(1);
    expect(s.getState().messages.map((m) => [m.text, m.level])).toEqual([
      ['Inside Class B: WASHINGTON', 'advisory'],
      ['Class C ahead: TESTVILLE', 'advisory'],
    ]);
    s.step(70);
    expect(s.getDerived().systems.airspace.inside).toEqual([
      { cls: 'C', name: 'TESTVILLE' },
      { cls: 'B', name: 'WASHINGTON' },
    ]);
    s.step(60);
    expect(texts(s)).toEqual(['Inside Class B: WASHINGTON', 'Class C ahead: TESTVILLE', 'Inside Class C: TESTVILLE']);
  });

  it('counts a descent into the airspace below as ahead', () => {
    const source = airspaceOf([boxVolume('D', 'LEESBURG CLASS D', 0, 2500, ahead(2), 0.6)]);
    const level = makeSim(initialSimState(), { airspace: source });
    const down = makeSim(initialSimState(), { airspace: source });
    holdWingsLevel(level);
    holdVerticalSpeed(down, -1000);
    level.step(5);
    down.step(5);
    expect(level.getDerived().systems.airspace.ahead).toEqual([]);
    expect(down.getDerived().systems.airspace.ahead.map((v) => v.name)).toEqual(['LEESBURG']);
    expect(texts(down)).toEqual(['Class D ahead: LEESBURG']);
  });

  it('does not repeat an advisory after a brief exit, but does after a long one', () => {
    const source = airspaceOf([boxVolume('B', 'WASHINGTON CLASS B', 0, 10000, ORIGIN, 3)]);
    const s = makeSim(initialSimState(), { airspace: source });
    holdWingsLevel(s);
    s.step(1);
    const away = destination(ORIGIN, 90, 20);
    reposition(s, away, 3500, 300);
    s.step(10);
    reposition(s, ORIGIN, 3500, 300);
    s.step(2);
    expect(count(s, 'Inside Class B: WASHINGTON')).toBe(1);
    reposition(s, away, 3500, 300);
    s.step(70);
    reposition(s, ORIGIN, 3500, 300);
    s.step(2);
    expect(count(s, 'Inside Class B: WASHINGTON')).toBe(2);
  });
});

describe('session state', () => {
  it('starts with healthy systems', () => {
    const st: SimState = initialSimState();
    expect(st.systems).toMatchObject({
      batteryCharge: 1,
      gyroRotor: 1,
      vacuumLostAt: null,
      headingIndicatorErrorDeg: 0,
      pitotTrappedInHg: null,
      staticTrappedInHg: null,
      alerts: [],
    });
  });
});
