import { useEffect, useRef, useState } from 'preact/hooks';

/*
 * Hooks shared by the transponder and autopilot units (both folders use
 * them). A unit keeps its front-panel state from a pure reducer and redraws
 * on its own clock, about ten times a second, instead of on every
 * simulation frame: its displays change slowly, and the clock keeps start-up
 * screens and readout timeouts running even while the simulation is paused.
 */

/** Calls the latest `fn` every `ms` milliseconds while mounted. */
export function useInterval(fn: () => void, ms: number): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => latest.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export interface UnitState<S> {
  /** The latest state, also inside handlers that run before the next render. */
  readonly get: () => S;
  /** Stores a new state and redraws when it changed. */
  readonly set: (next: S) => void;
  /** Redraws without a state change (time-dependent displays). */
  readonly redraw: () => void;
}

export function useUnitState<S>(init: () => S): UnitState<S> {
  const [box] = useState(() => ({ current: init() }));
  const [, setVersion] = useState(0);
  const redraw = () => setVersion((n) => n + 1);
  return {
    get: () => box.current,
    set: (next) => {
      if (next === box.current) return;
      box.current = next;
      redraw();
    },
    redraw,
  };
}

/** Real time in seconds, the clock for screen transients. */
export const realSeconds = (): number => performance.now() / 1000;
