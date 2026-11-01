import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { AirspaceSource } from '../core/airspace';
import type { MagneticModel } from '../core/magvar';
import type { NavDatabase } from '../core/navdb';
import type { ProcedureSource } from '../core/procedures';
import type { TerrainProvider } from '../core/terrain';
import type { SimCommand } from './commands';
import type { Derived, Simulator } from './simulator';
import type { SimState } from './types';

/*
 * How devices reach the simulator.
 *
 *   const { state, derived, dispatch } = useSim();          // re-renders every frame
 *   const com1 = useSimSelector((s) => s.radios.com[0]);     // re-renders only when it changes
 */

export const SimContext = createContext<Simulator | null>(null);

export function useSimulator(): Simulator {
  const sim = useContext(SimContext);
  if (!sim) throw new Error('useSimulator must be used inside <SimContext.Provider>');
  return sim;
}

export interface SimHandle {
  readonly state: SimState;
  readonly derived: Derived;
  readonly dispatch: (cmd: SimCommand) => void;
  readonly db: NavDatabase;
  readonly mag: MagneticModel;
  readonly terrain: TerrainProvider;
  readonly airspace: AirspaceSource;
  /** Instrument procedures by airport; null when the procedure database isn't available. */
  readonly procedures: ProcedureSource | null;
}

/** The whole live state. The component re-renders on every simulation frame. */
export function useSim(): SimHandle {
  const sim = useSimulator();
  const [, setTick] = useState(0);
  useEffect(() => sim.subscribe(() => setTick((t) => t + 1)), [sim]);
  return {
    state: sim.getState(),
    derived: sim.getDerived(),
    dispatch: sim.dispatch,
    db: sim.db,
    mag: sim.mag,
    terrain: sim.terrain,
    airspace: sim.airspace,
    procedures: sim.procedures,
  };
}

/**
 * A slice of the state. The component re-renders only when the slice changes
 * (by `equal`, default Object.is, or `shallowEqual` for small objects/arrays).
 */
export function useSimSelector<T>(
  select: (state: SimState, derived: Derived) => T,
  equal: (a: T, b: T) => boolean = Object.is,
): T {
  const sim = useSimulator();
  const [, setTick] = useState(0);
  const selectRef = useRef(select);
  selectRef.current = select;
  const valueRef = useRef<T>(select(sim.getState(), sim.getDerived()));
  valueRef.current = select(sim.getState(), sim.getDerived());

  useEffect(
    () =>
      sim.subscribe(() => {
        const next = selectRef.current(sim.getState(), sim.getDerived());
        if (!equal(valueRef.current, next)) {
          valueRef.current = next;
          setTick((t) => t + 1);
        }
      }),
    [sim],
  );
  return valueRef.current;
}

export function useDispatch(): (cmd: SimCommand) => void {
  return useSimulator().dispatch;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
