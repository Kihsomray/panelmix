import type { DeviceSpec } from '../types';

export const g5Spec: DeviceSpec = {
  id: 'g5',
  slot: 'pfd',
  maker: 'Garmin',
  name: 'G5 (attitude + HSI)',
  summary: 'Two Garmin G5 units: electronic attitude indicator on top, HSI below.',
  width: 360,
  height: 760,
  provides: {},
  load: () => import('./G5Pair'),
  help: [],
};
