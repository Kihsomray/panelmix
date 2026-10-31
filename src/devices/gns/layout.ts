import type { GnsKey, Model } from './model/types';

/*
 * Bezel geometry in design px (100 per inch), measured from Garmin's front
 * photos of the GNS 430W (6.25 x 2.65 in) and GNS 530W (6.25 x 4.60 in).
 * The LCDs are 240 x 128 and 320 x 234 pixels; screen content is laid out
 * in those pixels and scaled onto the glass.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface KeyDef extends Rect {
  readonly key: GnsKey;
  readonly label: string;
  readonly aria: string;
}

export interface KnobDef {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly inner?: number;
}

export interface Lcd {
  /** Glass position on the bezel, design px. */
  readonly x: number;
  readonly y: number;
  /** Design px per LCD pixel. */
  readonly scale: number;
  /** LCD resolution. */
  readonly w: number;
  readonly h: number;
  /** Frequency column width and the page area, LCD px. */
  readonly freqW: number;
  readonly main: Rect;
  /** Annunciator row at the bottom. */
  readonly annunY: number;
  /** Where the page-group indicator starts. */
  readonly indicatorX: number;
  /** Annunciator x positions (above the CDI, OBS and MSG keys). */
  readonly annun: { readonly cdi: number; readonly obs: number; readonly msg: number };
}

export interface BezelLayout {
  readonly width: number;
  readonly height: number;
  readonly lcd: Lcd;
  /** The dark recess around the glass (and the key shelf below it). */
  readonly window: Rect;
  readonly shelf: Rect;
  readonly keys: readonly KeyDef[];
  /** RNG rocker: the two halves are separate keys drawn as one. */
  readonly rng: Rect & { readonly vertical: boolean };
  readonly knobs: { readonly comVol: KnobDef; readonly vlocVol: KnobDef; readonly left: KnobDef; readonly right: KnobDef };
  readonly logo: { readonly x: number; readonly y: number };
  readonly modelLabel: { readonly x: number; readonly y: number };
  readonly photocell: { readonly x: number; readonly y: number; readonly r: number };
  /** Data card slots: vertical on the 430W's left edge, horizontal under the 530W's keys. */
  readonly slots: readonly Rect[];
  readonly lockHole: { readonly x: number; readonly y: number; readonly r: number };
  readonly text: {
    readonly comVol: Rect;
    readonly vlocVol: Rect;
    readonly comVloc: Rect;
    readonly defaultNav: Rect;
    readonly gps: Rect;
  };
  /** The printed line from CLR to "DEFAULT NAV": straight down on the 430W, a bracket on the 530W. */
  readonly defaultNavLine: Rect & { readonly bracket: boolean };
}

const bottomKey = (key: GnsKey, label: string, aria: string, x: number, y: number, w: number, h: number): KeyDef => ({
  key,
  label,
  aria,
  x,
  y,
  w,
  h,
});

const GNS430: BezelLayout = {
  width: 625,
  height: 265,
  lcd: {
    x: 160,
    y: 45.5,
    scale: 1.36,
    w: 240,
    h: 128,
    freqW: 56,
    main: { x: 57, y: 0, w: 183, h: 120 },
    annunY: 121,
    indicatorX: 142,
    annun: { cdi: 4, obs: 55, msg: 108 },
  },
  window: { x: 138, y: 11, w: 368, h: 216 },
  shelf: { x: 140, y: 224, w: 366, h: 38 },
  keys: [
    { key: 'COM_FLIP', label: 'C', aria: 'COM flip-flop (hold for 121.5)', x: 100.7, y: 38, w: 39.8, h: 52 },
    { key: 'VLOC_FLIP', label: 'V', aria: 'VLOC flip-flop', x: 100.7, y: 101, w: 39.8, h: 52 },
    { key: 'DTO', label: 'D', aria: 'Direct-to', x: 511.5, y: 65.5, w: 39.5, h: 24.5 },
    { key: 'MENU', label: 'MENU', aria: 'Menu', x: 566, y: 65.5, w: 41, h: 24.5 },
    { key: 'CLR', label: 'CLR', aria: 'Clear (hold for the default NAV page)', x: 511.5, y: 106.5, w: 39.5, h: 24.5 },
    { key: 'ENT', label: 'ENT', aria: 'Enter', x: 566, y: 106.5, w: 41, h: 24.5 },
    bottomKey('CDI', 'CDI', 'CDI source', 163, 235, 39.5, 21.8),
    bottomKey('OBS', 'OBS', 'OBS', 233, 235, 39.5, 21.8),
    bottomKey('MSG', 'MSG', 'Message', 304, 235, 39.5, 21.8),
    bottomKey('FPL', 'FPL', 'Flight plan', 373.6, 235, 39.5, 21.8),
    bottomKey('PROC', 'PROC', 'Procedures', 444, 235, 39.5, 21.8),
  ],
  rng: { x: 511.5, y: 24.6, w: 92.5, h: 27.3, vertical: false },
  knobs: {
    comVol: { x: 53, y: 43.7, size: 33 },
    vlocVol: { x: 53, y: 106.5, size: 33 },
    left: { x: 47.7, y: 215.7, size: 88, inner: 56 },
    right: { x: 575, y: 213, size: 88, inner: 56 },
  },
  logo: { x: 16, y: 9 },
  modelLabel: { x: 604, y: 9.5 },
  photocell: { x: 119, y: 24.6, r: 6.5 },
  slots: [
    { x: 11.7, y: 38, w: 19, h: 110 },
    { x: 74, y: 38, w: 21.4, h: 110 },
  ],
  lockHole: { x: 107, y: 245.7, r: 6.2 },
  text: {
    comVol: { x: 34, y: 60, w: 40, h: 19 },
    vlocVol: { x: 34, y: 123, w: 40, h: 17 },
    comVloc: { x: 74, y: 153, w: 64, h: 25 },
    defaultNav: { x: 507, y: 134, w: 48, h: 32 },
    gps: { x: 576, y: 150, w: 34, h: 12 },
  },
  defaultNavLine: { x: 530.5, y: 131.5, w: 0, h: 8, bracket: false },
};

const GNS530: BezelLayout = {
  width: 625,
  height: 460,
  lcd: {
    x: 113.4,
    y: 40.2,
    scale: 1.297,
    w: 320,
    h: 234,
    freqW: 67,
    main: { x: 68, y: 0, w: 252, h: 220 },
    annunY: 221,
    indicatorX: 167,
    annun: { cdi: 12, obs: 62, msg: 113 },
  },
  window: { x: 100.6, y: 30.4, w: 431.7, h: 323 },
  shelf: { x: 112, y: 362, w: 408, h: 48 },
  keys: [
    { key: 'COM_FLIP', label: 'C', aria: 'COM flip-flop (hold for 121.5)', x: 46.6, y: 41, w: 37.1, h: 40 },
    { key: 'VLOC_FLIP', label: 'V', aria: 'VLOC flip-flop', x: 46.6, y: 145, w: 37.1, h: 40 },
    { key: 'DTO', label: 'D', aria: 'Direct-to', x: 556, y: 153, w: 42.6, h: 25 },
    { key: 'MENU', label: 'MENU', aria: 'Menu', x: 556, y: 193, w: 42.6, h: 27 },
    { key: 'CLR', label: 'CLR', aria: 'Clear (hold for the default NAV page)', x: 556, y: 236, w: 42.6, h: 26.5 },
    { key: 'ENT', label: 'ENT', aria: 'Enter', x: 556, y: 277, w: 42.6, h: 26.6 },
    bottomKey('CDI', 'CDI', 'CDI source', 131.4, 375.7, 40.6, 24),
    bottomKey('OBS', 'OBS', 'OBS', 196, 375.7, 40.6, 24),
    bottomKey('MSG', 'MSG', 'Message', 260.6, 375.7, 40.6, 24),
    bottomKey('FPL', 'FPL', 'Flight plan', 326.3, 375.7, 40.6, 24),
    bottomKey('VNAV', 'VNAV', 'Vertical navigation', 392, 375.7, 40.6, 24),
    bottomKey('PROC', 'PROC', 'Procedures', 457, 375.7, 40.6, 24),
  ],
  rng: { x: 557.8, y: 49, w: 39.2, h: 88, vertical: true },
  knobs: {
    comVol: { x: 47.7, y: 107.8, size: 33 },
    vlocVol: { x: 47.7, y: 212, size: 32 },
    left: { x: 49, y: 405, size: 84, inner: 54 },
    right: { x: 576, y: 405, size: 84, inner: 54 },
  },
  logo: { x: 19, y: 14 },
  modelLabel: { x: 614, y: 20.5 },
  photocell: { x: 554, y: 25, r: 8 },
  slots: [
    { x: 151, y: 417, w: 111, h: 21.6 },
    { x: 367, y: 417, w: 109.7, h: 21.6 },
  ],
  lockHole: { x: 313, y: 428, r: 7.5 },
  text: {
    comVol: { x: 10, y: 126, w: 46, h: 19 },
    vlocVol: { x: 10, y: 232, w: 44, h: 18 },
    comVloc: { x: 17, y: 329, w: 64, h: 24 },
    defaultNav: { x: 566, y: 312, w: 46, h: 22 },
    gps: { x: 543, y: 340, w: 32, h: 13 },
  },
  defaultNavLine: { x: 599.5, y: 249, w: 7, h: 67, bracket: true },
};

export const LAYOUT: Record<Model, BezelLayout> = { '430': GNS430, '530': GNS530 };
