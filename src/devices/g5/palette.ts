/*
 * G5 screen colours, matched to the Pilot's Guide screen captures: a lighter
 * sky toward the horizon, brown ground, translucent tapes over the horizon,
 * cyan for pilot-set values, magenta for GPS, green for VHF navigation.
 */
export const G5 = {
  skyTop: '#2f4fb4',
  skyHorizon: '#6f88d2',
  groundHorizon: '#94591c',
  groundBottom: '#5c3a1b',
  tape: 'rgba(0, 0, 24, 0.32)',
  white: '#ffffff',
  black: '#000000',
  cyan: '#28e7ff',
  magenta: '#ff3dff',
  green: '#29e329',
  yellow: '#ffe414',
  olive: '#8c8c14',
  red: '#ff2a2a',
  gray: '#9a9a9a',
  panel: '#1c1d20',
} as const;
