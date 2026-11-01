import { readFileSync } from 'node:fs';
import { ringContains, type AirspaceClass, type AirspaceSource, type AirspaceVolume } from '../../core/airspace';
import type { LatLon } from '../../core/geo';
import { MagneticModel, type MagvarGrid } from '../../core/magvar';
import { NavDatabase, type RawNavdata } from '../../core/navdb';
import type { TerrainProvider } from '../../core/terrain';
import { initialSimState } from '../defaults';
import { Simulator, type SimProviders } from '../simulator';
import type { SimState } from '../types';

/*
 * Test helpers for the systems tests (imported by tests only): the real
 * navigation data, and stub terrain and airspace providers.
 */

let shared: { readonly db: NavDatabase; readonly mag: MagneticModel } | null = null;

export function navdata(): { readonly db: NavDatabase; readonly mag: MagneticModel } {
  shared ??= {
    db: new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata),
    mag: new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid),
  };
  return shared;
}

export function makeSim(state: SimState = initialSimState(), providers: SimProviders = {}): Simulator {
  const { db, mag } = navdata();
  return new Simulator(db, mag, state, providers);
}

/** Terrain from a function of position (null = no data there). */
export function terrainOf(elevationFt: (lat: number, lon: number) => number | null): TerrainProvider {
  return {
    elevationFt,
    sample: (lat, lon) => {
      const e = elevationFt(lat, lon);
      return e === null ? null : { elevationFt: e, water: false };
    },
    prefetch: () => {},
    subscribe: () => () => {},
  };
}

export function airspaceOf(volumes: readonly AirspaceVolume[]): AirspaceSource {
  const overlaps = (v: AirspaceVolume, south: number, west: number, north: number, east: number) =>
    v.bbox[0] <= east && v.bbox[2] >= west && v.bbox[1] <= north && v.bbox[3] >= south;
  return {
    volumes,
    inBox: (south, west, north, east) => volumes.filter((v) => overlaps(v, south, west, north, east)),
    containing: (lat, lon, altitudeFt) =>
      volumes.filter((v) => altitudeFt >= v.lowerFt && altitudeFt <= v.upperFt && ringContains(v.ring, lat, lon)),
  };
}

/** A square volume `halfNm` either side of a center. */
export function boxVolume(cls: AirspaceClass, name: string, lowerFt: number, upperFt: number, center: LatLon, halfNm: number): AirspaceVolume {
  const dLat = halfNm / 60;
  const dLon = halfNm / (60 * Math.cos((center.lat * Math.PI) / 180));
  const [west, south, east, north] = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
  return { cls, name, lowerFt, upperFt, ring: [west, south, east, south, east, north, west, north], bbox: [west, south, east, north] };
}

/** Engages the autopilot wings level holding the current altitude. */
export function holdWingsLevel(sim: Simulator): void {
  sim.dispatch({ type: 'ap.engage', on: true });
  sim.dispatch({ type: 'ap.lateral', mode: 'ROL', rollRefDeg: 0 });
  sim.dispatch({ type: 'ap.vertical', mode: 'ALT' });
}

/** Engages the autopilot in VS mode at `fpm`, wings level. */
export function holdVerticalSpeed(sim: Simulator, fpm: number): void {
  sim.dispatch({ type: 'ap.engage', on: true });
  sim.dispatch({ type: 'ap.lateral', mode: 'ROL', rollRefDeg: 0 });
  sim.dispatch({ type: 'ap.vertical', mode: 'VS' });
  sim.dispatch({ type: 'bug.verticalSpeed', fpm });
}

/** Steps `seconds` in `every`-second chunks, calling `sample` after each. */
export function fly(sim: Simulator, seconds: number, every: number, sample: (t: number) => void): void {
  for (let t = every; t <= seconds + 1e-9; t += every) {
    sim.step(every);
    sample(t);
  }
}

export const texts = (sim: Simulator): string[] => sim.getState().messages.map((m) => m.text);
export const count = (sim: Simulator, text: string): number => texts(sim).filter((t) => t === text).length;
