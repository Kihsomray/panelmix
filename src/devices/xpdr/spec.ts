import type { DeviceSpec } from '../types';

export const gtx345Spec: DeviceSpec = {
  id: 'gtx345',
  slot: 'xpdr',
  maker: 'Garmin',
  name: 'GTX 345',
  summary: 'ADS-B Out transponder with a numeric keypad.',
  width: 630,
  height: 165,
  provides: {},
  load: () => import('./Gtx345'),
  help: [],
};

export const kt76aSpec: DeviceSpec = {
  id: 'kt76a',
  slot: 'xpdr',
  maker: 'Bendix/King',
  name: 'KT 76A',
  summary: 'The classic transponder with four code knobs and a mode selector.',
  width: 630,
  height: 170,
  provides: {},
  load: () => import('./Kt76a'),
  help: [],
};
