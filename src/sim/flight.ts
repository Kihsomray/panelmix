import { destination, norm360, windTriangle } from '../core/geo';
import { densityRatio, pressureAltitude, trueAirspeed } from './atmosphere';
import type { AircraftState, EngineState, EnvironmentState } from './types';

/*
 * A small energy-based flight model tuned to feel like a Cessna 172S.
 *
 * The autopilot or the pilot commands a bank angle and a vertical speed.
 * Engine power minus the power needed to fly at the current speed gives the
 * specific excess power (Ps). Whatever part of it the commanded climb does
 * not use goes into speed:
 *
 *     dh/dt + (V/g) dV/dt = Ps
 *
 * so climbing too steeply bleeds speed until the airplane stalls, and
 * reducing power in level flight slows it down, the way the real thing does.
 */

export const PERFORMANCE = {
  /** Stall, flaps up, KIAS. */
  vs: 48,
  vy: 74,
  vno: 129,
  vne: 163,
  /** Power-required curve, normalised to max sea-level power: a(V/100)^3 + b(100/V). */
  parasite: 0.447,
  induced: 0.17,
  /** Climb rate per unit of excess power, fpm. */
  climbScale: 1240,
  maxBankDeg: 45,
  rollRateDps: 12,
  /** Vertical-speed response time constant, s. */
  vsLag: 1.2,
} as const;

const G_FTS2 = 32.174;
const KT_TO_FTS = 1.68781;
const FPM_PER_KT = 101.269;

export interface FlightTargets {
  readonly bankDeg: number;
  readonly verticalSpeedFpm: number;
}

/** Power needed for level flight at an equivalent airspeed, as a fraction of max sea-level power. */
export function powerRequired(easKt: number, sigma: number): number {
  const v = Math.max(easKt, 20);
  return (PERFORMANCE.parasite * (v / 100) ** 3 + PERFORMANCE.induced * (100 / v)) / Math.sqrt(sigma);
}

/** Normally aspirated power available (Gagg-Ferrar). */
export function powerAvailable(throttle: number, sigma: number): number {
  return throttle * Math.max((sigma - 0.117) / 0.883, 0);
}

/** Specific excess power: the climb rate available at this speed and power, fpm. */
export function excessPowerFpm(iasKt: number, throttle: number, sigma: number): number {
  return PERFORMANCE.climbScale * (powerAvailable(throttle, sigma) - powerRequired(iasKt, sigma));
}

/** Wing angle of attack for a speed and load factor, degrees. Rough, for the attitude display. */
export function angleOfAttack(iasKt: number, loadFactor: number): number {
  const v = Math.max(iasKt, 30);
  return Math.min(Math.max(-1 + 3 * loadFactor * (100 / v) ** 2, -4), 18);
}

/** Vertical speed that results from holding a pitch attitude at the current speed. */
export function verticalSpeedForPitch(pitchDeg: number, iasKt: number, tasKt: number, bankDeg: number): number {
  const n = 1 / Math.max(Math.cos((bankDeg * Math.PI) / 180), 0.3);
  const gamma = pitchDeg - angleOfAttack(iasKt, n);
  return tasKt * FPM_PER_KT * Math.sin((gamma * Math.PI) / 180);
}

/** Pitch attitude that produces a vertical speed at the current speed. */
export function pitchForVerticalSpeed(vsFpm: number, iasKt: number, tasKt: number, bankDeg: number): number {
  const n = 1 / Math.max(Math.cos((bankDeg * Math.PI) / 180), 0.3);
  const ratio = Math.min(Math.max(vsFpm / Math.max(tasKt * FPM_PER_KT, 1), -1), 1);
  return (Math.asin(ratio) * 180) / Math.PI + angleOfAttack(iasKt, n);
}

const approach = (current: number, target: number, maxStep: number) =>
  current + Math.min(Math.max(target - current, -maxStep), maxStep);

function stepEngine(e: EngineState, iasKt: number, sigma: number, dt: number): EngineState {
  const t = Math.min(Math.max(e.throttle, 0), 1);
  const rpm = 700 + (1600 + 3 * iasKt) * Math.sqrt(t);
  const fuelFlowGph = (1.2 + 9.8 * t ** 1.4) * Math.min(1, 0.4 + 0.6 * sigma);
  const burned = (fuelFlowGph * dt) / 3600;
  // Draw evenly from both tanks (fuel selector BOTH).
  const fuelGal: [number, number] = [Math.max(e.fuelGal[0] - burned / 2, 0), Math.max(e.fuelGal[1] - burned / 2, 0)];
  const lag = Math.min(dt / 30, 1);
  return {
    throttle: t,
    rpm: approach(e.rpm, rpm, 600 * dt),
    fuelFlowGph: approach(e.fuelFlowGph, fuelFlowGph, 4 * dt),
    fuelGal,
    oilPressPsi: approach(e.oilPressPsi, 58 + 18 * t, 5 * dt),
    oilTempF: e.oilTempF + (175 + 35 * t - e.oilTempF) * lag * 0.2,
    egtF: e.egtF + (1080 + 380 * t - e.egtF) * Math.min(dt / 4, 1),
    chtF: e.chtF + (290 + 110 * t - e.chtF) * lag,
    volts: 28 + 0.1 * t,
    amps: approach(e.amps, 3 + 2 * t, dt),
  };
}

export interface FlightStepResult {
  readonly aircraft: AircraftState;
  readonly stalled: boolean;
}

/**
 * Advances the airplane by `dt` seconds toward the commanded bank and vertical
 * speed. `floorFt` is the ground (field elevation) the airplane cannot sink below.
 */
export function stepFlight(
  a: AircraftState,
  targets: FlightTargets,
  env: EnvironmentState,
  dt: number,
  floorFt = 0,
): FlightStepResult {
  const P = PERFORMANCE;
  const pAlt = pressureAltitude(a.altitudeFt, env.qnhInHg);
  const sigma = densityRatio(pAlt, env.isaDeviationC);
  const throttle = a.engine.throttle;

  // Roll toward the commanded bank at a limited rate.
  const bankCmd = Math.min(Math.max(targets.bankDeg, -P.maxBankDeg), P.maxBankDeg);
  const bankDeg = approach(a.bankDeg, bankCmd, P.rollRateDps * dt);
  const rollRate = (bankDeg - a.bankDeg) / Math.max(dt, 1e-6);

  // Below stall speed the nose drops whatever is commanded.
  const stalled = a.iasKt < P.vs;
  let vsCmd = targets.verticalSpeedFpm;
  if (stalled) vsCmd = Math.min(vsCmd, -900 - (P.vs - a.iasKt) * 120);
  const vs = a.verticalSpeedFpm + (vsCmd - a.verticalSpeedFpm) * Math.min(dt / P.vsLag, 1);

  // Energy: excess power not spent climbing changes the speed.
  const ps = excessPowerFpm(a.iasKt, throttle, sigma);
  const tasFts = Math.max(a.tasKt, 25) * KT_TO_FTS;
  const dTasKt = ((((ps - vs) / 60) * G_FTS2) / tasFts / KT_TO_FTS) * dt;
  const tasKt = Math.min(Math.max(a.tasKt + dTasKt, 30), 200);
  const iasKt = tasKt * Math.sqrt(sigma);

  // Turn and wind.
  const turnRateDps = (1091 * Math.tan((bankDeg * Math.PI) / 180)) / Math.max(tasKt, 30);
  const headingTrue = norm360(a.headingTrue + turnRateDps * dt);
  const { trackTrue, groundSpeedKt } = windTriangle(headingTrue, tasKt, env.windFromTrue, env.windKt);
  const pos = destination(a, trackTrue, (groundSpeedKt * dt) / 3600);

  let altitudeFt = a.altitudeFt + (vs * dt) / 60;
  let verticalSpeedFpm = vs;
  if (altitudeFt < floorFt) {
    altitudeFt = floorFt;
    verticalSpeedFpm = Math.max(vs, 0);
  }

  const loadFactor = 1 / Math.max(Math.cos((bankDeg * Math.PI) / 180), 0.3);
  const gamma = (Math.asin(Math.min(Math.max(verticalSpeedFpm / (tasKt * FPM_PER_KT), -1), 1)) * 180) / Math.PI;
  const pitchDeg = gamma + angleOfAttack(iasKt, loadFactor);

  return {
    stalled,
    aircraft: {
      lat: pos.lat,
      lon: pos.lon,
      altitudeFt,
      iasKt,
      tasKt: trueAirspeed(iasKt, sigma),
      groundSpeedKt,
      headingTrue,
      trackTrue,
      pitchDeg,
      bankDeg,
      verticalSpeedFpm,
      turnRateDps,
      // A little adverse yaw while rolling, as with an autopilot that has no rudder.
      slip: Math.min(Math.max(-rollRate * 0.025, -0.35), 0.35),
      engine: stepEngine(a.engine, iasKt, sigma, dt),
    },
  };
}
