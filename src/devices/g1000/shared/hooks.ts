import { useRef } from 'preact/hooks';
import type { AutopilotState } from '../../../sim/types';

/*
 * Small per-display hooks that watch the simulator between frames.
 */

/** Rate of change of a value per second of sim time, smoothed over about `tau` seconds (trend vectors). */
export function useRate(value: number, time: number, tau = 1): number {
  const r = useRef({ v: value, t: time, rate: 0 });
  const s = r.current;
  const dt = time - s.t;
  if (dt > 0 && dt < 2) {
    const instant = (value - s.v) / dt;
    s.rate += (instant - s.rate) * Math.min(dt / tau, 1);
  }
  if (dt !== 0) {
    s.v = value;
    s.t = time;
  }
  return s.rate;
}

const AP_DISCONNECT_MS = 5000;
const MODE_CHANGE_MS = 10000;

export interface AfcsEvents {
  /** Autopilot just disengaged: AP flashes yellow for 5 s. */
  readonly apDisconnect: boolean;
  /** Selected Altitude Capture completed: the new ALT flashes for 10 s. */
  readonly altCapture: boolean;
  /** Armed NAV captured: the mode moves to the green field and flashes for 10 s. */
  readonly navCapture: boolean;
}

/** AFCS transitions the status box annunciates, seen by comparing frames. */
export function useAfcsEvents(ap: AutopilotState, now: number): AfcsEvents {
  const r = useRef({
    engaged: ap.engaged,
    altArmed: ap.altitudeArmed,
    vertical: ap.vertical,
    navArmed: ap.lateralArmed,
    lateral: ap.lateral,
    discAt: -Infinity,
    altAt: -Infinity,
    navAt: -Infinity,
  });
  const s = r.current;
  if (s.engaged && !ap.engaged) s.discAt = now;
  if (ap.engaged) s.discAt = -Infinity;
  // A capture disarms the mode and makes it active; pressing the mode key directly does not flash.
  if (s.altArmed && !ap.altitudeArmed && ap.vertical === 'ALT' && s.vertical !== 'ALT') s.altAt = now;
  if (s.navArmed && !ap.lateralArmed && ap.lateral === 'NAV' && s.lateral !== 'NAV') s.navAt = now;
  if (ap.lateral !== 'NAV') s.navAt = -Infinity;
  s.engaged = ap.engaged;
  s.altArmed = ap.altitudeArmed;
  s.vertical = ap.vertical;
  s.navArmed = ap.lateralArmed;
  s.lateral = ap.lateral;
  return {
    apDisconnect: now - s.discAt < AP_DISCONNECT_MS,
    altCapture: now - s.altAt < MODE_CHANGE_MS,
    navCapture: now - s.navAt < MODE_CHANGE_MS,
  };
}

/** Two flashes a second for annunciations, from the wall clock. */
export function blinkPhase(now: number): boolean {
  return Math.floor(now / 500) % 2 === 0;
}

/** Local time "hh:mm:ss" for the system time field. */
export function localClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
