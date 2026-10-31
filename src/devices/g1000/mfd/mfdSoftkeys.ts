import { sk, softkeyAt, softkeyRow, type SoftkeyRow } from '../shared/softkeys';
import type { PageId } from './mfdPages';

/*
 * MFD softkeys (Figure 1-19 and the page figures of the Pilot's Guide).
 * The top level depends on the page: ENGINE in key 1 and MAP in key 3
 * everywhere, then the page's own keys (DCLTR on the map, ACT LEG on the
 * flight plan, APT/RNWY/FREQ on Nearest Airports...). ENGINE opens the EIS
 * levels (LEAN, SYSTEM, fuel totalizer) and MAP the map overlay keys.
 * Keys for options the trainer cannot do (vertical navigation, along-track
 * offsets, weather) are shown gray.
 */

export type MfdMenu = 'page' | 'map' | 'engine' | 'lean' | 'system' | 'galRem';
export type EisPage = 'engine' | 'lean' | 'system';

export interface MapSettings {
  readonly declutter: 0 | 1 | 2 | 3;
  readonly topo: boolean;
  readonly terrain: boolean;
  readonly traffic: boolean;
  readonly profile: boolean;
  /** AIRWAYS, AIRWY ON, AIRWY LO, AIRWY HI. */
  readonly airways: 0 | 1 | 2 | 3;
}

export interface FuelTotalizer {
  /** Fuel the pilot set as on board, gallons. */
  readonly setGal: number;
  /** What the tanks held when it was set, so the burn since can be subtracted. */
  readonly tanksAtSet: number;
}

export interface MfdKeys {
  readonly menu: MfdMenu;
  readonly eis: EisPage;
  readonly map: MapSettings;
  readonly fuel: FuelTotalizer;
  /** Cylinder shown on the Lean page (CYL SLCT). */
  readonly cylinder: number;
  /** INFO-1 / INFO-2 on the Airport Information page. */
  readonly airportInfo2: boolean;
  /** Wide or narrow flight plan view. */
  readonly fplWide: boolean;
}

/** 172S usable fuel: 53 gal full, 35 gal to the tabs. */
export const FUEL_FULL_GAL = 53;
export const FUEL_TABS_GAL = 35;

export function mfdKeysStart(tanksGal: number): MfdKeys {
  return {
    menu: 'page',
    eis: 'engine',
    map: { declutter: 0, topo: false, terrain: false, traffic: false, profile: false, airways: 0 },
    fuel: { setGal: tanksGal, tanksAtSet: tanksGal },
    cylinder: 1,
    airportInfo2: false,
    fplWide: true,
  };
}

/** Gallons remaining on the totalizer: what was set minus what has burned since. */
export function fuelRemaining(f: FuelTotalizer, tanksNow: number): number {
  return Math.max(f.setGal - (f.tanksAtSet - tanksNow), 0);
}

export function fuelUsed(f: FuelTotalizer, tanksNow: number): number {
  return Math.max(f.tanksAtSet - tanksNow, 0);
}

const DCLTR = ['DCLTR', 'DCLTR-1', 'DCLTR-2', 'DCLTR-3'] as const;
const AIRWAYS = ['AIRWAYS', 'AIRWY ON', 'AIRWY LO', 'AIRWY HI'] as const;

function pageKeys(page: PageId, k: MfdKeys): SoftkeyRow {
  const engine = sk('engine', 'ENGINE');
  const map = sk('map', 'MAP');
  switch (page) {
    case 'navMap':
      return softkeyRow({ 1: engine, 3: map, 10: sk('dcltr', DCLTR[k.map.declutter]), 12: sk('chklist', 'CHKLIST') });
    case 'airportInfo':
      return softkeyRow({
        1: engine,
        3: map,
        5: sk('info', k.airportInfo2 ? 'INFO-2' : 'INFO-1', { on: true }),
        6: sk('dp', 'DP'),
        7: sk('star', 'STAR'),
        8: sk('apr', 'APR'),
        9: sk('wx', 'WX', { disabled: true }),
      });
    case 'tripPlanning':
      return softkeyRow({
        1: engine,
        3: map,
        5: sk('auto', 'AUTO', { on: true }),
        6: sk('manual', 'MANUAL', { disabled: true }),
        8: sk('fplMode', 'FPL', { on: true }),
        9: sk('wpts', 'WPTS', { disabled: true }),
      });
    case 'gpsStatus':
      return softkeyRow({ 1: engine, 4: sk('gps1', 'GPS1', { on: true }), 5: sk('gps2', 'GPS2', { disabled: true }) });
    case 'activeFpl':
      return softkeyRow({
        1: engine,
        3: map,
        4: sk('newWpt', 'NEW WPT', { disabled: true }),
        5: sk('view', 'VIEW', { on: !k.fplWide }),
        6: sk('vnvProf', 'VNV PROF', { disabled: true }),
        7: sk('cnclVnv', 'CNCL VNV', { disabled: true }),
        8: sk('vnvDto', 'VNV ⇨', { disabled: true }),
        9: sk('atkOfst', 'ATK OFST', { disabled: true }),
        10: sk('actLeg', 'ACT LEG'),
        12: sk('chklist', 'CHKLIST'),
      });
    case 'checklist':
      return softkeyRow({ 1: engine, 5: sk('check', 'CHECK'), 6: sk('exit', 'EXIT'), 7: sk('emergcy', 'EMERGCY') });
    case 'nrstAirports':
      return softkeyRow({ 1: engine, 3: map, 5: sk('apt', 'APT'), 6: sk('rnwy', 'RNWY'), 7: sk('freq', 'FREQ'), 8: sk('apr', 'APR', { disabled: true }) });
    case 'nrstVor':
      return softkeyRow({ 1: engine, 3: map, 5: sk('apt', 'VOR'), 6: sk('freq', 'FREQ') });
    case 'nrstNdb':
      return softkeyRow({ 1: engine, 3: map, 5: sk('apt', 'NDB'), 6: sk('freq', 'FREQ') });
    case 'procedures':
    case 'systemStatus':
      return softkeyRow({ 1: engine });
    default:
      return softkeyRow({ 1: engine, 3: map });
  }
}

export function mfdSoftkeys(k: MfdKeys, page: PageId): SoftkeyRow {
  switch (k.menu) {
    case 'page':
      return pageKeys(page, k);
    case 'map':
      return softkeyRow({
        1: sk('traffic', 'TRAFFIC', { on: k.map.traffic }),
        2: sk('profile', 'PROFILE', { on: k.map.profile }),
        3: sk('topo', 'TOPO', { on: k.map.topo }),
        4: sk('terrain', 'TERRAIN', { on: k.map.terrain }),
        5: sk('airways', AIRWAYS[k.map.airways], { on: k.map.airways > 0 }),
        11: sk('back', 'BACK'),
      });
    case 'engine':
      return softkeyRow({ 1: sk('engine', 'ENGINE'), 2: sk('lean', 'LEAN'), 3: sk('system', 'SYSTEM'), 4: sk('back', 'BACK') });
    case 'lean':
      return softkeyRow({
        1: sk('engine', 'ENGINE'),
        2: sk('lean', 'LEAN', { on: true }),
        3: sk('system', 'SYSTEM'),
        4: sk('cylSlct', 'CYL SLCT'),
        5: sk('assist', 'ASSIST'),
        6: sk('back', 'BACK'),
      });
    case 'system':
      return softkeyRow({
        1: sk('engine', 'ENGINE'),
        2: sk('lean', 'LEAN'),
        3: sk('system', 'SYSTEM', { on: true }),
        4: sk('rstFuel', 'RST FUEL'),
        5: sk('galRem', 'GAL REM'),
        6: sk('back', 'BACK'),
      });
    case 'galRem':
      return softkeyRow({
        1: sk('engine', 'ENGINE'),
        2: sk('lean', 'LEAN'),
        3: sk('system', 'SYSTEM', { on: true }),
        4: sk('gal-10', '-10 GAL'),
        5: sk('gal-1', '-1 GAL'),
        6: sk('gal+1', '+1 GAL'),
        7: sk('gal+10', '+10 GAL'),
        8: sk('galTabs', `${FUEL_TABS_GAL} GAL`),
        9: sk('galFull', `${FUEL_FULL_GAL} GAL`),
        10: sk('back', 'BACK'),
      });
  }
}

export interface MfdKeyOutcome {
  readonly keys: MfdKeys;
  /** A page-specific key the display acts on (ACT LEG, APT, RNWY, FREQ, CHECK...). */
  readonly action?: string;
  readonly goTo?: PageId;
}

const ASSIST_CYLINDER = 1;

export function pressMfdSoftkey(k: MfdKeys, index: number, page: PageId, tanksGal: number): MfdKeyOutcome {
  const id = softkeyAt(mfdSoftkeys(k, page), index);
  if (id === null) return { keys: k };
  const map = (patch: Partial<MapSettings>): MfdKeyOutcome => ({ keys: { ...k, map: { ...k.map, ...patch } } });
  const setFuel = (gal: number): MfdKeyOutcome => ({
    keys: { ...k, fuel: { setGal: Math.min(Math.max(gal, 0), FUEL_FULL_GAL), tanksAtSet: tanksGal } },
  });
  const rem = fuelRemaining(k.fuel, tanksGal);
  switch (id) {
    case 'engine':
      return { keys: { ...k, menu: 'engine', eis: 'engine' } };
    case 'lean':
      return { keys: { ...k, menu: 'lean', eis: 'lean' } };
    case 'system':
      return { keys: { ...k, menu: 'system', eis: 'system' } };
    case 'back':
      if (k.menu === 'galRem') return { keys: { ...k, menu: 'system' } };
      return { keys: { ...k, menu: 'page', eis: 'engine' } };
    case 'map':
      return { keys: { ...k, menu: 'map' } };
    case 'cylSlct':
      return { keys: { ...k, cylinder: (k.cylinder % 4) + 1 } };
    case 'assist':
      return { keys: { ...k, cylinder: ASSIST_CYLINDER } };
    case 'rstFuel':
      return setFuel(FUEL_FULL_GAL);
    case 'galRem':
      return { keys: { ...k, menu: 'galRem' } };
    case 'gal-10':
      return setFuel(rem - 10);
    case 'gal-1':
      return setFuel(rem - 1);
    case 'gal+1':
      return setFuel(rem + 1);
    case 'gal+10':
      return setFuel(rem + 10);
    case 'galTabs':
      return setFuel(FUEL_TABS_GAL);
    case 'galFull':
      return setFuel(FUEL_FULL_GAL);
    case 'dcltr':
      return map({ declutter: ((k.map.declutter + 1) % 4) as MapSettings['declutter'] });
    case 'traffic':
      return map({ traffic: !k.map.traffic });
    case 'profile':
      return map({ profile: !k.map.profile });
    case 'topo':
      return map({ topo: !k.map.topo });
    case 'terrain':
      return map({ terrain: !k.map.terrain });
    case 'airways':
      return map({ airways: ((k.map.airways + 1) % 4) as MapSettings['airways'] });
    case 'info':
      return { keys: { ...k, airportInfo2: !k.airportInfo2 }, action: 'info' };
    case 'view':
      return { keys: { ...k, fplWide: !k.fplWide } };
    case 'chklist':
      return { keys: k, goTo: 'checklist' };
  }
  return { keys: k, action: id };
}
