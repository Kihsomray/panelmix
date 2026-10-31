import type { DeviceSpec } from '../types';

export const gtn650Spec: DeviceSpec = {
  id: 'gtn650xi',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GTN 650Xi',
  summary: 'Touchscreen GPS/NAV/COM with keypad tuning, map and flight planning.',
  width: 625,
  height: 265,
  provides: { gps: true, nav: 1, com: 1, xpdrControl: true },
  load: () => import('./Gtn650'),
  help: [],
};

export const gtn750Spec: DeviceSpec = {
  id: 'gtn750xi',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GTN 750Xi',
  summary: 'Large touchscreen GPS/NAV/COM: home screen, map, flight plan, nearest and transponder.',
  width: 625,
  height: 600,
  provides: { gps: true, nav: 1, com: 1, xpdrControl: true },
  load: () => import('./Gtn750'),
  help: [],
};
