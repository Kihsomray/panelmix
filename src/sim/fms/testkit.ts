import { existsSync, readFileSync } from 'node:fs';
import { destination, type LatLon } from '../../core/geo';
import { MagneticModel, type MagvarGrid } from '../../core/magvar';
import { NavDatabase, type RawFix, type RawLocalizer, type RawNavdata, type Waypoint } from '../../core/navdb';
import type { AirportProcedures, Approach } from '../../core/procedures';
import { initialSimState } from '../defaults';
import { Simulator } from '../simulator';
import type { SimState } from '../types';

/*
 * Test fixtures for flying procedures: the real navigation data, and KJYO's
 * procedures from the CIFP (public/data/proc/KJYO.json as built by
 * scripts/build-cifp.mjs; kjyo.fixture.json holds the same RNAV 17 and ILS 17
 * records for when the generated file is missing or being rebuilt).
 */

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface Fixture {
  readonly procedures: AirportProcedures;
  readonly localizers: RawLocalizer[];
  readonly fixes: RawFix[];
}

const fixture = json<Fixture>('src/sim/fms/kjyo.fixture.json');

function loadKjyo(): AirportProcedures {
  const path = 'public/data/proc/KJYO.json';
  try {
    if (existsSync(path)) {
      const p = json<AirportProcedures>(path);
      if (p.approaches.some((a) => a.id === 'R17') && p.approaches.some((a) => a.id === 'I17')) return p;
    }
  } catch {
    // Being rewritten by the CIFP build: use the fixture.
  }
  return fixture.procedures;
}

function loadLocalizers(): RawLocalizer[] {
  try {
    const items = json<{ items: RawLocalizer[] }>('public/data/localizers.json').items;
    if (items.some((l) => l[0] === 'IJYO')) return items;
  } catch {
    // fall through
  }
  return fixture.localizers;
}

function loadFixes(): RawFix[] {
  try {
    const fixes = json<{ fixes: RawFix[] }>('public/data/fixes.json').fixes;
    if (fixes.some((f) => f[0] === 'KORNY')) return fixes;
  } catch {
    // fall through
  }
  return fixture.fixes;
}

export const kjyoProcedures = loadKjyo();
export const db = new NavDatabase(json<RawNavdata>('public/data/navdata.json'), { localizers: loadLocalizers(), fixes: loadFixes() });
export const mag = new MagneticModel(json<MagvarGrid>('public/data/magvar.json'));

export function approach(id: string): Approach {
  const a = kjyoProcedures.approaches.find((x) => x.id === id);
  if (!a) throw new Error(`KJYO ${id} not in the procedure data`);
  return a;
}

export const KJYO: Waypoint = NavDatabase.toWaypoint(db.airport('KJYO')!);
export const wp = (ident: string): Waypoint => NavDatabase.toWaypoint(db.get(ident)!);

/** A simulator with the airplane placed at `pos`, wings level, an empty flight plan. */
export function simAt(pos: LatLon, altitudeFt: number, headingTrue: number, iasKt = 100, wind?: { fromTrue: number; kt: number }): Simulator {
  const s0 = initialSimState();
  const state: SimState = {
    ...s0,
    aircraft: { ...s0.aircraft, lat: pos.lat, lon: pos.lon, altitudeFt, headingTrue, trackTrue: headingTrue, iasKt, tasKt: iasKt, groundSpeedKt: iasKt },
    env: wind ? { ...s0.env, windFromTrue: wind.fromTrue, windKt: wind.kt } : s0.env,
    fms: { ...s0.fms, plan: [], activeLeg: null },
    ap: { ...s0.ap, altitudeRefFt: altitudeFt },
  };
  const sim = new Simulator(db, mag, state);
  sim.dispatch({ type: 'sim.reposition', lat: pos.lat, lon: pos.lon, altitudeFt, headingTrue, iasKt });
  return sim;
}

/** Engages the autopilot in NAV, holding the present altitude. */
export function engageNav(sim: Simulator): void {
  sim.dispatch({ type: 'ap.engage', on: true });
  sim.dispatch({ type: 'ap.lateral', mode: 'NAV' });
  sim.dispatch({ type: 'ap.vertical', mode: 'ALT' });
}

/**
 * Steps the simulation one second at a time until `until` returns true or
 * `maxSeconds` pass; `each` sees every second. Returns the seconds flown.
 */
export function fly(sim: Simulator, maxSeconds: number, until: () => boolean, each?: () => void): number {
  for (let t = 0; t < maxSeconds; t++) {
    sim.step(1);
    each?.();
    if (until()) return t + 1;
  }
  return maxSeconds;
}

export { destination };
