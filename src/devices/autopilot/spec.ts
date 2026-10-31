import type { DeviceSpec } from '../types';

export const kap140Spec: DeviceSpec = {
  id: 'kap140',
  slot: 'ap',
  maker: 'Bendix/King',
  name: 'KAP 140',
  summary: 'Two-axis autopilot with altitude preselect: AP, HDG, NAV, APR, REV, ALT, UP/DN.',
  width: 630,
  height: 130,
  provides: {},
  load: () => import('./Kap140'),
  help: [],
};

export const gfc500Spec: DeviceSpec = {
  id: 'gfc500',
  slot: 'ap',
  maker: 'Garmin',
  name: 'GFC 500 (GMC 507)',
  summary: 'Garmin GFC 500 autopilot mode controller with flight director, FLC and level mode.',
  width: 625,
  height: 210,
  provides: {},
  load: () => import('./Gfc500'),
  help: [],
};
