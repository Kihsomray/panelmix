import { describe, expect, it } from 'vitest';
import { NO_AIRSPACE } from '../../core/airspace';
import { destination, projectNm, toRad, type LatLon } from '../../core/geo';
import { NO_TERRAIN } from '../../core/terrain';
import { airspeedForImpactPressure, impactPressureInHg, pressureAltitudeForInHg, staticPressureInHg } from '../atmosphere';
import { initialSimState } from '../defaults';
import { neutralEffects, powerRequired, propellerDrag, PERFORMANCE, stepFlight, windmillRpm } from '../flight';
import { mergeOver } from '../persist';
import type { AircraftState, EngineCondition, SimState } from '../types';
import { airspaceAwareness, airspaceShortName } from './airspaceAwareness';
import { heldTerrainLevel, updateAlerts, type ActiveAlert } from './alerts';
import { applySystemsCommand } from './commands';
import { batteryMinutes, batteryTerminalVolts, ELECTRICAL, electricalSolution, stepBattery } from './electrical';
import { engineOutput } from './engine';
import { NO_FAILURES } from './index';
import { hash01, smoothNoise } from './noise';
import { assessTerrain, TAWS } from './taws';
import { airspaceOf, boxVolume, terrainOf } from './testKit';
import type { TurbulenceLevel } from './types';
import { gyroRigidity, stepGyroRotor, stepHeadingIndicatorError, suctionInHg, VACUUM, vacuumAttitude } from './vacuum';
import { gustsAt, TURBULENCE, windAt } from './weather';

const aircraft = (over: Partial<AircraftState> = {}): AircraftState => ({ ...initialSimState().aircraft, ...over });

describe('pitot-static pressures', () => {
  it('follows the standard atmosphere and inverts exactly', () => {
    expect(staticPressureInHg(0)).toBeCloseTo(29.92, 2);
    expect(staticPressureInHg(5000)).toBeCloseTo(24.9, 1);
    expect(staticPressureInHg(10000)).toBeCloseTo(20.58, 1);
    for (const pa of [-500, 0, 3500, 9000, 17500]) expect(pressureAltitudeForInHg(staticPressureInHg(pa))).toBeCloseTo(pa, 3);
  });

  it('converts airspeed to impact pressure and back', () => {
    expect(impactPressureInHg(100)).toBeCloseTo(0.481, 3);
    for (const kt of [20, 65, 105, 160]) expect(airspeedForImpactPressure(impactPressureInHg(kt))).toBeCloseTo(kt, 6);
    expect(airspeedForImpactPressure(0)).toBe(0);
    expect(airspeedForImpactPressure(-0.3)).toBe(0);
  });
});

describe('smooth noise', () => {
  it('is repeatable and differs by seed', () => {
    expect(smoothNoise(12.34, 0.1, 7)).toBe(smoothNoise(12.34, 0.1, 7));
    expect(smoothNoise(12.34, 0.1, 7)).not.toBe(smoothNoise(12.34, 0.1, 8));
    for (let i = 0; i < 100; i++) {
      const h = hash01(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('has zero mean, unit RMS and no jumps', () => {
    const n = 40000;
    let sum = 0;
    let squares = 0;
    let maxStep = 0;
    let prev = smoothNoise(0, 0.05, 3);
    for (let i = 1; i <= n; i++) {
      const v = smoothNoise(i * 0.05, 0.05, 3);
      sum += v;
      squares += v * v;
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
    expect(Math.sqrt(squares / n)).toBeGreaterThan(0.85);
    expect(Math.sqrt(squares / n)).toBeLessThan(1.15);
    // The derivative is bounded: about 2.1 per second at 0.05 Hz.
    expect(maxStep).toBeLessThan(0.12);
  });
});

describe('winds aloft', () => {
  const surface = { fromTrue: 280, kt: 12 };
  const layers = [
    { altitudeFt: 3000, fromTrue: 270, kt: 20 },
    { altitudeFt: 6000, fromTrue: 300, kt: 40 },
  ];

  it('uses the surface wind without layers', () => {
    expect(windAt(5000, 400, surface, [])).toEqual(surface);
  });

  it('matches each layer at its altitude and holds the highest above it', () => {
    for (const [alt, from, kt] of [
      [3000, 270, 20],
      [6000, 300, 40],
      [12000, 300, 40],
    ] as const) {
      const w = windAt(alt, 400, surface, layers);
      expect(w.fromTrue).toBeCloseTo(from, 6);
      expect(w.kt).toBeCloseTo(kt, 6);
    }
  });

  it('interpolates as vectors, between layers and up from the surface', () => {
    const mid = windAt(4500, 400, surface, layers);
    expect(mid.kt).toBeCloseTo(29.09, 1);
    expect(mid.fromTrue).toBeCloseTo(290.1, 0);
    // Halfway between the ground (400 ft) and the 3,000 ft layer.
    const low = windAt(1700, 400, surface, layers);
    expect(low.kt).toBeCloseTo(15.94, 1);
    expect(low.fromTrue).toBeCloseTo(273.75, 0);
    expect(windAt(400, 400, surface, layers)).toEqual(surface);
  });

  it('skips layers below the ground and sorts unsorted layers', () => {
    const high = windAt(5000, 4000, surface, layers);
    expect(high.kt).toBeCloseTo(25.72, 1);
    expect(high.fromTrue).toBeCloseTo(295.4, 0);
    expect(windAt(4500, 400, surface, [...layers].reverse())).toEqual(windAt(4500, 400, surface, layers));
  });

  it('dies out between opposite winds instead of swinging around', () => {
    const w = windAt(4000, 0, { fromTrue: 90, kt: 20 }, [
      { altitudeFt: 3000, fromTrue: 90, kt: 20 },
      { altitudeFt: 5000, fromTrue: 270, kt: 20 },
    ]);
    expect(w.kt).toBeLessThan(0.1);
  });
});

describe('turbulence gusts', () => {
  const rms = (level: TurbulenceLevel) => {
    let bank = 0;
    let vertical = 0;
    let speed = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const g = gustsAt(level, i * 0.25);
      bank += g.bankDeg ** 2;
      vertical += g.verticalFpm ** 2;
      speed += g.airspeedKt ** 2;
    }
    return { bank: Math.sqrt(bank / n), vertical: Math.sqrt(vertical / n), speed: Math.sqrt(speed / n) };
  };

  it('is calm at level 0', () => {
    expect(gustsAt(0, 123)).toEqual({ bankDeg: 0, verticalFpm: 0, airspeedKt: 0 });
  });

  it('grows with the level and repeats for the same time', () => {
    const [light, moderate, severe] = [rms(1), rms(2), rms(3)];
    for (const k of ['bank', 'vertical', 'speed'] as const) {
      expect(light[k]).toBeGreaterThan(0);
      expect(light[k]).toBeLessThan(moderate[k]);
      expect(moderate[k]).toBeLessThan(severe[k]);
    }
    // Patches average a little under the nominal intensity.
    expect(severe.bank / TURBULENCE.bankDeg[3]).toBeGreaterThan(0.6);
    expect(severe.bank / TURBULENCE.bankDeg[3]).toBeLessThan(0.95);
    expect(gustsAt(2, 77.7)).toEqual(gustsAt(2, 77.7));
  });
});

describe('electrical system', () => {
  it('holds the bus at 28 V on the alternator and charges the battery', () => {
    const e = electricalSolution(1, false, 2300, 0.7);
    expect(e).toMatchObject({ alternatorOnline: true, avionicsPowered: true, batteryAmps: 1 });
    expect(e.busVolts).toBeCloseTo(28.07, 2);
    expect(electricalSolution(0.5, false, 2300, 0.7).batteryAmps).toBe(21);
    expect(electricalSolution(0, false, 2300, 0.7).batteryAmps).toBe(ELECTRICAL.maxChargeAmps);
    // A stopped engine doesn't turn the alternator.
    expect(electricalSolution(1, false, 0, 0).alternatorOnline).toBe(false);
  });

  it('drops to battery voltage at once, sags as it discharges and collapses when flat', () => {
    const full = electricalSolution(1, true, 2300, 0.7);
    expect(full.busVolts).toBeGreaterThan(24);
    expect(full.busVolts).toBeLessThan(ELECTRICAL.lowVolts);
    expect(full.batteryAmps).toBe(-ELECTRICAL.loadAmps);
    let prev = Infinity;
    for (let c = 1; c >= 0.005; c -= 0.005) {
      const v = batteryTerminalVolts(c, ELECTRICAL.loadAmps);
      expect(v).toBeLessThan(prev + 1e-9);
      prev = v;
    }
    expect(batteryTerminalVolts(0.5, 25)).toBeLessThan(batteryTerminalVolts(0.5, 10));
    const flat = electricalSolution(0, true, 2300, 0.7);
    expect(flat).toMatchObject({ avionicsPowered: false, batteryAmps: 0, alternatorOnline: false });
    expect(flat.busVolts).toBeLessThan(18);
  });

  it('carries the bus for a little over half an hour', () => {
    let charge = 1;
    let t = 0;
    while (charge > 0 && t < 7200) {
      charge = stepBattery(charge, -ELECTRICAL.loadAmps, 1);
      t += 1;
    }
    expect(t / 60).toBeGreaterThan(30);
    expect(t / 60).toBeLessThan(40);
    expect(batteryMinutes(1)).toBeCloseTo(t / 60, 0);
    expect(stepBattery(1, 5, 60)).toBe(1);
    expect(stepBattery(0.5, 20, 60)).toBeCloseTo(0.5 + (20 * ELECTRICAL.chargeEfficiency) / 60 / ELECTRICAL.capacityAh, 9);
  });
});

describe('vacuum gyros', () => {
  it('has suction from the engine-driven pump only', () => {
    expect(suctionInHg(false, 2300)).toBe(VACUUM.normalInHg);
    expect(suctionInHg(false, 700)).toBeGreaterThan(VACUUM.lowInHg);
    expect(suctionInHg(true, 2300)).toBe(0);
    expect(suctionInHg(false, 0)).toBe(0);
  });

  it('spins down over minutes and back up faster, settling exactly', () => {
    let rotor = 1;
    for (let t = 0; t < 120; t += 0.05) rotor = stepGyroRotor(rotor, 0, 0.05);
    expect(rotor).toBeCloseTo(Math.exp(-120 / VACUUM.spinDownS), 2);
    let up = 0.2;
    for (let t = 0; t < 180; t += 0.05) up = stepGyroRotor(up, 5, 0.05);
    expect(up).toBeGreaterThan(0.98);
    for (let t = 0; t < 600; t += 0.05) up = stepGyroRotor(up, 5, 0.05);
    expect(up).toBe(1);
    expect(gyroRigidity(1)).toBe(1);
    expect(gyroRigidity(0.85)).toBeCloseTo(1, 9);
    expect(gyroRigidity(0.475)).toBeCloseTo(0.5, 9);
    expect(gyroRigidity(0.05)).toBe(0);
  });

  it('shows the truth while rigid, and a tumbled attitude that ignores the airplane once spun down', () => {
    expect(vacuumAttitude(3, -10, 1, 100, 200)).toEqual({ pitchDeg: 3, bankDeg: -10 });
    const a = vacuumAttitude(3, -10, 0, 100, 500);
    const b = vacuumAttitude(-5, 30, 0, 100, 500);
    expect(a).toEqual(b);
    expect(Math.abs(a.bankDeg)).toBeGreaterThan(20);
    // Partly spun down: half the real attitude, half the tumble.
    const half = vacuumAttitude(0, 20, 0.5, 100, 500);
    expect(half.bankDeg).toBeCloseTo(10 + 0.5 * a.bankDeg, 9);
  });

  it('lets the heading indicator lag the turns and precess', () => {
    expect(stepHeadingIndicatorError(4, 1, 3, null, 1)).toBe(4);
    // Spun down: the card stands still while the airplane turns 30 degrees.
    expect(stepHeadingIndicatorError(0, 0, 3, 50, 10)).toBeCloseTo(-30, 9);
    // Half spun down, flying straight: precession at its fastest.
    expect(Math.abs(stepHeadingIndicatorError(0, 0.5, 0, 50, 60))).toBeCloseTo(VACUUM.headingDriftMaxDps * 60, 9);
    expect(stepHeadingIndicatorError(175, 0, 3, 50, 10)).toBeCloseTo(145, 9);
    expect(stepHeadingIndicatorError(-175, 0, -3, 50, 10)).toBeCloseTo(-145, 9);
    expect(stepHeadingIndicatorError(170, 0, -3, 50, 10)).toBeCloseTo(-160, 9);
  });
});

describe('engine condition', () => {
  const output = (engine: EngineCondition, time: number, fuelGal: readonly [number, number] = [24, 24]) => {
    const s = initialSimState();
    return engineOutput({
      ...s,
      time,
      aircraft: { ...s.aircraft, engine: { ...s.aircraft.engine, fuelGal } },
      systems: { ...s.systems, failures: { ...s.systems.failures, engine }, engineFaultSince: engine === 'ok' ? null : 0 },
    });
  };

  it('gives full power normally and none when failed or out of fuel', () => {
    expect(output('ok', 10)).toEqual({ powerFactor: 1, running: true });
    expect(output('failed', 10)).toEqual({ powerFactor: 0, running: false });
    expect(output('ok', 10, [0, 0])).toEqual({ powerFactor: 0, running: false });
    expect(output('ok', 10, [0, 3]).running).toBe(true);
  });

  it('runs rough at about 60 % with surges and sags', () => {
    const pf = Array.from({ length: 3000 }, (_, i) => output('rough', i * 0.1).powerFactor);
    const mean = pf.reduce((a, b) => a + b, 0) / pf.length;
    const sd = Math.sqrt(pf.reduce((a, b) => a + (b - mean) ** 2, 0) / pf.length);
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(0.66);
    expect(sd).toBeGreaterThan(0.05);
    expect(Math.min(...pf)).toBeGreaterThanOrEqual(0.25);
    expect(Math.max(...pf)).toBeLessThanOrEqual(0.85);
  });
});

/** Terrain at `topFt` between `fromNm` and `toNm` along `courseTrue` from `origin`, `baseFt` elsewhere. */
function ridge(origin: LatLon, courseTrue: number, fromNm: number, toNm: number, topFt: number, baseFt = 500) {
  return terrainOf((lat, lon) => {
    const { x, y } = projectNm(origin, { lat, lon });
    const along = x * Math.sin(toRad(courseTrue)) + y * Math.cos(toRad(courseTrue));
    return along >= fromNm && along <= toNm ? topFt : baseFt;
  });
}

describe('TAWS look-ahead', () => {
  // The default airplane: 3,500 ft, track 300, 105 kt over the ground (1 nm in 34 s).
  const a = aircraft();
  const nearField = { lat: 39.078, lon: -77.5575, elevationFt: 389 };

  it('reports nothing without terrain data, or with plenty of clearance', () => {
    expect(assessTerrain(a, NO_TERRAIN, null)).toEqual({ elevationFt: null, level: 'none', suppressed: false });
    expect(assessTerrain(a, terrainOf(() => 500), null)).toEqual({ elevationFt: 500, level: 'none', suppressed: false });
  });

  it('cautions for terrain within a minute and warns within 30 seconds', () => {
    expect(assessTerrain(a, ridge(a, 300, 1.0, 1.5, 3450), null).level).toBe('caution');
    expect(assessTerrain(a, ridge(a, 300, 0.5, 1.0, 3450), null).level).toBe('warning');
    // Terrain behind the airplane doesn't count.
    expect(assessTerrain(a, ridge(a, 120, 0.5, 1.0, 3450), null).level).toBe('none');
  });

  it('needs more clearance enroute than near an airport', () => {
    const terrain = ridge(a, 300, 0.5, 1.0, 3000);
    expect(assessTerrain(a, terrain, null).level).toBe('caution');
    expect(assessTerrain(a, terrain, nearField).level).toBe('none');
  });

  it('projects the descent rate', () => {
    const flat = terrainOf(() => 0);
    expect(assessTerrain(aircraft({ altitudeFt: 2500, verticalSpeedFpm: 0 }), flat, null).level).toBe('none');
    expect(assessTerrain(aircraft({ altitudeFt: 1500, verticalSpeedFpm: -1500 }), flat, null).level).toBe('caution');
    expect(assessTerrain(aircraft({ altitudeFt: 800, verticalSpeedFpm: -1500 }), flat, null).level).toBe('warning');
  });

  it('credits a climb over a ridge', () => {
    const terrain = ridge(a, 300, 0.5, 1.0, 3600);
    expect(assessTerrain(a, terrain, nearField).level).toBe('warning');
    expect(assessTerrain(aircraft({ verticalSpeedFpm: 1500 }), terrain, nearField).level).toBe('none');
  });

  it('is inhibited near the airport when low and slow, as when landing', () => {
    const flat = terrainOf(() => 389);
    const landing = aircraft({ ...destination(nearField, 0, 2), altitudeFt: 1000, iasKt: 80, verticalSpeedFpm: -500, trackTrue: 180 });
    expect(assessTerrain(landing, flat, nearField)).toEqual({ elevationFt: 389, level: 'none', suppressed: true });
    const fast = { ...landing, iasKt: 120, groundSpeedKt: 120 };
    expect(assessTerrain(fast, flat, nearField)).toMatchObject({ suppressed: false, level: 'caution' });
    const high = { ...landing, altitudeFt: 389 + TAWS.landing.belowFt + 100, verticalSpeedFpm: 0 };
    expect(assessTerrain(high, flat, nearField).suppressed).toBe(false);
  });

  it('uses whatever terrain is loaded ahead', () => {
    const patchy = terrainOf((lat) => (lat > a.lat + 0.005 ? null : 3450));
    // Only the sample under the airplane is known: 50 ft of clearance is a warning.
    expect(assessTerrain(a, patchy, null).level).toBe('warning');
  });
});

describe('airspace awareness', () => {
  const a = aircraft();
  const ahead = (nm: number) => destination(a, 300, nm);

  it('shortens names', () => {
    expect(airspaceShortName('WASHINGTON-TRI AREA CLASS B')).toBe('WASHINGTON-TRI AREA');
    expect(airspaceShortName('LEESBURG CLASS D AIRSPACE')).toBe('LEESBURG');
    expect(airspaceShortName('EL PASO CLASS D2')).toBe('EL PASO');
    expect(airspaceShortName('NORFOLK')).toBe('NORFOLK');
    expect(airspaceShortName('CLASS C')).toBe('CLASS C');
  });

  it('reports nothing without data', () => {
    expect(airspaceAwareness(NO_AIRSPACE, a)).toEqual({ inside: [], ahead: [] });
  });

  it('lists the airspace inside, innermost first, each name once', () => {
    const source = airspaceOf([
      boxVolume('B', 'WASHINGTON CLASS B', 3000, 10000, a, 10),
      boxVolume('B', 'WASHINGTON CLASS B', 0, 10000, a, 5),
      boxVolume('D', 'MANASSAS CLASS D', 0, 2500, a, 4),
      boxVolume('C', 'TINY CLASS C', 0, 5000, a, 2),
    ]);
    expect(airspaceAwareness(source, a).inside).toEqual([
      { cls: 'C', name: 'TINY' },
      { cls: 'B', name: 'WASHINGTON' },
    ]);
  });

  it('finds airspace about to be entered on the current track, and when', () => {
    const source = airspaceOf([
      boxVolume('C', 'AHEAD CLASS C', 0, 4000, ahead(2), 0.5),
      boxVolume('D', 'UNDER CLASS D', 0, 2500, ahead(2), 0.6),
      boxVolume('D', 'BEHIND CLASS D', 0, 5000, destination(a, 120, 2), 0.5),
      boxVolume('D', 'FAR CLASS D', 0, 5000, ahead(6), 0.5),
    ]);
    const result = airspaceAwareness(source, a);
    expect(result.inside).toEqual([]);
    expect(result.ahead.map((v) => v.name)).toEqual(['AHEAD']);
    // Track 300 meets the square's east side 0.5 / sin 60 short of its center: 1.42 nm at 105 kt.
    expect(result.ahead[0]!.minutes).toBeCloseTo(((2 - 0.5 / Math.sin(toRad(60))) / 105) * 60, 1);
    // Descending at 1,000 fpm, the Class D below comes up too.
    const descending = airspaceAwareness(source, { ...a, verticalSpeedFpm: -1000 });
    expect(descending.ahead.map((v) => v.name)).toEqual(['AHEAD', 'UNDER']);
  });

  it('does not report the other shelves of an airspace it is already in', () => {
    const source = airspaceOf([
      boxVolume('B', 'WASHINGTON CLASS B', 0, 10000, a, 1),
      boxVolume('B', 'WASHINGTON CLASS B', 2000, 10000, ahead(2), 0.6),
    ]);
    expect(airspaceAwareness(source, a)).toEqual({ inside: [{ cls: 'B', name: 'WASHINGTON' }], ahead: [] });
  });
});

describe('one-shot alerts', () => {
  const lowVolts: ActiveAlert = { key: 'LOW VOLTS', text: 'LOW VOLTS', level: 'caution' };

  it('posts once, then forgets only after the condition has been gone a while', () => {
    const first = updateAlerts([], [lowVolts], 0);
    expect(first.messages).toEqual([{ text: 'LOW VOLTS', level: 'caution' }]);
    // A steady condition leaves the state alone between refreshes.
    expect(updateAlerts(first.alerts, [lowVolts], 0.5)).toEqual({ alerts: first.alerts, messages: [] });
    let r = updateAlerts(first.alerts, [lowVolts], 2);
    expect(r.alerts).toEqual([{ key: 'LOW VOLTS', seenAt: 2 }]);
    r = updateAlerts(r.alerts, [], 8);
    r = updateAlerts(r.alerts, [lowVolts], 9);
    expect(r.messages).toEqual([]);
    r = updateAlerts(r.alerts, [], 25);
    expect(r.alerts).toEqual([]);
    expect(updateAlerts(r.alerts, [lowVolts], 26).messages).toHaveLength(1);
  });

  it('remembers silent alerts and prefers the entry with a message', () => {
    const silent: ActiveAlert = { key: 'x', text: null, level: 'advisory' };
    expect(updateAlerts([], [silent], 0)).toEqual({ alerts: [{ key: 'x', seenAt: 0 }], messages: [] });
    const loud: ActiveAlert = { key: 'x', text: 'X', level: 'advisory' };
    expect(updateAlerts([], [silent, loud], 0).messages).toEqual([{ text: 'X', level: 'advisory' }]);
    expect(updateAlerts([], [loud, silent], 0).messages).toEqual([{ text: 'X', level: 'advisory' }]);
  });

  it('holds a terrain alert for a few seconds', () => {
    const memos = [{ key: 'terrain:warning', seenAt: 10 }];
    expect(heldTerrainLevel('none', memos, 12)).toBe('warning');
    expect(heldTerrainLevel('caution', memos, 12)).toBe('warning');
    expect(heldTerrainLevel('none', memos, 10 + TAWS.holdS + 0.5)).toBe('none');
    expect(heldTerrainLevel('none', [{ key: 'terrain:caution', seenAt: 10 }], 12)).toBe('caution');
    expect(heldTerrainLevel('warning', [], 0)).toBe('warning');
  });
});

describe('systems commands', () => {
  const s = initialSimState();

  it('sets and clears failures', () => {
    expect(applySystemsCommand(s, { type: 'failure.set', failure: 'vacuum', failed: false })).toBe(s);
    const failed = applySystemsCommand(s, { type: 'failure.set', failure: 'vacuum', failed: true });
    expect(failed.systems.failures.vacuum).toBe(true);
    const rough = applySystemsCommand({ ...failed, time: 42 }, { type: 'failure.engine', condition: 'rough' });
    expect(rough.systems).toMatchObject({ engineFaultSince: 42, failures: { engine: 'rough', vacuum: true } });
    const cleared = applySystemsCommand({ ...rough, systems: { ...rough.systems, batteryCharge: 0.3 } }, { type: 'failure.clearAll' });
    expect(cleared.systems.failures).toEqual(NO_FAILURES);
    expect(cleared.systems.engineFaultSince).toBeNull();
    expect(cleared.systems.batteryCharge).toBe(0.3);
    expect(applySystemsCommand(cleared, { type: 'systems.chargeBattery' }).systems.batteryCharge).toBe(1);
    expect(applySystemsCommand(rough, { type: 'failure.engine', condition: 'ok' }).systems.engineFaultSince).toBeNull();
  });

  it('cleans and sorts winds aloft, and sets turbulence', () => {
    const next = applySystemsCommand(s, {
      type: 'weather.windsAloft',
      layers: [
        { altitudeFt: 6000, fromTrue: 370, kt: 20 },
        { altitudeFt: 3000, fromTrue: -10, kt: -5 },
        { altitudeFt: Number.NaN, fromTrue: 90, kt: 10 },
      ],
    });
    expect(next.systems.weather.windsAloft).toEqual([
      { altitudeFt: 3000, fromTrue: 350, kt: 0 },
      { altitudeFt: 6000, fromTrue: 10, kt: 20 },
    ]);
    expect(applySystemsCommand(s, { type: 'weather.turbulence', level: 2 }).systems.weather.turbulence).toBe(2);
  });
});

describe('flight model engine effects', () => {
  const env = initialSimState().env;

  it('glides about 9 to 10 to 1 at best glide with the propeller windmilling, better with it stopped', () => {
    const glideRatio = (stopped: boolean) => {
      const sinkFpm = PERFORMANCE.climbScale * (powerRequired(PERFORMANCE.vbg, 1) + propellerDrag(PERFORMANCE.vbg, 1, stopped));
      return (PERFORMANCE.vbg * 101.27) / sinkFpm;
    };
    expect(glideRatio(false)).toBeGreaterThan(9);
    expect(glideRatio(false)).toBeLessThan(10.5);
    expect(glideRatio(true)).toBeGreaterThan(glideRatio(false));
    expect(windmillRpm(65)).toBe(825);
    expect(windmillRpm(5)).toBe(0);
  });

  it('applies the airspeed gust as a change, and writes the electrical values to the gauges', () => {
    const a = initialSimState().aircraft;
    const targets = { bankDeg: 0, verticalSpeedFpm: 0 };
    const calm = stepFlight(a, targets, env, neutralEffects(env), 0.05).aircraft;
    const gust = stepFlight(a, targets, env, { ...neutralEffects(env), gustAirspeedKt: 2 }, 0.05).aircraft;
    expect(gust.tasKt - calm.tasKt).toBeCloseTo(2, 6);
    const lowVolts = stepFlight(a, targets, env, { ...neutralEffects(env), busVolts: 23.9, batteryAmps: -18 }, 0.05).aircraft;
    expect(lowVolts.engine).toMatchObject({ volts: 23.9, amps: -18 });
  });

  it('windmills a failed engine from the airspeed, stops it when slow and restarts it in a dive', () => {
    const dead = { ...neutralEffects(env), powerFactor: 0, engineRunning: false };
    const targets = { bankDeg: 0, verticalSpeedFpm: -700 };
    let a = initialSimState().aircraft;
    for (let i = 0; i < 200; i++) a = stepFlight(a, targets, env, dead, 0.05).aircraft;
    expect(a.engine.fuelFlowGph).toBe(0);
    expect(Math.abs(a.engine.rpm - windmillRpm(a.tasKt))).toBeLessThan(40);

    const slow = { ...a, iasKt: 50, tasKt: 52 };
    let b = slow;
    for (let i = 0; i < 100; i++) b = stepFlight({ ...b, iasKt: 50, tasKt: 52 }, targets, env, dead, 0.05).aircraft;
    expect(b.engine.rpm).toBe(0);
    // Below the restart speed a stopped propeller stays stopped...
    let c = b;
    for (let i = 0; i < 40; i++) c = stepFlight({ ...c, iasKt: 95, tasKt: 100 }, targets, env, dead, 0.05).aircraft;
    expect(c.engine.rpm).toBe(0);
    // ...and a dive past it gets it turning again.
    for (let i = 0; i < 100; i++) c = stepFlight({ ...c, iasKt: 105, tasKt: 110 }, targets, env, dead, 0.05).aircraft;
    expect(c.engine.rpm).toBeGreaterThan(1000);
  });

  it('runs a healthy engine at idle no slower than its propeller windmills', () => {
    const a = initialSimState().aircraft;
    let idle: AircraftState = { ...a, engine: { ...a.engine, throttle: 0 } };
    for (let i = 0; i < 100; i++) idle = stepFlight(idle, { bankDeg: 0, verticalSpeedFpm: -800 }, env, neutralEffects(env), 0.05).aircraft;
    expect(idle.engine.rpm).toBeGreaterThan(1000);
    expect(idle.engine.fuelFlowGph).toBeGreaterThan(0);
  });
});

describe('saved sessions', () => {
  it('restore blocked tubes and the gyros, and forget the alerts so they are given again', () => {
    const s: SimState = initialSimState();
    const saved: SimState = {
      ...s,
      systems: {
        ...s.systems,
        failures: { ...s.systems.failures, pitot: true, static: true, vacuum: true },
        pitotTrappedInHg: 26.8,
        staticTrappedInHg: 26.3,
        gyroRotor: 0.4,
        vacuumLostAt: 12.5,
        headingIndicatorErrorDeg: 14,
        alerts: [{ key: 'LOW VACUUM', seenAt: 3 }],
      },
    };
    const restored = mergeOver(initialSimState(), JSON.parse(JSON.stringify(saved)));
    expect(restored.systems).toMatchObject({
      failures: { pitot: true, static: true, vacuum: true },
      pitotTrappedInHg: 26.8,
      staticTrappedInHg: 26.3,
      gyroRotor: 0.4,
      vacuumLostAt: 12.5,
      headingIndicatorErrorDeg: 14,
      alerts: [],
    });
  });
});
