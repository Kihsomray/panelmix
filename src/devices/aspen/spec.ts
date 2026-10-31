import type { DeviceSpec } from '../types';

export const aspenSpec: DeviceSpec = {
  id: 'aspen-e1000',
  slot: 'pfd',
  maker: 'Aspen',
  name: 'Evolution E1000 PFD',
  summary: 'Aspen Evolution 1000 PFD: attitude and tapes on top, HSI below, with line-select keys.',
  width: 480,
  height: 900,
  provides: {},
  load: () => import('./AspenPfd'),
  help: [],
};
