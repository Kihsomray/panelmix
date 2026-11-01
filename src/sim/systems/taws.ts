import { distanceNm, toRad } from '../../core/geo';
import type { TerrainProvider } from '../../core/terrain';
import type { AircraftState } from '../types';
import type { TerrainAlertLevel } from './types';

/*
 * TAWS-style terrain alerting (forward-looking terrain avoidance, in the
 * spirit of TSO-C151 class B, much simplified): the flight path is projected
 * a minute ahead along the ground track at the current vertical speed and
 * checked against the terrain below it.
 * - Caution: the projected clearance falls below the required terrain
 *   clearance within 60 s (700 ft enroute, 350 ft near an airport; a little
 *   less when descending).
 * - Warning: within 100 ft of the terrain (or into it) within 30 s.
 * Near the nearest airport, low and slow, the airplane is assumed to be
 * landing and alerting is inhibited, as real units do near the runway.
 */

/** The nearest airport, as the simulator finds it (within about 8 nm). */
export interface SystemsField {
  readonly lat: number;
  readonly lon: number;
  readonly elevationFt: number;
}

export const TAWS = {
  lookAheadS: [0, 10, 20, 30, 40, 50, 60],
  warningWithinS: 30,
  warningClearanceFt: 100,
  enroute: { levelFt: 700, descendingFt: 500 },
  terminal: { levelFt: 350, descendingFt: 300 },
  /** Within this of an airport, the terminal clearances apply. */
  terminalWithinNm: 8,
  /** Below this vertical speed the descending clearances apply, fpm. */
  descendingFpm: -500,
  /** The landing inhibit: this close to the airport, this low above it and this slow. */
  landing: { withinNm: 5, belowFt: 2000, belowKt: 110 },
  /** An alert stays annunciated this long after its condition clears, s. */
  holdS: 3,
} as const;

export interface TerrainAssessment {
  /** Terrain elevation below the airplane, or null without data. */
  readonly elevationFt: number | null;
  readonly level: TerrainAlertLevel;
  readonly suppressed: boolean;
}

/** The instantaneous TAWS picture (before the annunciation hold). */
export function assessTerrain(a: AircraftState, terrain: TerrainProvider, field: SystemsField | null): TerrainAssessment {
  const elevationFt = terrain.elevationFt(a.lat, a.lon);
  const fieldNm = field ? distanceNm(a, field) : Infinity;
  const L = TAWS.landing;
  const suppressed = field !== null && fieldNm < L.withinNm && a.altitudeFt - field.elevationFt < L.belowFt && a.iasKt < L.belowKt;
  if (elevationFt === null || suppressed) return { elevationFt, level: 'none', suppressed };

  const zone = fieldNm <= TAWS.terminalWithinNm ? TAWS.terminal : TAWS.enroute;
  const required = a.verticalSpeedFpm < TAWS.descendingFpm ? zone.descendingFt : zone.levelFt;
  const track = toRad(a.trackTrue);
  const north = Math.cos(track) / 60;
  const east = Math.sin(track) / (60 * Math.cos(toRad(a.lat)));
  let level: TerrainAlertLevel = 'none';
  for (const s of TAWS.lookAheadS) {
    const nm = (a.groundSpeedKt * s) / 3600;
    const ground = s === 0 ? elevationFt : terrain.elevationFt(a.lat + nm * north, a.lon + nm * east);
    if (ground === null) continue;
    const clearance = a.altitudeFt + (a.verticalSpeedFpm * s) / 60 - ground;
    if (s <= TAWS.warningWithinS && clearance < TAWS.warningClearanceFt) return { elevationFt, level: 'warning', suppressed };
    if (clearance < required) level = 'caution';
  }
  return { elevationFt, level, suppressed };
}
