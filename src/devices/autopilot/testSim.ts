import { readFileSync } from 'node:fs';
import { MagneticModel, type MagvarGrid } from '../../core/magvar';
import { NavDatabase, type RawNavdata } from '../../core/navdb';
import type { SimCommand } from '../../sim/commands';
import { initialSimState } from '../../sim/defaults';
import { Simulator } from '../../sim/simulator';

/*
 * Test helper (imported by the autopilot tests only): a real simulator on
 * the trainer's navigation data, so a flow of key presses can be flown and
 * checked end to end.
 */

let shared: { db: NavDatabase; mag: MagneticModel } | null = null;

export function makeSim(): Simulator {
  shared ??= {
    db: new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata),
    mag: new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid),
  };
  return new Simulator(shared.db, shared.mag, initialSimState());
}

export function send(sim: Simulator, commands: readonly SimCommand[]): void {
  for (const c of commands) sim.dispatch(c);
}
