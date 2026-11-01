import { norm360 } from '../../core/geo';
import type { TurbulenceLevel, WindLayer } from '../../sim/types';

/*
 * Instructor weather: the surface wind, winds aloft at 3,000, 6,000 and
 * 9,000 ft (what a winds aloft forecast gives), turbulence and presets.
 */

export const ALOFT_ALTITUDES = [3000, 6000, 9000] as const;

export const TURBULENCE: readonly { readonly level: TurbulenceLevel; readonly name: string }[] = [
  { level: 0, name: 'None' },
  { level: 1, name: 'Light' },
  { level: 2, name: 'Moderate' },
  { level: 3, name: 'Severe' },
];

export interface Wind {
  readonly fromTrue: number;
  readonly kt: number;
}

export interface AloftRow extends Wind {
  readonly altitudeFt: number;
  /** False when no layer is set at this altitude (the row shows what the airplane would get). */
  readonly set: boolean;
}

/**
 * The three forecast rows from the state's layers. A missing row shows the
 * wind of the nearest layer below it (or the surface), which is what the
 * airplane flies in when the layer isn't set.
 */
export function aloftRows(layers: readonly WindLayer[], surface: Wind): AloftRow[] {
  let below: Wind = surface;
  return ALOFT_ALTITUDES.map((altitudeFt) => {
    const l = layers.find((x) => x.altitudeFt === altitudeFt);
    if (l) below = { fromTrue: l.fromTrue, kt: l.kt };
    return { altitudeFt, fromTrue: below.fromTrue, kt: below.kt, set: !!l };
  });
}

/** All three rows as layers, with one changed: editing any row sets the whole forecast. */
export function withAloft(rows: readonly AloftRow[], altitudeFt: number, wind: Wind): WindLayer[] {
  return rows.map((r) =>
    r.altitudeFt === altitudeFt
      ? { altitudeFt, fromTrue: norm360(Math.round(wind.fromTrue)), kt: clampKt(wind.kt) }
      : { altitudeFt: r.altitudeFt, fromTrue: r.fromTrue, kt: r.kt },
  );
}

export const clampKt = (kt: number) => Math.min(Math.max(Math.round(kt), 0), 150);

export interface WeatherPreset {
  readonly id: string;
  readonly name: string;
  readonly surface: Wind;
  readonly aloft: readonly [Wind, Wind, Wind];
  readonly turbulence: TurbulenceLevel;
}

export const WEATHER_PRESETS: readonly WeatherPreset[] = [
  {
    id: 'calm',
    name: 'Calm',
    surface: { fromTrue: 0, kt: 0 },
    aloft: [
      { fromTrue: 0, kt: 0 },
      { fromTrue: 0, kt: 0 },
      { fromTrue: 0, kt: 0 },
    ],
    turbulence: 0,
  },
  {
    id: 'typical',
    name: 'Typical day',
    surface: { fromTrue: 280, kt: 8 },
    aloft: [
      { fromTrue: 290, kt: 15 },
      { fromTrue: 300, kt: 22 },
      { fromTrue: 300, kt: 28 },
    ],
    turbulence: 1,
  },
  {
    id: 'windy',
    name: 'Strong westerlies',
    surface: { fromTrue: 300, kt: 18 },
    aloft: [
      { fromTrue: 300, kt: 32 },
      { fromTrue: 310, kt: 42 },
      { fromTrue: 300, kt: 50 },
    ],
    turbulence: 2,
  },
];

export function presetLayers(p: WeatherPreset): WindLayer[] {
  return ALOFT_ALTITUDES.map((altitudeFt, i) => ({ altitudeFt, ...p.aloft[i]! }));
}

/**
 * How far off the altimeter reads with the pilot's Kollsman setting, ft:
 * about 1,000 ft per inch, positive when it reads high (setting above the
 * real pressure).
 */
export function altimeterErrorFt(kollsmanInHg: number, actualInHg: number): number {
  return Math.round((kollsmanInHg - actualInHg) * 1000);
}
