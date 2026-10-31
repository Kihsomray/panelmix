/*
 * Rate of change of a value sampled every frame, smoothed so the airspeed
 * trend vector doesn't jitter. Pure: the caller keeps the previous result.
 */

export interface RateFilter {
  readonly value: number;
  readonly time: number;
  /** Units per second. */
  readonly rate: number;
}

/** Longer gaps (a paused tab, a reset) restart the estimate instead of spiking it. */
const MAX_GAP_S = 2;

export function filterRate(prev: RateFilter | null, value: number, time: number, tauS = 1.2): RateFilter {
  if (prev && time === prev.time) return prev;
  if (!prev || time < prev.time || time - prev.time > MAX_GAP_S) return { value, time, rate: 0 };
  const dt = time - prev.time;
  const raw = (value - prev.value) / dt;
  return { value, time, rate: prev.rate + (raw - prev.rate) * Math.min(dt / tauS, 1) };
}
