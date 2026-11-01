import { norm360, toDeg, toRad } from '../../core/geo';
import { smoothNoise } from './noise';
import type { TurbulenceLevel, WindLayer } from './types';

/*
 * Winds aloft and turbulence.
 *
 * The wind at the airplane is interpolated between the surface wind (at the
 * ground below) and the winds aloft layers, as vectors, so a layer of calm
 * or a reversal between two layers comes out physically (the wind dies out
 * in between) instead of swinging the direction around. Above the highest
 * layer its wind holds.
 *
 * Turbulence is smooth noise on bank, vertical speed and airspeed, coming
 * and going in patches. Light barely moves the needles; moderate takes work
 * to hold altitude; severe throws the airplane around.
 */

export interface Wind {
  readonly fromTrue: number;
  readonly kt: number;
}

function blend(a: Wind, b: Wind, t: number): Wind {
  const k = Math.min(Math.max(t, 0), 1);
  const ax = a.kt * Math.sin(toRad(a.fromTrue));
  const ay = a.kt * Math.cos(toRad(a.fromTrue));
  const x = ax + (b.kt * Math.sin(toRad(b.fromTrue)) - ax) * k;
  const y = ay + (b.kt * Math.cos(toRad(b.fromTrue)) - ay) * k;
  const kt = Math.hypot(x, y);
  if (kt < 0.05) return { fromTrue: k < 0.5 ? a.fromTrue : b.fromTrue, kt: 0 };
  return { fromTrue: norm360(toDeg(Math.atan2(x, y))), kt };
}

/** The wind at `altitudeFt` over ground at `groundFt`. Layers at or below the ground don't apply. */
export function windAt(altitudeFt: number, groundFt: number, surface: Wind, layers: readonly WindLayer[]): Wind {
  const sorted = layers.every((l, i) => i === 0 || layers[i - 1]!.altitudeFt <= l.altitudeFt)
    ? layers
    : [...layers].sort((p, q) => p.altitudeFt - q.altitudeFt);
  let lowerAlt = groundFt;
  let lower: Wind = surface;
  for (const layer of sorted) {
    if (layer.altitudeFt <= groundFt) continue;
    if (altitudeFt <= layer.altitudeFt) return blend(lower, layer, (altitudeFt - lowerAlt) / (layer.altitudeFt - lowerAlt));
    lowerAlt = layer.altitudeFt;
    lower = layer;
  }
  return { fromTrue: lower.fromTrue, kt: lower.kt };
}

/** RMS disturbance per turbulence level (none, light, moderate, severe), before the flight model's own lags. */
export const TURBULENCE = {
  bankDeg: [0, 1.2, 3.5, 12],
  verticalFpm: [0, 90, 380, 1200],
  airspeedKt: [0, 1, 2.5, 7],
} as const;

export interface Gusts {
  readonly bankDeg: number;
  readonly verticalFpm: number;
  readonly airspeedKt: number;
}

const CALM: Gusts = { bankDeg: 0, verticalFpm: 0, airspeedKt: 0 };

/** Turbulence disturbances at sim time `time`: the same time always gives the same gusts. */
export function gustsAt(level: TurbulenceLevel, time: number): Gusts {
  if (level === 0) return CALM;
  // Patches: the intensity swells and eases over about 40 seconds.
  const patch = 0.75 + 0.25 * Math.sin((2 * Math.PI * time) / 41 + 1.3);
  return {
    bankDeg: TURBULENCE.bankDeg[level] * patch * smoothNoise(time, 0.05, 101),
    verticalFpm: TURBULENCE.verticalFpm[level] * patch * smoothNoise(time, 0.04, 202),
    airspeedKt: TURBULENCE.airspeedKt[level] * patch * smoothNoise(time, 0.04, 303),
  };
}
