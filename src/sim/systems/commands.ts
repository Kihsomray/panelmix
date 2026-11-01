import type { SimState } from '../types';
import type { EngineCondition, FailureState, TurbulenceLevel, WindLayer } from './types';

/*
 * Instructor-station commands: failures and weather.
 */

type BooleanFailure = Exclude<keyof FailureState, 'engine'>;

export type SystemsCommand =
  | { type: 'failure.set'; failure: BooleanFailure; failed: boolean }
  | { type: 'failure.engine'; condition: EngineCondition }
  | { type: 'failure.clearAll' }
  | { type: 'weather.windsAloft'; layers: readonly WindLayer[] }
  | { type: 'weather.turbulence'; level: TurbulenceLevel }
  /** Recharge the battery (a new flight, or the alternator came back). */
  | { type: 'systems.chargeBattery' };

export function isSystemsCommand(cmd: { type: string }): cmd is SystemsCommand {
  return cmd.type.startsWith('failure.') || cmd.type.startsWith('weather.') || cmd.type.startsWith('systems.');
}

export function applySystemsCommand(state: SimState, cmd: SystemsCommand): SimState {
  const sys = state.systems;
  switch (cmd.type) {
    case 'failure.set':
      return { ...state, systems: { ...sys, failures: { ...sys.failures, [cmd.failure]: cmd.failed } } };
    case 'failure.engine':
      return {
        ...state,
        systems: {
          ...sys,
          failures: { ...sys.failures, engine: cmd.condition },
          engineFaultSince: cmd.condition === 'ok' ? null : state.time,
        },
      };
    case 'failure.clearAll':
      return {
        ...state,
        systems: {
          ...sys,
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
          engineFaultSince: null,
        },
      };
    case 'weather.windsAloft':
      return {
        ...state,
        systems: { ...sys, weather: { ...sys.weather, windsAloft: [...cmd.layers].sort((a, b) => a.altitudeFt - b.altitudeFt) } },
      };
    case 'weather.turbulence':
      return { ...state, systems: { ...sys, weather: { ...sys.weather, turbulence: cmd.level } } };
    case 'systems.chargeBattery':
      return { ...state, systems: { ...sys, batteryCharge: 1 } };
  }
}
