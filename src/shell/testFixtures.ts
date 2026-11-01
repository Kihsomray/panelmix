import { readFileSync } from 'node:fs';
import { MagneticModel, type MagvarGrid } from '../core/magvar';
import { NavDatabase, type RawNavdata, type Waypoint } from '../core/navdb';
import type { AirportProcedures, Approach, ProcFix, ProcedureSource } from '../core/procedures';
import type { PanelInfo } from '../devices/types';
import { initialSimState } from '../sim/defaults';
import { Simulator, type Derived } from '../sim/simulator';
import type { SimState } from '../sim/types';
import type { MagConverter } from './instructor/scenario';
import type { LiveInput } from './lessons/runner';

/*
 * Hand-built fixtures for the shell tests: the KJYO RNAV 17 and ILS 17 as
 * the CIFP publishes them (coordinates, altitudes and courses copied from
 * the FAA records), a constant-variation magnetic model, and live inputs
 * built from hand-made states. Imported only by tests.
 */

const fix = (ident: string, lat: number, lon: number, kind: ProcFix['kind'] = 'fix'): ProcFix => ({ ident, lat, lon, kind });

export const FIX = {
  MRB: fix('MRB', 39.38557, -77.84836, 'vor'),
  CACAS: fix('CACAS', 39.27896, -77.64509),
  DANMO: fix('DANMO', 39.16835, -77.59682),
  CEYAC: fix('CEYAC', 39.12778, -77.57916),
  RW17: fix('RW17', 39.08512, -77.56061, 'runway'),
  KORNY: fix('KORNY', 39.22891, -77.83396),
  STILL: fix('STILL', 39.26474, -77.63887),
  JOTUP: fix('JOTUP', 39.22051, -77.61956),
  GAWDD: fix('GAWDD', 39.23516, -77.73923),
} as const;

export const RNAV17: Approach = {
  id: 'R17',
  type: 'RNAV',
  name: 'RNAV (GPS) RWY 17',
  runway: '17',
  minima: ['LPV', 'LNAV/VNAV', 'LNAV'],
  transitions: [
    { name: 'CACAS', legs: [{ path: 'HF', fix: FIX.CACAS, turn: 'R', courseMag: 171.2, distanceNm: 4, altitude: { kind: 'atOrAbove', ft: 3000 }, iaf: true }] },
    {
      name: 'MRB',
      legs: [
        { path: 'IF', fix: FIX.MRB, iaf: true },
        { path: 'TF', fix: FIX.CACAS, altitude: { kind: 'atOrAbove', ft: 3000 } },
      ],
    },
  ],
  final: [
    { path: 'IF', fix: FIX.CACAS, altitude: { kind: 'atOrAbove', ft: 3000 }, if: true },
    { path: 'TF', fix: FIX.DANMO, altitude: { kind: 'atOrAbove', ft: 2100 }, faf: true },
    { path: 'TF', fix: FIX.CEYAC, altitude: { kind: 'atOrAbove', ft: 1280 } },
    { path: 'TF', fix: FIX.RW17, altitude: { kind: 'at', ft: 422 }, map: true },
  ],
  missed: [
    { path: 'CA', courseMag: 171.3, altitude: { kind: 'atOrAbove', ft: 1100 } },
    { path: 'DF', fix: FIX.KORNY, turn: 'R', altitude: { kind: 'atOrAbove', ft: 4000 }, flyover: true },
    { path: 'HM', fix: FIX.KORNY, turn: 'R', courseMag: 81.1, distanceNm: 4, altitude: { kind: 'atOrAbove', ft: 4000 } },
  ],
  path: { thresholdLat: 39.08512, thresholdLon: -77.56061, thresholdElevationFt: 378, tchFt: 44.8, angleDeg: 3, courseMag: 171.4 },
};

export const ILS17: Approach = {
  id: 'I17',
  type: 'ILS',
  name: 'ILS RWY 17',
  runway: '17',
  minima: [],
  localizer: 'IJYO',
  transitions: [
    {
      name: 'MRB',
      legs: [
        { path: 'FC', fix: FIX.MRB, courseMag: 133.5, altitude: { kind: 'atOrAbove', ft: 3000 } },
        { path: 'CF', fix: FIX.STILL, courseMag: 133.5, altitude: { kind: 'atOrAbove', ft: 3000 } },
      ],
    },
  ],
  final: [
    { path: 'IF', fix: FIX.STILL, altitude: { kind: 'atOrAbove', ft: 3000 }, if: true },
    { path: 'CF', fix: FIX.JOTUP, courseMag: 171, altitude: { kind: 'atOrAbove', ft: 2500 } },
    { path: 'CF', fix: FIX.DANMO, courseMag: 171, altitude: { kind: 'glideslope', ft: 2100 }, faf: true },
    { path: 'CF', fix: FIX.RW17, courseMag: 171, altitude: { kind: 'at', ft: 422 }, map: true },
  ],
  missed: [
    { path: 'CA', courseMag: 171.3, altitude: { kind: 'atOrAbove', ft: 1200 } },
    { path: 'VI', courseMag: 340, turn: 'R' },
    { path: 'CF', fix: FIX.GAWDD, courseMag: 337.6, distanceNm: 16, altitude: { kind: 'atOrAbove', ft: 4000 } },
    { path: 'HM', fix: FIX.GAWDD, courseMag: 157.6, turn: 'R', legTimeMin: 1, altitude: { kind: 'atOrAbove', ft: 4000 } },
  ],
  path: { thresholdLat: 39.08512, thresholdLon: -77.56061, thresholdElevationFt: 378, tchFt: 45, angleDeg: 3, courseMag: 171.3 },
};

export const KJYO_PROCS: AirportProcedures = {
  v: 1,
  airport: 'KJYO',
  cycle: '2611',
  runways: [{ ident: '17', lat: 39.08512, lon: -77.56061, elevationFt: 378, tchFt: 45, courseMag: 171, lengthFt: 5500 }],
  approaches: [ILS17, RNAV17],
  departures: [],
  arrivals: [],
};

/** A procedure source that already has KJYO loaded. */
export const KJYO_SOURCE: ProcedureSource = {
  cycle: '2611',
  has: (a) => a === 'KJYO',
  get: (a) => (a === 'KJYO' ? KJYO_PROCS : null),
  load: (a) => Promise.resolve(a === 'KJYO' ? KJYO_PROCS : null),
  subscribe: () => () => {},
};

export const KJYO_WP: Waypoint = { kind: 'airport', ident: 'KJYO', name: 'Leesburg Executive Airport', lat: 39.078, lon: -77.5575 };

/** Variation fixed at the KJYO value (about 10.5 degrees west), so expected numbers are easy to write. */
export function constantMag(variation = -10.5): MagConverter {
  const n = (d: number) => ((d % 360) + 360) % 360;
  return { toTrue: (m) => n(m + variation), toMagnetic: (t) => n(t - variation) };
}

// The real database and magnetic model, for checks that read Derived.
let cached: { db: NavDatabase; mag: MagneticModel } | null = null;
export function navData(): { db: NavDatabase; mag: MagneticModel } {
  cached ??= {
    db: new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata),
    mag: new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid),
  };
  return cached;
}

export const G5_PANEL: PanelInfo = { pfd: 'g5', nav: 'gns430w', xpdr: 'gtx345', ap: 'gfc500', cdiSources: ['GPS', 'NAV1'] };
export const STEAM_PANEL: PanelInfo = { pfd: 'steam', nav: 'gns430w', xpdr: 'kt76a', ap: 'kap140', cdiSources: ['GPS', 'NAV1'] };
export const G1000_PANEL: PanelInfo = { pfd: 'g1000-pfd', nav: 'g1000-mfd', xpdr: 'integrated', ap: 'integrated', cdiSources: ['GPS', 'NAV1', 'NAV2'] };
export const GTN_PANEL: PanelInfo = { pfd: 'aspen-e1000', nav: 'gtn750xi', xpdr: 'integrated', ap: 'none', cdiSources: ['GPS', 'NAV1'] };

/** A state built from the session defaults with `patch` applied to its top-level parts. */
export function stateWith(patch: (s: SimState) => SimState = (s) => s): SimState {
  return patch(initialSimState());
}

/**
 * What a check sees for a hand-built state: the simulator's own derived
 * values for it, with `derived` overrides for parts other builders fill in
 * (the approach annunciation, the vertical path).
 */
export function live(state: SimState, derived: Partial<Derived> = {}, panel: PanelInfo = G5_PANEL): LiveInput {
  const { db, mag } = navData();
  return { state, derived: { ...new Simulator(db, mag, state).getDerived(), ...derived }, panel };
}
