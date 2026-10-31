/*
 * GDU 1040 bezel geometry in design px (100 per inch).
 *
 * Measured from the control diagram in the G1000 Pilot's Guide for Cessna
 * Nav III (190-00498-08, Figure 1-3) and scaled to the unit's published
 * size, 11.80 x 7.70 in. The 10.4 in 4:3 display sits between a column of
 * knobs on each side, with the twelve softkeys underneath it.
 */

export const BEZEL_W = 1180;
export const BEZEL_H = 770;

/** The display glass on the bezel. */
export const SCREEN = { x: 159, y: 38, w: 860, h: 645 } as const;

/** Screen content is laid out on the real 1024 x 768 pixel grid and scaled to the glass. */
export const NATIVE_W = 1024;
export const NATIVE_H = 768;
export const NATIVE_SCALE = SCREEN.w / NATIVE_W;

const LEFT_X = 74;
const RIGHT_X = 1101;

export interface KnobSpot {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly inner?: number;
}

export const KNOBS = {
  navVol: { x: LEFT_X, y: 57, size: 37 },
  nav: { x: LEFT_X, y: 178, size: 62, inner: 36 },
  hdg: { x: LEFT_X, y: 312, size: 56 },
  alt: { x: LEFT_X, y: 705, size: 62, inner: 36 },
  comVol: { x: RIGHT_X, y: 57, size: 37 },
  com: { x: RIGHT_X, y: 178, size: 62, inner: 36 },
  crsBaro: { x: RIGHT_X, y: 312, size: 62, inner: 36 },
  range: { x: RIGHT_X, y: 444, size: 42 },
  fms: { x: RIGHT_X, y: 706, size: 62, inner: 36 },
} as const satisfies Record<string, KnobSpot>;

export interface KeySpot {
  /** Center, design px. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

const KEY = { w: 40, h: 25 } as const;
const key = (cx: number, cy: number, w: number = KEY.w, h: number = KEY.h): KeySpot => ({ cx, cy, w, h });

export const KEYS = {
  navSwap: key(104, 104, 38, 24),
  comSwap: key(1070, 104, 38, 24),
  directTo: key(1070, 537),
  menu: key(1130, 537),
  fpl: key(1070, 582),
  proc: key(1130, 582),
  clr: key(1070, 627),
  ent: key(1130, 627),
} as const;

/** GFC 700 mode keys, left column then right column, top to bottom (GDU 1044B only). */
export const AFCS_ROWS = [400, 445, 490, 534, 581, 627] as const;
export const AFCS_COLS = [44, 104] as const;
export const AFCS_KEY = { w: 40, h: 25 } as const;

/** Softkeys sit directly under the twelve label boxes along the bottom of the display. */
export const SOFTKEY = { cy: 719, w: 37, h: 24 } as const;
export const softkeyX = (i: number) => SCREEN.x + ((i + 0.5) * SCREEN.w) / 12;

/** Joystick direction marks printed around the RANGE knob; they pan the map pointer. */
export const PAN_ARROWS = {
  left: { cx: RIGHT_X - 37, cy: 444 },
  right: { cx: RIGHT_X + 37, cy: 444 },
  up: { cx: RIGHT_X, cy: 409 },
  down: { cx: RIGHT_X, cy: 479 },
} as const;
