import type { AspenSettings, MapFeature, MapSettings, VSpeeds } from './settings';

/*
 * The Aspen menu (Pilot's Guide chapter 5): pages of up to five options,
 * each beside one of the hot keys. White options can be edited, green ones
 * are status only, gray ones are not available in this installation.
 * Pure data and editing rules; the PFD draws them and the controls reducer
 * moves between them.
 */

export type RowKind = 'edit' | 'status' | 'action' | 'disabled';

export type RowId =
  | 'tapes'
  | 'radAlt'
  | 'autoCrs'
  | 'arcMode'
  | 'ahrs'
  | 'baroUnits'
  | 'oatUnits'
  | 'autoRange'
  | `map360.${MapRow}`
  | `mapArc.${MapRow}`
  | `vs.${keyof VSpeeds}`
  | 'battery'
  | 'external'
  | 'shutdown'
  | 'volts'
  | 'charge'
  | 'mapSw'
  | 'iopSw'
  | 'serial';

type MapRow = 'declutter' | MapFeature;

export interface MenuRow {
  readonly id: RowId;
  readonly label: string;
  readonly value: string;
  readonly kind: RowKind;
}

/** Live values the power and status pages show. */
export interface MenuStatus {
  readonly volts: number;
  readonly onBattery: boolean;
}

export const MENU_PAGES = [
  'GENERAL SETTINGS A',
  'GENERAL SETTINGS B',
  '360 MAP SETTINGS',
  'ARC MAP SETTINGS',
  'VSPEEDS A',
  'VSPEEDS B',
  'POWER SETTINGS',
  'SYSTEM STATUS',
] as const;

const onOff = (on: boolean) => (on ? 'ENABLE' : 'DISABLE');
const auto = (on: boolean) => (on ? 'AUTO' : 'OFF');
const speed = (kt: number) => (kt === 0 ? 'OFF' : String(kt));

function mapRows(prefix: 'map360' | 'mapArc', m: MapSettings, title: string): MenuRow[] {
  return [
    { id: `${prefix}.declutter`, label: `${title} DCLTR LVL:`, value: m.declutter === 0 ? 'OFF' : String(m.declutter), kind: 'edit' },
    { id: `${prefix}.fpl`, label: 'FLT PLAN:', value: auto(m.show.fpl), kind: 'edit' },
    { id: `${prefix}.apt`, label: 'ARPTS:', value: auto(m.show.apt), kind: 'edit' },
    { id: `${prefix}.vor`, label: 'VORS:', value: auto(m.show.vor), kind: 'edit' },
    { id: `${prefix}.ndb`, label: 'INT/NDB:', value: auto(m.show.ndb), kind: 'edit' },
  ];
}

/** The five rows of a page, top to bottom; null leaves a hot key without an option. */
export function menuRows(page: number, s: AspenSettings, status: MenuStatus): readonly (MenuRow | null)[] {
  const v = s.vspeeds;
  switch (page) {
    case 0:
      return [
        { id: 'tapes', label: 'TPS:', value: onOff(s.tapes), kind: 'edit' },
        { id: 'radAlt', label: 'RAD ALT:', value: 'DISABLE', kind: 'disabled' },
        { id: 'autoCrs', label: 'AUTOCRS:', value: onOff(s.autoCrs), kind: 'edit' },
        { id: 'arcMode', label: 'ARC MODE:', value: s.arcMode, kind: 'edit' },
        { id: 'ahrs', label: 'AHRS:', value: 'RESET?', kind: 'action' },
      ];
    case 1:
      return [
        { id: 'baroUnits', label: 'BARO:', value: s.baroUnits === 'IN' ? 'IN' : 'MB', kind: 'edit' },
        { id: 'oatUnits', label: 'OAT:', value: s.oatUnits === 'C' ? '°C' : '°F', kind: 'edit' },
        null,
        null,
        { id: 'autoRange', label: 'AUTO RNG:', value: onOff(s.autoRange), kind: 'edit' },
      ];
    case 2:
      return mapRows('map360', s.map360, '360');
    case 3:
      return mapRows('mapArc', s.mapArc, 'ARC');
    case 4:
      return [
        { id: 'vs.enabled', label: 'VSPEEDS:', value: onOff(v.enabled), kind: 'edit' },
        { id: 'vs.vx', label: 'Vx:', value: speed(v.vx), kind: 'edit' },
        { id: 'vs.va', label: 'Va:', value: speed(v.va), kind: 'edit' },
        { id: 'vs.vy', label: 'Vy:', value: speed(v.vy), kind: 'edit' },
        { id: 'vs.vbg', label: 'Vbg:', value: speed(v.vbg), kind: 'edit' },
      ];
    case 5:
      return [
        { id: 'vs.vlo', label: 'Vlo:', value: speed(v.vlo), kind: 'edit' },
        { id: 'vs.vref', label: 'Vref:', value: speed(v.vref), kind: 'edit' },
        { id: 'vs.vle', label: 'Vle:', value: speed(v.vle), kind: 'edit' },
        { id: 'vs.vr', label: 'Vr:', value: speed(v.vr), kind: 'edit' },
        null,
      ];
    case 6:
      return [
        { id: 'battery', label: 'BATTERY:', value: status.onBattery ? 'ON' : 'SWITCH', kind: status.onBattery ? 'status' : 'action' },
        { id: 'external', label: 'EXT PWR:', value: status.onBattery ? 'SWITCH' : 'ON', kind: status.onBattery ? 'action' : 'status' },
        { id: 'shutdown', label: 'SHUT DOWN:', value: 'PRESS', kind: 'action' },
        { id: 'volts', label: 'VOLTS:', value: status.onBattery ? '--.-' : status.volts.toFixed(1), kind: 'status' },
        { id: 'charge', label: 'BATT:', value: status.onBattery ? '99%' : 'CHARGING', kind: 'status' },
      ];
    default:
      return [
        { id: 'mapSw', label: 'MAP SW:', value: '2.10', kind: 'status' },
        { id: 'iopSw', label: 'IOP SW:', value: '2.10', kind: 'status' },
        { id: 'serial', label: 'SERIAL #:', value: '1000474', kind: 'status' },
        null,
        null,
      ];
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function editMap(m: MapSettings, row: MapRow, steps: number): MapSettings {
  if (row === 'declutter') return { ...m, declutter: clamp(m.declutter + steps, 0, 4) };
  return flips(steps) ? { ...m, show: { ...m.show, [row]: !m.show[row] } } : m;
}

/** Two-value options (ENABLE/DISABLE, IN/MB, OFF/AUTO) change with each click of the knob. */
const flips = (steps: number) => Math.abs(steps) % 2 === 1;

/** Turning the right knob on the option being edited. V-speeds step 1 kt from 0 (removed) to 450. */
export function editRow(s: AspenSettings, id: RowId, steps: number): AspenSettings {
  if (steps === 0) return s;
  if (id.startsWith('map360.')) return { ...s, map360: editMap(s.map360, id.slice(7) as MapRow, steps) };
  if (id.startsWith('mapArc.')) return { ...s, mapArc: editMap(s.mapArc, id.slice(7) as MapRow, steps) };
  if (id.startsWith('vs.')) {
    const key = id.slice(3) as keyof VSpeeds;
    if (key === 'enabled') return flips(steps) ? { ...s, vspeeds: { ...s.vspeeds, enabled: !s.vspeeds.enabled } } : s;
    return { ...s, vspeeds: { ...s.vspeeds, [key]: clamp(s.vspeeds[key] + steps, 0, 450) } };
  }
  if (!flips(steps)) return s;
  switch (id) {
    case 'tapes':
      return { ...s, tapes: !s.tapes };
    case 'autoCrs':
      return { ...s, autoCrs: !s.autoCrs };
    case 'arcMode':
      return { ...s, arcMode: s.arcMode === 'HSI' ? 'CDI' : 'HSI' };
    case 'baroUnits':
      return { ...s, baroUnits: s.baroUnits === 'IN' ? 'MB' : 'IN' };
    case 'oatUnits':
      return { ...s, oatUnits: s.oatUnits === 'C' ? 'F' : 'C' };
    case 'autoRange':
      return { ...s, autoRange: !s.autoRange };
    default:
      return s;
  }
}
