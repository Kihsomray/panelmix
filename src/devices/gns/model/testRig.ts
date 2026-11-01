import { existsSync, readFileSync } from 'node:fs';
import type { AirportProcedures, ProcedureSource } from '../../../core/procedures';
import { initialSimState } from '../../../sim/defaults';
import { db, kjyoProcedures, mag } from '../../../sim/fms/testkit';
import { Simulator } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import { IDENT_CHARS } from '../../../ui/identEntry';
import { nearestLists } from './data';
import { currentPage } from './pages';
import { initialUi, reduce } from './reducer';
import type { GnsCtx, GnsInput, GnsKey, GnsUi, Model } from './types';
import { INITIAL_WATCH, watch, type WatchMemo } from './watch';

/*
 * Test rig: a GNS wired to a real simulator with the real navigation data
 * (fixes and localizers from the CIFP) and the procedure files read from
 * disk. Inputs go through the reducer, commands into the simulator.
 */

export { db, mag };

/** The procedure database served from public/data/proc (KJYO from the FMS test kit, which falls back to a fixture). */
export function diskProcedures(): ProcedureSource {
  const indexPath = 'public/data/proc/index.json';
  const index = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { cycle: string; airports: string[] }) : { cycle: '', airports: [] };
  const airports = new Set([...index.airports, 'KJYO']);
  const cache = new Map<string, AirportProcedures>([['KJYO', kjyoProcedures]]);
  const get = (ident: string): AirportProcedures | null => {
    const key = ident.trim().toUpperCase();
    if (!airports.has(key)) return null;
    let p = cache.get(key);
    if (!p) {
      p = JSON.parse(readFileSync(`public/data/proc/${key}.json`, 'utf8')) as AirportProcedures;
      cache.set(key, p);
    }
    return p;
  };
  return {
    cycle: index.cycle,
    has: (ident) => airports.has(ident.trim().toUpperCase()),
    get,
    load: (ident) => Promise.resolve(get(ident)),
    subscribe: () => () => {},
  };
}

export const key = (k: GnsKey): GnsInput => ({ kind: 'key', key: k });
export const small = (steps = 1): GnsInput => ({ kind: 'right', ring: 'inner', steps });
export const large = (steps = 1): GnsInput => ({ kind: 'right', ring: 'outer', steps });
export const CRSR: GnsInput = { kind: 'rightPush' };

export function rig(model: Model = '430', state: SimState = initialSimState()) {
  const sim = new Simulator(db, mag, state);
  const procedures = diskProcedures();
  let ui: GnsUi = initialUi(model);
  let memo: WatchMemo = INITIAL_WATCH;
  let now = 100;
  const ctx = (): GnsCtx => ({
    state: sim.getState(),
    db,
    mag,
    nearest: nearestLists(db, sim.getState().aircraft, ui.aux.criteria),
    cdiSources: ['GPS', 'NAV1'],
    procedures,
    now,
  });
  return {
    sim,
    procedures,
    get ui() {
      return ui;
    },
    get page() {
      return currentPage(ui);
    },
    nearest: () => ctx().nearest,
    send(...inputs: GnsInput[]) {
      for (const input of inputs) {
        const r = reduce(ui, input, ctx());
        ui = r.ui;
        for (const c of r.cmds) sim.dispatch(c);
      }
    },
    /** What the unit does by itself this frame (the component runs it after every render). */
    watch() {
      const c = ctx();
      const r = watch(memo, ui, { state: c.state, derived: sim.getDerived(), db, cdiSources: c.cdiSources, procedures, nearest: c.nearest });
      memo = r.memo;
      ui = r.ui;
      for (const c of r.cmds) sim.dispatch(c);
      return r.cmds;
    },
    wait(seconds: number) {
      now += seconds;
    },
    /** Spells an identifier with the right knobs, starting from what the field shows. */
    spell(ident: string, shown = '') {
      for (let i = 0; i < ident.length; i++) {
        const e = ui.entry?.e;
        const current = e ? e.text[e.cursor] ?? ' ' : shown[0] ?? ' ';
        const steps = IDENT_CHARS.indexOf(ident[i]!) - IDENT_CHARS.indexOf(current);
        if (steps !== 0 || !ui.entry) this.send(small(steps === 0 ? IDENT_CHARS.length : steps));
        if (i < ident.length - 1) this.send(large(1));
      }
    },
  };
}

export type Rig = ReturnType<typeof rig>;
