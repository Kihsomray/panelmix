import type { SimState } from '../types';
import { smoothNoise } from './noise';

/*
 * What the engine can deliver: full power, a rough engine misfiring at about
 * 60 % with surges and sags every few seconds (a fouled plug, a bad
 * magneto), or nothing (failed, or both tanks dry). The flight model turns
 * this into RPM, a windmilling propeller and the glide.
 */

export interface EngineOutput {
  /** Multiplier on the power the throttle asks for. */
  readonly powerFactor: number;
  readonly running: boolean;
}

const FULL: EngineOutput = { powerFactor: 1, running: true };
const DEAD: EngineOutput = { powerFactor: 0, running: false };

export function engineOutput(state: SimState): EngineOutput {
  const { failures, engineFaultSince } = state.systems;
  const fuel = state.aircraft.engine.fuelGal;
  if (failures.engine === 'failed' || fuel[0] + fuel[1] <= 0) return DEAD;
  if (failures.engine === 'ok') return FULL;
  const t = state.time - (engineFaultSince ?? 0);
  const roughness = 0.1 * smoothNoise(t, 0.2, 501);
  const sag = 0.25 * Math.max(smoothNoise(t, 0.06, 502) - 0.6, 0);
  return { powerFactor: Math.min(Math.max(0.62 + roughness - sag, 0.25), 0.85), running: true };
}
