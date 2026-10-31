import { formatBearing, formatDistance, formatEte } from '../../ui/format';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import { gtnFreq } from './format';

/*
 * GTN user fields: the data the pilot picks for the map corners and the
 * Default Navigation page. Each type turns the shared simulator state into
 * a label, a value and a unit, with Garmin's colour conventions (magenta for
 * GPS waypoint data, green for the tuned VOR).
 */

export const FIELD_IDS = [
  'ACTV WPT',
  'BRG',
  'DIS',
  'DIS DEST',
  'DTK',
  'ETA',
  'ETA DEST',
  'ETE',
  'ETE DEST',
  'FUEL FLOW',
  'GS',
  'GSL',
  'OAT',
  'TKE',
  'TRK',
  'TIME',
  'VOR/LOC',
  'WIND',
  'XTK',
  'OFF',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/** Long names for the field picker. */
export const FIELD_NAMES: Record<FieldId, string> = {
  'ACTV WPT': 'Active waypoint',
  BRG: 'Bearing to waypoint',
  DIS: 'Distance to waypoint',
  'DIS DEST': 'Distance to destination',
  DTK: 'Desired track',
  ETA: 'Estimated time of arrival',
  'ETA DEST': 'ETA at destination',
  ETE: 'Estimated time en route',
  'ETE DEST': 'ETE to destination',
  'FUEL FLOW': 'Total fuel flow',
  GS: 'GPS ground speed',
  GSL: 'GPS altitude',
  OAT: 'Outside static air temperature',
  TKE: 'Track angle error',
  TRK: 'Track',
  TIME: 'Current time (UTC)',
  'VOR/LOC': 'Tuned VOR/LOC information',
  WIND: 'Wind speed and direction',
  XTK: 'Cross track error',
  OFF: 'Do not display data field',
};

export type FieldTone = 'white' | 'magenta' | 'green';

export interface FieldValue {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly tone: FieldTone;
}

export interface FieldInput {
  readonly state: SimState;
  readonly derived: Derived;
  /** Wall-clock time for ETA and TIME, ms since the epoch. */
  readonly nowMs: number;
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

const eta = (nowMs: number, eteSec: number | null) => (eteSec === null ? '__:__' : hhmm(nowMs + eteSec * 1000));

export function fieldValue(id: FieldId, { state, derived, nowMs }: FieldInput): FieldValue {
  const gps = derived.gps;
  const v = (value: string, unit = '', tone: FieldTone = 'white'): FieldValue => ({ label: id, value, unit, tone });
  switch (id) {
    case 'ACTV WPT':
      return v(gps.to?.ident ?? '______', '', 'magenta');
    case 'BRG':
      return v(formatBearing(gps.bearingMag));
    case 'DIS':
      return v(formatDistance(gps.distanceNm), 'NM');
    case 'DIS DEST':
      return v(formatDistance(gps.destinationNm), 'NM');
    case 'DTK':
      return v(formatBearing(gps.dtkMag));
    case 'ETA':
      return v(eta(nowMs, gps.eteSec), 'UTC');
    case 'ETA DEST':
      return v(eta(nowMs, gps.destinationEteSec), 'UTC');
    case 'ETE':
      return v(formatEte(gps.eteSec));
    case 'ETE DEST':
      return v(formatEte(gps.destinationEteSec));
    case 'FUEL FLOW':
      return v(state.aircraft.engine.fuelFlowGph.toFixed(1), 'GPH');
    case 'GS':
      return v(String(Math.round(state.aircraft.groundSpeedKt)), 'KT');
    case 'GSL':
      return v(Math.round(state.aircraft.altitudeFt).toLocaleString('en-US'), 'FT');
    case 'OAT':
      return v(String(Math.round(derived.oatC)), '°C');
    case 'TKE': {
      const e = gps.trackErrorDeg;
      if (e === null) return v('___°');
      return v(`${Math.abs(Math.round(e))}°${Math.round(e) === 0 ? '' : e > 0 ? 'R' : 'L'}`);
    }
    case 'TRK':
      return v(formatBearing(derived.trackMag));
    case 'TIME':
      return v(hhmm(nowMs), 'UTC');
    case 'VOR/LOC': {
      const r = derived.vor[0];
      return v(r.station ? r.station.ident : gtnFreq('nav', r.khz), r.station ? formatDistance(r.dmeNm) : '', 'green');
    }
    case 'WIND':
      return v(`${formatBearing(state.env.windFromTrue)}/${Math.round(state.env.windKt)}`, 'KT');
    case 'XTK':
      return v(gps.active ? Math.abs(gps.crossTrackNm).toFixed(2) : '__.__', 'NM');
    case 'OFF':
      return v('');
  }
}
