import { NO_AIRSPACE, type AirspaceSource } from '../../core/airspace';
import type { MagneticModel } from '../../core/magvar';
import { NO_TERRAIN, type TerrainProvider } from '../../core/terrain';
import { pressureAltitude, staticPressureInHg } from '../atmosphere';
import type { SimState } from '../types';
import { airData, totalPressureInHg } from './airData';
import { heldTerrainLevel, systemAlerts, updateAlerts, type PostedMessage } from './alerts';
import { airspaceAwareness } from './airspaceAwareness';
import { batteryMinutes, ELECTRICAL, electricalSolution, stepBattery } from './electrical';
import { engineOutput } from './engine';
import { assessTerrain, type SystemsField } from './taws';
import type { DisplayStatus, FailureState, FlightEffects, SystemsDerived, SystemsState } from './types';
import { gyroRigidity, stepGyroRotor, stepHeadingIndicatorError, suctionInHg, VACUUM, vacuumAttitude } from './vacuum';
import { gustsAt, windAt } from './weather';

export type { SystemsField } from './taws';

/*
 * The systems model: failures, electrical bus, vacuum gyros, winds aloft,
 * turbulence, terrain and airspace awareness. Called by the simulator every
 * step (`stepSystems`, which advances the battery, the gyros and the alerts
 * and hands the flight model its effects) and once per published state
 * (`computeSystems`, what the instruments indicate). Both are pure: the
 * same state always gives the same answer.
 */

export interface SystemsContext {
  readonly mag: MagneticModel;
  readonly terrain: TerrainProvider;
  readonly airspace: AirspaceSource;
  /** Field elevation of the nearest airport, for the ground where no terrain is loaded. */
  readonly fieldElevationFt: number;
  /** The nearest airport (within about 8 nm): terminal TAWS clearances and the landing inhibit. */
  readonly field?: SystemsField | null;
  /** Indicated altitude and other basics the simulator already computed. */
  readonly indicatedAltitudeFt: number;
  readonly headingMag: number;
  readonly oatC: number;
  /** `computeSystems` of this same state, when the caller already has it (`stepSystems` reuses it). */
  readonly derived?: SystemsDerived;
}

export const DEFAULT_SYSTEMS_CONTEXT = { terrain: NO_TERRAIN, airspace: NO_AIRSPACE } as const;

export const NO_FAILURES: FailureState = {
  vacuum: false,
  pitot: false,
  static: false,
  alternator: false,
  ahrs: false,
  adc: false,
  gps: false,
  engine: 'ok',
  pfdDisplay: false,
  mfdDisplay: false,
};

export function initialSystemsState(): SystemsState {
  return {
    failures: NO_FAILURES,
    weather: { windsAloft: [], turbulence: 0 },
    batteryCharge: 1,
    engineFaultSince: null,
    gyroRotor: 1,
    vacuumLostAt: null,
    headingIndicatorErrorDeg: 0,
    pitotTrappedInHg: null,
    staticTrappedInHg: null,
    alerts: [],
  };
}

export interface SystemsStep {
  readonly systems: SystemsState;
  readonly effects: FlightEffects;
  /** Advisory or caution messages raised this step ("LOW VOLTS", "CAUTION TERRAIN"), each once. */
  readonly messages: readonly PostedMessage[];
}

function displays(f: FailureState): { readonly pfd: DisplayStatus; readonly mfd: DisplayStatus } {
  return {
    pfd: f.pfdDisplay ? 'failed' : f.mfdDisplay ? 'reversionary' : 'normal',
    mfd: f.mfdDisplay ? 'failed' : f.pfdDisplay ? 'reversionary' : 'normal',
  };
}

/** What the instruments indicate, given the failures. */
export function computeSystems(state: SimState, ctx: SystemsContext): SystemsDerived {
  const a = state.aircraft;
  const sys = state.systems;
  const f = sys.failures;
  const elec = electricalSolution(sys.batteryCharge, f.alternator, a.engine.rpm, a.engine.throttle);
  const suction = suctionInHg(f.vacuum, a.engine.rpm);
  const rigidity = gyroRigidity(sys.gyroRotor);
  const ai = vacuumAttitude(a.pitchDeg, a.bankDeg, rigidity, sys.vacuumLostAt, state.time);
  const terrain = assessTerrain(a, ctx.terrain, ctx.field ?? null);
  const ground = terrain.elevationFt ?? ctx.fieldElevationFt;
  const wind = windAt(a.altitudeFt, ground, { fromTrue: state.env.windFromTrue, kt: state.env.windKt }, sys.weather.windsAloft);
  const fuel = a.engine.fuelGal;
  return {
    air: airData(state, ctx.indicatedAltitudeFt, ctx.oatC),
    attitude: {
      valid: !f.ahrs,
      pitchDeg: a.pitchDeg,
      bankDeg: a.bankDeg,
      slip: a.slip,
      turnRateDps: a.turnRateDps,
      headingValid: !f.ahrs,
      headingMag: ctx.headingMag,
    },
    vacuum: {
      suctionInHg: suction,
      rigidity,
      pitchDeg: ai.pitchDeg,
      bankDeg: ai.bankDeg,
      headingErrorDeg: sys.headingIndicatorErrorDeg,
    },
    turnCoordinator: {
      powered: elec.avionicsPowered,
      turnRateDps: elec.avionicsPowered ? a.turnRateDps : 0,
      slip: a.slip,
    },
    electrical: {
      busVolts: elec.busVolts,
      batteryAmps: elec.batteryAmps,
      batteryCharge: sys.batteryCharge,
      avionicsPowered: elec.avionicsPowered,
      alternatorFailed: f.alternator,
      alternatorOnline: elec.alternatorOnline,
      batteryMinutes: elec.alternatorOnline ? null : batteryMinutes(sys.batteryCharge),
    },
    terrain: {
      elevationFt: terrain.elevationFt,
      heightAglFt: terrain.elevationFt === null ? null : a.altitudeFt - terrain.elevationFt,
      alert: heldTerrainLevel(terrain.level, sys.alerts, state.time),
      suppressed: terrain.suppressed,
    },
    airspace: airspaceAwareness(ctx.airspace, a),
    annunciators: {
      lowVolts: elec.busVolts < ELECTRICAL.lowVolts,
      lowVacuum: suction < VACUUM.lowInHg,
      oilPressure: a.engine.oilPressPsi < 20,
      lowFuelL: fuel[0] < 5,
      lowFuelR: fuel[1] < 5,
    },
    displays: displays(f),
    gpsValid: !f.gps && elec.avionicsPowered,
    engineRunning: engineOutput(state).running,
    windFromTrue: wind.fromTrue,
    windKt: wind.kt,
  };
}

/** Advances the systems by `dt` seconds and returns what the flight model needs. */
export function stepSystems(state: SimState, dt: number, ctx: SystemsContext): SystemsStep {
  const a = state.aircraft;
  const sys = state.systems;
  const f = sys.failures;
  const now = state.time;
  const d = ctx.derived ?? computeSystems(state, ctx);

  const batteryCharge = stepBattery(sys.batteryCharge, d.electrical.batteryAmps, dt);

  // The vacuum gyros spin down without suction and back up when it returns.
  const suction = d.vacuum.suctionInHg;
  const gyroRotor = stepGyroRotor(sys.gyroRotor, suction, dt);
  const vacuumLostAt = suction < VACUUM.lowInHg ? sys.vacuumLostAt ?? now : gyroRotor >= 1 ? null : sys.vacuumLostAt;
  const headingIndicatorErrorDeg = stepHeadingIndicatorError(
    sys.headingIndicatorErrorDeg,
    d.vacuum.rigidity,
    a.turnRateDps,
    sys.vacuumLostAt,
    dt,
  );

  // A blocked tube traps the pressure it had when it blocked; clearing the failure opens it.
  const pa = pressureAltitude(a.altitudeFt, state.env.qnhInHg);
  const pitotTrappedInHg = f.pitot ? sys.pitotTrappedInHg ?? totalPressureInHg(pa, a.iasKt) : null;
  const staticTrappedInHg = f.static ? sys.staticTrappedInHg ?? staticPressureInHg(pa) : null;

  // Alerts use the instantaneous terrain picture: the annunciated one includes its own hold.
  const terrainNow = assessTerrain(a, ctx.terrain, ctx.field ?? null).level;
  const { alerts, messages } = updateAlerts(sys.alerts, systemAlerts(state, d, terrainNow), now);

  const engine = engineOutput(state);
  const gusts = gustsAt(sys.weather.turbulence, now);
  const effects: FlightEffects = {
    powerFactor: engine.powerFactor,
    engineRunning: engine.running,
    windFromTrue: d.windFromTrue,
    windKt: d.windKt,
    gustBankDeg: gusts.bankDeg,
    gustVerticalFpm: gusts.verticalFpm,
    gustAirspeedKt: gustsAt(sys.weather.turbulence, now + dt).airspeedKt - gusts.airspeedKt,
    groundElevationFt: d.terrain.elevationFt ?? ctx.fieldElevationFt,
    busVolts: d.electrical.busVolts,
    batteryAmps: d.electrical.batteryAmps,
  };

  const unchanged =
    batteryCharge === sys.batteryCharge &&
    gyroRotor === sys.gyroRotor &&
    vacuumLostAt === sys.vacuumLostAt &&
    headingIndicatorErrorDeg === sys.headingIndicatorErrorDeg &&
    pitotTrappedInHg === sys.pitotTrappedInHg &&
    staticTrappedInHg === sys.staticTrappedInHg &&
    alerts === sys.alerts;
  const systems: SystemsState = unchanged
    ? sys
    : { ...sys, batteryCharge, gyroRotor, vacuumLostAt, headingIndicatorErrorDeg, pitotTrappedInHg, staticTrappedInHg, alerts };
  return { systems, effects, messages };
}
