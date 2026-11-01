import { NO_AIRSPACE, type AirspaceSource } from '../../core/airspace';
import type { MagneticModel } from '../../core/magvar';
import { NO_TERRAIN, type TerrainProvider } from '../../core/terrain';
import type { SimState } from '../types';
import type { FlightEffects, SystemsDerived, SystemsState } from './types';

/*
 * The systems model: failures, electrical bus, winds aloft, turbulence,
 * terrain and airspace awareness. Called by the simulator every step
 * (`stepSystems`) and once per published state (`computeSystems`).
 */

export interface SystemsContext {
  readonly mag: MagneticModel;
  readonly terrain: TerrainProvider;
  readonly airspace: AirspaceSource;
  /** Field elevation of the nearest airport, for the ground where no terrain is loaded. */
  readonly fieldElevationFt: number;
  /** Indicated altitude and other basics the simulator already computed. */
  readonly indicatedAltitudeFt: number;
  readonly headingMag: number;
  readonly oatC: number;
}

export const DEFAULT_SYSTEMS_CONTEXT = { terrain: NO_TERRAIN, airspace: NO_AIRSPACE } as const;

export function initialSystemsState(): SystemsState {
  return {
    failures: {
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
    },
    weather: { windsAloft: [], turbulence: 0 },
    batteryCharge: 1,
    engineFaultSince: null,
  };
}

export interface SystemsStep {
  readonly systems: SystemsState;
  readonly effects: FlightEffects;
  /** Advisory or caution messages raised this step ("LOW VOLTS", "TERRAIN"). */
  readonly messages: readonly { readonly text: string; readonly level: 'advisory' | 'caution' }[];
}

/** Advances the systems by `dt` seconds and returns what the flight model needs. */
export function stepSystems(state: SimState, _dt: number, ctx: SystemsContext): SystemsStep {
  return {
    systems: state.systems,
    effects: {
      powerFactor: 1,
      windFromTrue: state.env.windFromTrue,
      windKt: state.env.windKt,
      gustBankDeg: 0,
      gustVerticalFpm: 0,
      gustAirspeedKt: 0,
      groundElevationFt: ctx.terrain.elevationFt(state.aircraft.lat, state.aircraft.lon) ?? ctx.fieldElevationFt,
    },
    messages: [],
  };
}

/** What the instruments indicate, given the failures. */
export function computeSystems(state: SimState, ctx: SystemsContext): SystemsDerived {
  const a = state.aircraft;
  const ground = ctx.terrain.elevationFt(a.lat, a.lon);
  return {
    air: {
      valid: true,
      iasKt: a.iasKt,
      altitudeFt: ctx.indicatedAltitudeFt,
      verticalSpeedFpm: a.verticalSpeedFpm,
      tasKt: a.tasKt,
      oatC: ctx.oatC,
    },
    attitude: {
      valid: true,
      pitchDeg: a.pitchDeg,
      bankDeg: a.bankDeg,
      slip: a.slip,
      turnRateDps: a.turnRateDps,
      headingValid: true,
      headingMag: ctx.headingMag,
    },
    electrical: {
      busVolts: a.engine.volts,
      batteryAmps: 0,
      batteryCharge: state.systems.batteryCharge,
      avionicsPowered: true,
      alternatorFailed: false,
    },
    terrain: { elevationFt: ground, heightAglFt: ground === null ? null : a.altitudeFt - ground, alert: 'none' },
    airspace: { inside: [], ahead: [] },
    gpsValid: true,
    engineRunning: true,
    windFromTrue: state.env.windFromTrue,
    windKt: state.env.windKt,
  };
}
