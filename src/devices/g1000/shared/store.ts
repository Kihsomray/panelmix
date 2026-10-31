import { useEffect, useState } from 'preact/hooks';
import { INITIAL_RADIO_PANEL, type RadioPanel } from './radioPanel';

/*
 * State the two G1000 displays share that the simulator does not hold: the
 * tuning boxes and audio settings (both GDUs show the same radios), and the
 * AFCS details the simulator does not keep (an unavailable-mode flash, VOR
 * approach versus navigation mode), since the mode keys are on both bezels
 * but the AFCS status box is only on the PFD. A tiny store like the knob dock.
 */

export interface AfcsFlash {
  /** Mode text flashed in yellow in the AFCS status box. */
  readonly mode: string;
  readonly until: number;
}

export interface G1000Shared {
  readonly radio: RadioPanel;
  readonly afcsFlash: AfcsFlash | null;
  /** The PFD shows the altimeter setting in hPa, so BARO knobs on either bezel step 1 hPa. */
  readonly baroHpa: boolean;
  /** The NAV mode in use came from the APR key: annunciated VAPP rather than VOR. */
  readonly approach: boolean;
}

let current: G1000Shared = { radio: INITIAL_RADIO_PANEL, afcsFlash: null, baroHpa: false, approach: false };
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

export function getShared(): G1000Shared {
  return current;
}

/**
 * Applies a change. `expiresAt` (ms, performance.now clock) schedules one more
 * notification so a timed readout disappears even while the sim is paused.
 */
export function updateShared(fn: (s: G1000Shared) => G1000Shared, expiresAt?: number): void {
  const next = fn(current);
  if (next === current) return;
  current = next;
  notify();
  if (expiresAt !== undefined) window.setTimeout(notify, Math.max(expiresAt - performance.now(), 0) + 30);
}

/** Re-renders the caller when the shared state changes. */
export function useShared(): G1000Shared {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
