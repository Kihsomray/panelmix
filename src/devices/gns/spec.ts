import type { DeviceSpec } from '../types';

export const gns430Spec: DeviceSpec = {
  id: 'gns430w',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GNS 430W',
  summary: 'The classic GPS/NAV/COM: knob-driven pages, flight plans and direct-to.',
  width: 625,
  height: 265,
  provides: { gps: true, nav: 1, com: 1 },
  load: () => import('./Gns430'),
  help: [],
};

export const gns530Spec: DeviceSpec = {
  id: 'gns530w',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GNS 530W',
  summary: 'The 430W with a larger moving-map screen.',
  width: 625,
  height: 460,
  provides: { gps: true, nav: 1, com: 1 },
  load: () => import('./Gns530'),
  help: [],
};
