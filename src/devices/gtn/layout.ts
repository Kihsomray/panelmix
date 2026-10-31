import type { Model } from './model';

/*
 * Bezel and screen geometry, design px at 100 per inch. Measured from Garmin's
 * pilot's guide figures and product photos: the 750Xi bezel is 6.25 x 6.00 in
 * with a portrait 600 x 708 display, the 650Xi 6.25 x 2.65 in with a wide
 * display. Both put the volume/squelch knob top left, the SD card slot below
 * it, the photocell top right, HOME and Direct-To keys down the right edge and
 * the dual concentric knob bottom right, over a finger ledge under the glass.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BezelLayout {
  readonly width: number;
  readonly height: number;
  readonly glass: Rect;
  readonly screen: Rect;
  readonly ledge: Rect;
  readonly sdSlot: Rect;
  readonly logoY: number;
  readonly volume: { readonly x: number; readonly y: number; readonly size: number };
  readonly photocell: { readonly x: number; readonly y: number };
  readonly home: Rect;
  readonly direct: Rect;
  readonly knob: { readonly x: number; readonly y: number; readonly size: number; readonly inner: number };
  /** Raised hand-rest strips along the sides (750Xi). */
  readonly grips: readonly Rect[];
}

export const BEZEL: Record<Model, BezelLayout> = {
  '750': {
    width: 625,
    height: 600,
    glass: { x: 51, y: 4, w: 514, h: 566 },
    screen: { x: 75, y: 24, w: 458, h: 542 },
    ledge: { x: 92, y: 573, w: 452, h: 22 },
    sdSlot: { x: 20, y: 104, w: 13, h: 78 },
    logoY: 14,
    volume: { x: 27, y: 28, size: 36 },
    photocell: { x: 592, y: 27 },
    home: { x: 572, y: 410, w: 40, h: 24 },
    direct: { x: 572, y: 464, w: 40, h: 24 },
    knob: { x: 590, y: 553, size: 60, inner: 34 },
    grips: [
      { x: 6, y: 250, w: 38, h: 300 },
      { x: 570, y: 80, w: 44, h: 300 },
    ],
  },
  '650': {
    width: 625,
    height: 265,
    glass: { x: 79, y: 6, w: 466, h: 229 },
    screen: { x: 86, y: 28, w: 448, h: 202 },
    ledge: { x: 100, y: 239, w: 425, h: 21 },
    sdSlot: { x: 24, y: 100, w: 12, h: 70 },
    logoY: 17,
    volume: { x: 29, y: 29, size: 36 },
    photocell: { x: 588, y: 27 },
    home: { x: 568, y: 80, w: 40, h: 24 },
    direct: { x: 568, y: 132, w: 40, h: 24 },
    knob: { x: 590, y: 220, size: 58, inner: 33 },
    grips: [],
  },
};

/** Screen regions, in screen coordinates. */
export interface ScreenLayout {
  /** Where pages draw. */
  readonly content: Rect;
  readonly annunciator: Rect;
}

export const SCREEN: Record<Model, ScreenLayout> = {
  // Top radio bar 82 high, control bar of keys above a thin annunciator bar.
  '750': {
    content: { x: 0, y: 84, w: 458, h: 384 },
    annunciator: { x: 0, y: 529, w: 458, h: 13 },
  },
  // Key column left, radio column right, annunciator bar along the bottom.
  '650': {
    content: { x: 53, y: 0, w: 302, h: 186 },
    annunciator: { x: 0, y: 188, w: 448, h: 14 },
  },
};

/** 750Xi control bar (Back, MSG, Menu, CDI, OBS, In, Out). */
export const CONTROL_BAR_750: Rect = { x: 0, y: 470, w: 458, h: 57 };

/** 650Xi side columns. */
export const LEFT_COLUMN_650: Rect = { x: 0, y: 0, w: 51, h: 186 };
export const RIGHT_COLUMN_650: Rect = { x: 357, y: 0, w: 91, h: 186 };
