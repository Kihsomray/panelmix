/*
 * Aspen Evolution colours, matched to the Pilot's Guide photographs: a deep
 * blue sky over red-brown ground, cyan for values the pilot can set (magenta
 * while a knob is editing them), green for navigation data, and the
 * green/dark-blue hot key legends.
 */
export const ASP = {
  skyTop: '#1640a0',
  skyHorizon: '#2d5fc4',
  groundHorizon: '#8e3d22',
  groundBottom: '#5e2414',
  tape: 'rgba(8, 12, 30, 0.42)',
  white: '#ffffff',
  black: '#000000',
  cyan: '#45d6ea',
  magenta: '#ff45ff',
  green: '#47dd3c',
  yellow: '#ffe01a',
  amber: '#ffae1a',
  red: '#ff2d2d',
  gray: '#8b8f96',
  blue: '#3f8cff',
  legendOn: '#4cc23e',
  legendOnText: '#0d1c46',
  legendOff: '#15224a',
  barTop: '#3456a8',
  barBottom: '#1a2c66',
} as const;

/** Screen coordinates are the Aspen's 400 x 760 display pixels. */
export const SCREEN_H = 760;
/** Bottom of the attitude display, then the data bar, then the navigation display. */
export const ATT_BOTTOM = 330;
export const NAV_TOP = 376;
