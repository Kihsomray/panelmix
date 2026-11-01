import { norm360 } from '../../core/geo';
import type { SimState } from '../types';
import { NO_FAILURES } from './index';
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
  | { type: 'systems.chargeBattery' }
  /** The pilot realigns the heading indicator with the compass: clears the error a failing gyro built up. */
  | { type: 'systems.alignHeadingIndicator' };

export function isSystemsCommand(cmd: { type: string }): cmd is SystemsCommand {
  return cmd.type.startsWith('failure.') || cmd.type.startsWith('weather.') || cmd.type.startsWith('systems.');
}

/** Usable layers only (finite, no negative speeds), directions in [0, 360), lowest first. */
function cleanLayers(layers: readonly WindLayer[]): WindLayer[] {
  return layers
    .filter((l) => Number.isFinite(l.altitudeFt) && Number.isFinite(l.fromTrue) && Number.isFinite(l.kt))
    .map((l) => ({ altitudeFt: l.altitudeFt, fromTrue: norm360(l.fromTrue), kt: Math.max(l.kt, 0) }))
    .sort((a, b) => a.altitudeFt - b.altitudeFt);
}

export function applySystemsCommand(state: SimState, cmd: SystemsCommand): SimState {
  const sys = state.systems;
  switch (cmd.type) {
    case 'failure.set':
      if (sys.failures[cmd.failure] === cmd.failed) return state;
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
      // The systems recover on their own: gyros spin back up, blocked tubes open, the battery recharges.
      return { ...state, systems: { ...sys, failures: NO_FAILURES, engineFaultSince: null } };
    case 'weather.windsAloft':
      return { ...state, systems: { ...sys, weather: { ...sys.weather, windsAloft: cleanLayers(cmd.layers) } } };
    case 'weather.turbulence':
      return { ...state, systems: { ...sys, weather: { ...sys.weather, turbulence: cmd.level } } };
    case 'systems.chargeBattery':
      return { ...state, systems: { ...sys, batteryCharge: 1 } };
    case 'systems.alignHeadingIndicator':
      return sys.headingIndicatorErrorDeg === 0 ? state : { ...state, systems: { ...sys, headingIndicatorErrorDeg: 0 } };
  }
}
