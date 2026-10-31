import type { DeviceSpec } from '../types';

export const g1000PfdSpec: DeviceSpec = {
  id: 'g1000-pfd',
  slot: 'pfd',
  maker: 'Garmin',
  name: 'G1000 PFD',
  summary: 'Garmin G1000 primary flight display (GDU 1040). Pairs with the G1000 MFD.',
  width: 1340,
  height: 920,
  requires: { nav: ['g1000-mfd'], xpdr: ['integrated'] },
  provides: { xpdrControl: true },
  load: () => import('./G1000Pfd'),
  help: [],
};

export const g1000MfdSpec: DeviceSpec = {
  id: 'g1000-mfd',
  slot: 'nav',
  maker: 'Garmin',
  name: 'G1000 MFD',
  summary: 'Garmin G1000 multi-function display with engine indication, moving map and flight planning.',
  width: 1340,
  height: 920,
  requires: { pfd: ['g1000-pfd'], xpdr: ['integrated'] },
  provides: { gps: true, nav: 2, com: 2, autopilot: true },
  load: () => import('./G1000Mfd'),
  help: [],
};
