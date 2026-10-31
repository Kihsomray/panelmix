import type { Radio, SimCommand } from '../../../sim/commands';
import type { BearingSource, CdiSource, TransponderMode } from '../../../sim/types';
import { sk, softkeyAt, softkeyRow, type AlertLevel, type SoftkeyRow } from '../shared/softkeys';
import { codeBackspace, codeDigit, startCode, type CodeEntry } from '../shared/xpdrCode';

/*
 * PFD softkeys, following the flowcharts in the Pilot's Guide (Figures
 * 1-15 to 1-18). Pure: a press returns the next softkey state plus the
 * simulator commands and window changes it causes.
 *
 * Top level: INSET, PFD, OBS, CDI, DME, XPDR, IDENT, TMR/REF, NRST, ALERTS
 * (keys 2, 4-12). Every sub-level has BACK in key 11 and ALERTS in key 12.
 * The optional SYN VIS, WX LGND, STRMSCP, NEXRAD, XM LTNG and METAR keys
 * belong to equipment this 172S does not have, so their slots are empty.
 */

export type PfdMenu = 'root' | 'inset' | 'pfd' | 'wind' | 'hsiFrmt' | 'altUnit' | 'xpdr' | 'code';
/** 0 = wind window off, otherwise OPTN 1-3. */
export type WindOption = 0 | 1 | 2 | 3;
export type PfdWindowKind = 'nrst' | 'tmrRef' | 'alerts' | 'dme';

export interface PfdSettings {
  readonly inset: boolean;
  readonly insetDeclutter: 0 | 1 | 2 | 3;
  readonly insetTraffic: boolean;
  readonly insetTopo: boolean;
  readonly insetTerrain: boolean;
  readonly wind: WindOption;
  readonly hsiArc: boolean;
  readonly dmeWindow: boolean;
  readonly altMeters: boolean;
  readonly baroHpa: boolean;
  /** Bearing pointer set to ADF. The trainer has no ADF receiver, so the window shows ADF without data. */
  readonly adf: readonly [boolean, boolean];
}

/** What DFLTS restores: inset map, wind and metric displays off (Pilot's Guide 2.1). */
export const PFD_DEFAULTS: PfdSettings = {
  inset: false,
  insetDeclutter: 0,
  insetTraffic: false,
  insetTopo: false,
  insetTerrain: false,
  wind: 0,
  hsiArc: false,
  dmeWindow: false,
  altMeters: false,
  baroHpa: false,
  adf: [false, false],
};

/** The session starts with the inset map and the wind window shown, as most pilots fly. */
export const PFD_START: PfdSettings = { ...PFD_DEFAULTS, inset: true, wind: 1 };

export interface PfdKeys {
  readonly menu: PfdMenu;
  readonly settings: PfdSettings;
  /** Transponder code being entered. */
  readonly code: CodeEntry | null;
}

export const PFD_KEYS_START: PfdKeys = { menu: 'root', settings: PFD_START, code: null };

export interface PfdKeyContext {
  readonly xpdrMode: TransponderMode;
  readonly bearing1: BearingSource;
  readonly bearing2: BearingSource;
  readonly cdiSource: CdiSource;
  readonly cdiSources: readonly CdiSource[];
  /** GPS is the CDI source and a leg is active. */
  readonly obsAvailable: boolean;
  readonly obsMode: boolean;
  readonly baroStd: boolean;
  /** Highest unacknowledged alert level. */
  readonly alert: AlertLevel | null;
  /** Wall clock, ms (code entry timing). */
  readonly now: number;
}

export interface PfdKeyOutcome {
  readonly keys: PfdKeys;
  readonly commands: readonly SimCommand[];
  /** Window to open or close. */
  readonly toggleWindow?: PfdWindowKind;
  /** The NAV tuning box follows the CDI to the NAV radio it selects. */
  readonly tuneNav?: Radio;
}

export type BearingChoice = 'OFF' | 'NAV1' | 'NAV2' | 'GPS' | 'ADF';

export function bearingChoice(pointer: 1 | 2, sim: BearingSource, s: PfdSettings): BearingChoice {
  return s.adf[pointer - 1] ? 'ADF' : sim;
}

/** BRG1 cycles NAV1, GPS, ADF, off; BRG2 the same with NAV2. */
export function nextBearing(pointer: 1 | 2, current: BearingChoice): BearingChoice {
  const order: BearingChoice[] = ['OFF', pointer === 1 ? 'NAV1' : 'NAV2', 'GPS', 'ADF'];
  return order[(order.indexOf(current) + 1) % order.length] ?? 'OFF';
}

const DCLTR_LABELS = ['DCLTR', 'DCLTR-1', 'DCLTR-2', 'DCLTR-3'] as const;

export function pfdSoftkeys(k: PfdKeys, ctx: PfdKeyContext): SoftkeyRow {
  const s = k.settings;
  const alerts = ctx.alert
    ? { id: 'alerts', label: ctx.alert.toUpperCase(), alert: ctx.alert }
    : sk('alerts', 'ALERTS');
  const back = sk('back', 'BACK');
  switch (k.menu) {
    case 'root':
      return softkeyRow({
        2: sk('inset', 'INSET'),
        4: sk('pfd', 'PFD'),
        5: sk('obs', 'OBS', { on: ctx.obsMode, disabled: !ctx.obsAvailable && !ctx.obsMode }),
        6: sk('cdi', 'CDI'),
        7: sk('dmeTune', 'DME'),
        8: sk('xpdr', 'XPDR'),
        9: sk('ident', 'IDENT'),
        10: sk('tmrRef', 'TMR/REF'),
        11: sk('nrst', 'NRST'),
        12: alerts,
      });
    case 'inset':
      return softkeyRow({
        1: sk('insetOff', 'OFF'),
        2: sk('dcltr', DCLTR_LABELS[s.insetDeclutter]),
        4: sk('traffic', 'TRAFFIC', { on: s.insetTraffic }),
        5: sk('topo', 'TOPO', { on: s.insetTopo }),
        6: sk('terrain', 'TERRAIN', { on: s.insetTerrain }),
        11: back,
        12: alerts,
      });
    case 'pfd':
      return softkeyRow({
        2: sk('dflts', 'DFLTS'),
        3: sk('wind', 'WIND'),
        4: sk('dmeWindow', 'DME', { on: s.dmeWindow }),
        5: sk('brg1', 'BRG1', { on: bearingChoice(1, ctx.bearing1, s) !== 'OFF', disabled: s.hsiArc }),
        6: sk('hsiFrmt', 'HSI FRMT'),
        7: sk('brg2', 'BRG2', { on: bearingChoice(2, ctx.bearing2, s) !== 'OFF', disabled: s.hsiArc }),
        9: sk('altUnit', 'ALT UNIT'),
        10: sk('stdBaro', 'STD BARO', { on: ctx.baroStd }),
        11: back,
        12: alerts,
      });
    case 'wind':
      return softkeyRow({
        3: sk('optn1', 'OPTN 1', { on: s.wind === 1 }),
        4: sk('optn2', 'OPTN 2', { on: s.wind === 2 }),
        5: sk('optn3', 'OPTN 3', { on: s.wind === 3 }),
        6: sk('windOff', 'OFF', { on: s.wind === 0 }),
        11: back,
        12: alerts,
      });
    case 'hsiFrmt':
      return softkeyRow({
        6: sk('hsi360', '360 HSI', { on: !s.hsiArc }),
        7: sk('hsiArc', 'ARC HSI', { on: s.hsiArc }),
        11: back,
        12: alerts,
      });
    case 'altUnit':
      return softkeyRow({
        6: sk('meters', 'METERS', { on: s.altMeters }),
        8: sk('inHg', 'IN', { on: !s.baroHpa }),
        9: sk('hpa', 'HPA', { on: s.baroHpa }),
        11: back,
        12: alerts,
      });
    case 'xpdr':
      return softkeyRow({
        3: sk('stby', 'STBY', { on: ctx.xpdrMode === 'STBY' }),
        4: sk('on', 'ON', { on: ctx.xpdrMode === 'ON' }),
        5: sk('alt', 'ALT', { on: ctx.xpdrMode === 'ALT' }),
        6: sk('gnd', 'GND', { on: ctx.xpdrMode === 'GND' }),
        7: sk('vfr', 'VFR'),
        8: sk('code', 'CODE'),
        9: sk('ident', 'IDENT'),
        11: back,
        12: alerts,
      });
    case 'code': {
      const digits: Record<number, ReturnType<typeof sk>> = {};
      for (let d = 0; d <= 7; d++) digits[d + 1] = sk(`digit${d}`, String(d));
      return softkeyRow({ ...digits, 9: sk('ident', 'IDENT'), 10: sk('bksp', 'BKSP'), 11: back, 12: alerts });
    }
  }
}

const PARENT: Record<PfdMenu, PfdMenu> = {
  root: 'root',
  inset: 'root',
  pfd: 'root',
  xpdr: 'root',
  wind: 'pfd',
  hsiFrmt: 'pfd',
  altUnit: 'pfd',
  code: 'xpdr',
};

export function pressPfdSoftkey(k: PfdKeys, index: number, ctx: PfdKeyContext): PfdKeyOutcome {
  const id = softkeyAt(pfdSoftkeys(k, ctx), index);
  const s = k.settings;
  const none: PfdKeyOutcome = { keys: k, commands: [] };
  const go = (menu: PfdMenu, patch: Partial<PfdKeys> = {}): PfdKeyOutcome => ({ keys: { ...k, ...patch, menu }, commands: [] });
  const set = (patch: Partial<PfdSettings>, commands: SimCommand[] = []): PfdKeyOutcome => ({
    keys: { ...k, settings: { ...s, ...patch } },
    commands,
  });
  const bearing = (pointer: 1 | 2): PfdKeyOutcome => {
    const next = nextBearing(pointer, bearingChoice(pointer, pointer === 1 ? ctx.bearing1 : ctx.bearing2, s));
    const adf: [boolean, boolean] = [...s.adf];
    adf[pointer - 1] = next === 'ADF';
    return set({ adf }, [{ type: 'bearing.set', pointer, source: next === 'ADF' ? 'OFF' : next }]);
  };

  if (id === null) return none;
  if (id.startsWith('digit') && k.code) {
    return { keys: { ...k, code: codeDigit(k.code, Number(id.slice(5)), ctx.now) }, commands: [] };
  }
  switch (id) {
    case 'alerts':
      // An alert is first acknowledged; the next press opens the window.
      return ctx.alert ? { keys: k, commands: [{ type: 'msg.readAll' }] } : { keys: k, commands: [], toggleWindow: 'alerts' };
    case 'back':
      return go(PARENT[k.menu], k.menu === 'code' ? { code: null } : {});
    // Top level
    case 'inset':
      return { keys: { ...k, menu: 'inset', settings: { ...s, inset: true } }, commands: [] };
    case 'pfd':
      return go('pfd');
    case 'obs':
      return { keys: k, commands: [{ type: 'fms.obs', on: !ctx.obsMode }] };
    case 'cdi': {
      const i = ctx.cdiSources.indexOf(ctx.cdiSource);
      const next = ctx.cdiSources[(i + 1) % Math.max(ctx.cdiSources.length, 1)];
      const out: PfdKeyOutcome = { keys: k, commands: [{ type: 'cdi.cycle', sources: ctx.cdiSources }] };
      return next === 'NAV1' || next === 'NAV2' ? { ...out, tuneNav: next === 'NAV1' ? 0 : 1 } : out;
    }
    case 'dmeTune':
      return { keys: k, commands: [], toggleWindow: 'dme' };
    case 'xpdr':
      return go('xpdr');
    case 'ident':
      return { keys: k, commands: [{ type: 'xpdr.ident' }] };
    case 'tmrRef':
      return { keys: k, commands: [], toggleWindow: 'tmrRef' };
    case 'nrst':
      return { keys: k, commands: [], toggleWindow: 'nrst' };
    // INSET
    case 'insetOff':
      return { keys: { ...k, menu: 'root', settings: { ...s, inset: false } }, commands: [] };
    case 'dcltr':
      return set({ insetDeclutter: ((s.insetDeclutter + 1) % 4) as PfdSettings['insetDeclutter'] });
    case 'traffic':
      return set({ insetTraffic: !s.insetTraffic });
    case 'topo':
      return set({ insetTopo: !s.insetTopo });
    case 'terrain':
      return set({ insetTerrain: !s.insetTerrain });
    // PFD
    case 'dflts':
      return {
        keys: { ...k, settings: PFD_DEFAULTS },
        commands: [
          { type: 'bearing.set', pointer: 1, source: 'OFF' },
          { type: 'bearing.set', pointer: 2, source: 'OFF' },
        ],
      };
    case 'wind':
      return go('wind');
    case 'dmeWindow':
      return set({ dmeWindow: !s.dmeWindow });
    case 'brg1':
      return bearing(1);
    case 'brg2':
      return bearing(2);
    case 'hsiFrmt':
      return go('hsiFrmt');
    case 'altUnit':
      return go('altUnit');
    case 'stdBaro':
      return { keys: k, commands: [{ type: 'baro.std', on: true }] };
    case 'optn1':
    case 'optn2':
    case 'optn3':
      return set({ wind: Number(id.slice(4)) as WindOption });
    case 'windOff':
      return set({ wind: 0 });
    case 'hsi360':
      return set({ hsiArc: false });
    case 'hsiArc':
      return set({ hsiArc: true });
    case 'meters':
      return set({ altMeters: !s.altMeters });
    case 'inHg':
      return set({ baroHpa: false });
    case 'hpa':
      return set({ baroHpa: true });
    // XPDR
    case 'stby':
    case 'on':
    case 'alt':
    case 'gnd':
      return { keys: k, commands: [{ type: 'xpdr.mode', mode: id.toUpperCase() as TransponderMode }] };
    case 'vfr':
      return { keys: k, commands: [{ type: 'xpdr.code', code: '1200' }] };
    case 'code':
      return go('code', { code: startCode(ctx.now) });
    case 'bksp':
      return k.code ? { keys: { ...k, code: codeBackspace(k.code, ctx.now) }, commands: [] } : none;
  }
  return none;
}

/** After a code is committed or abandoned the softkeys go back to the top level. */
export function endCodeEntry(k: PfdKeys): PfdKeys {
  return { ...k, code: null, menu: k.menu === 'code' ? 'root' : k.menu };
}
