/*
 * Smooth, repeatable noise for turbulence, a rough engine and a tumbling
 * gyro: a sum of sines at incommensurate frequencies with seeded phases.
 * The same time and seed always give the same value, so a session replays
 * identically and tests are deterministic, and the signal is smooth enough
 * to feed straight into the flight model without jerks.
 */

/** Frequency multiples (irrational ratios, so the pattern never visibly repeats) and their weights. */
const PARTIALS = [
  { ratio: 1, weight: 1 },
  { ratio: 1.618, weight: 0.7 },
  { ratio: 2.732, weight: 0.5 },
  { ratio: 4.236, weight: 0.35 },
  { ratio: 6.854, weight: 0.25 },
] as const;

const RMS = Math.sqrt(PARTIALS.reduce((sum, p) => sum + (p.weight * p.weight) / 2, 0));

/** A well-mixed hash of an integer to [0, 1). */
export function hash01(n: number): number {
  let h = Math.imul(Math.floor(n) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Zero-mean noise with unit RMS (peaks rarely beyond 2.5) and most of its
 * energy near `baseHz`, as a function of time in seconds.
 */
export function smoothNoise(t: number, baseHz: number, seed: number): number {
  let sum = 0;
  PARTIALS.forEach((p, i) => {
    sum += p.weight * Math.sin(2 * Math.PI * (baseHz * p.ratio * t + hash01(seed * 16 + i)));
  });
  return sum / RMS;
}
