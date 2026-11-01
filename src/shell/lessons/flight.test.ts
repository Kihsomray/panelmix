import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MagneticModel, type MagvarGrid } from '../../core/magvar';
import { NavDatabase, type RawFix, type RawLocalizer, type RawNavdata } from '../../core/navdb';
import type { AirportProcedures, ProcedureSource } from '../../core/procedures';
import type { SimCommand } from '../../sim/commands';
import { initialSimState } from '../../sim/defaults';
import { Simulator } from '../../sim/simulator';
import { G5_PANEL } from '../testFixtures';
import { LESSONS } from './catalog';
import { stepsFor } from './families';
import { advance, currentStep, startRun, type LessonRun } from './runner';
import { resolveSetup } from './setup';
import type { Lesson } from './types';

/*
 * The flown lessons end to end in the real simulator: the lesson's own
 * set-up, the autopilot flying, and a scripted pilot doing what the hints
 * say (the buttonology through "Do it for me", power and altitudes by hand).
 * This proves the step checks match what the FMS, autopilot and procedure
 * data actually do. Needs the generated CIFP files; skipped without them.
 */

const FILES = ['public/data/proc/KJYO.json', 'public/data/fixes.json', 'public/data/localizers.json'];
const hasData = FILES.every((f) => existsSync(f));
const read = <T,>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;

function world() {
  const db = new NavDatabase(read<RawNavdata>('public/data/navdata.json'), {
    fixes: read<{ fixes: RawFix[] }>('public/data/fixes.json').fixes,
    localizers: read<{ items: RawLocalizer[] }>('public/data/localizers.json').items,
  });
  const mag = new MagneticModel(read<MagvarGrid>('public/data/magvar.json'));
  const kjyo = read<AirportProcedures>('public/data/proc/KJYO.json');
  const procedures: ProcedureSource = {
    cycle: kjyo.cycle,
    has: (a) => a === 'KJYO',
    get: (a) => (a === 'KJYO' ? kjyo : null),
    load: (a) => Promise.resolve(a === 'KJYO' ? kjyo : null),
    subscribe: () => () => {},
  };
  return { db, mag, procedures };
}

interface StepLog {
  readonly id: string;
  readonly t: number;
  readonly altitudeFt: number;
  readonly iasKt: number;
}

/**
 * What the scripted pilot does on the current step: commands to send once, an
 * empty list to wait (nothing to do yet), or null to use the step's "Do it for me".
 */
type Pilot = (stepId: string, sim: Simulator) => readonly SimCommand[] | null;

function fly(lesson: Lesson, pilot: Pilot, maxSec = 3600): { run: LessonRun; log: StepLog[]; story: string } {
  const { db, mag, procedures } = world();
  const env = { db, mag, procedures, panel: G5_PANEL };
  const sim = new Simulator(db, mag, initialSimState(), { procedures });
  const setup = resolveSetup(lesson.setup, env, sim.getState(), () => 0.5);
  expect(setup.problems).toEqual([]);
  for (const c of setup.commands) sim.dispatch(c);
  const pending = setup.failures.map((f) => ({ ...f, at: sim.getState().time + f.delaySec }));
  const live = () => ({ state: sim.getState(), derived: sim.getDerived(), panel: G5_PANEL });
  let run = startRun(lesson, live());
  const log: StepLog[] = [];
  const acted = new Set<string>();
  let since = sim.getState().time;

  for (let t = 0; t < maxSec && run.finishedAt === null; t++) {
    sim.step(1);
    const now = sim.getState().time;
    for (const f of pending.filter((p) => p.at <= now)) {
      pending.splice(pending.indexOf(f), 1);
      if (f.action.kind === 'fail') sim.dispatch({ type: 'failure.set', failure: f.action.failure, failed: f.action.failed });
    }
    const before = run.results.length;
    run = advance(lesson, run, live());
    if (run.results.length !== before) {
      log.push({ id: run.results[run.results.length - 1]!.id, t: Math.round(now), altitudeFt: sim.getDerived().indicatedAltitudeFt, iasKt: sim.getState().aircraft.iasKt });
      since = now;
    }
    const cur = currentStep(lesson, run, G5_PANEL);
    // A few seconds into each step the pilot does it (once), like a student following the hint.
    if (!cur || acted.has(cur.step.id) || now - since < 3) continue;
    const step = cur.step;
    const cmds =
      pilot(step.id, sim) ??
      step.assist?.({ ...live(), stepStart: run.stepStart }, env) ??
      null;
    if (cmds && cmds.length > 0) {
      acted.add(step.id);
      for (const c of cmds) sim.dispatch(c);
    }
  }
  const cur = currentStep(lesson, run, G5_PANEL);
  const s = sim.getState();
  const story = `${log.map((l) => `${l.id}@${l.t}`).join(' ')} | stuck on ${cur?.step.id ?? '-'}: leg ${s.fms.activeLeg?.to.ident}#${s.fms.activeLeg?.approachIndex} susp ${s.fms.suspended} hold ${s.fms.hold?.fix.ident ?? '-'} ap ${s.ap.engaged ? `${s.ap.lateral}/${s.ap.vertical}` : 'off'}`;
  return { run, log, story };
}

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const order = (l: Lesson) => stepsFor(l.steps, G5_PANEL).map((s) => s.id);
const at = (log: readonly StepLog[], id: string) => log.find((l) => l.id === id)!;

/** Power and altitudes the hints ask for: power back once on the path, SUSP once the navigator has suspended. */
function approachPilot(extra: Record<string, readonly SimCommand[]> = {}): Pilot {
  return (id, sim) => {
    if (id === 'unsuspend') return sim.getState().fms.suspended ? [{ type: 'fms.unsuspend' }] : [];
    if (id === 'gp' || id === 'gs') return [];
    if (id === 'da') return [{ type: 'engine.throttle', value: 0.2 }];
    return extra[id] ?? null;
  };
}

/** Up to an hour of simulated flight each: generous on a loaded Raspberry Pi. */
const FLIGHT_TIMEOUT_MS = 60_000;

describe.skipIf(!hasData)('lessons flown in the simulator', { timeout: FLIGHT_TIMEOUT_MS }, () => {
  it('RNAV 17: transition, LPV glidepath to the DA, missed approach into the KORNY hold', () => {
    const l = lesson('rnav17');
    const { run, log, story } = fly(
      l,
      approachPilot({
        descend: [
          { type: 'engine.throttle', value: 0.4 },
          { type: 'bug.altitude', ft: 2100 },
          { type: 'ap.vertical', mode: 'VS' },
          { type: 'bug.verticalSpeed', fpm: -500 },
          { type: 'ap.armAltitude', on: true },
        ],
        korny: [
          { type: 'bug.altitude', ft: 4000 },
          { type: 'ap.armAltitude', on: true },
          { type: 'ap.lateral', mode: 'NAV' },
        ],
      }),
    );
    expect(run.finishedAt, story).not.toBeNull();
    expect(log.map((s) => s.id)).toEqual(order(l));
    expect(run.monitors.course).toBeLessThan(0.5);
    expect(run.monitors.path).toBeLessThan(0.5);
    expect(run.monitors.low).toBeLessThanOrEqual(50);
    expect(at(log, 'da').iasKt).toBeLessThan(110);
  });

  it('ILS 17 from vectors: localizer and glideslope to the DA, then the missed approach', () => {
    const l = lesson('ils17');
    const { run, log, story } = fly(
      l,
      approachPilot({
        missed: [
          { type: 'bug.heading', mag: 340 },
          { type: 'ap.lateral', mode: 'HDG' },
          { type: 'bug.altitude', ft: 4000 },
        ],
      }),
    );
    expect(run.finishedAt, story).not.toBeNull();
    expect(log.map((s) => s.id)).toEqual(order(l));
    expect(run.monitors.course).toBeLessThan(0.5);
    expect(run.monitors.path).toBeLessThan(0.5);
    expect(at(log, 'da').iasKt).toBeGreaterThan(80);
    expect(at(log, 'da').iasKt).toBeLessThan(110);
  });

  it('the published hold: from a 6 nm final through the missed approach and a full circuit at KORNY', () => {
    const l = lesson('hold-missed');
    const { run, log, story } = fly(l, approachPilot({ korny: [{ type: 'ap.lateral', mode: 'NAV' }] }));
    expect(run.finishedAt, story).not.toBeNull();
    expect(log.map((s) => s.id)).toEqual(order(l));
    expect(run.monitors.altitude).toBeLessThanOrEqual(100);
    expect(run.monitors.bank).toBeLessThanOrEqual(30);
  });

  it('a pilot hold at MRB: entry, outbound, inbound, a full circuit and the exit', () => {
    const l = lesson('hold-pilot');
    // The FMS flies the hold in NAV; the pilot only enters it and leaves it.
    const { run, log, story } = fly(l, (id) => (id === 'enter' || id === 'exit' ? null : []));
    expect(run.finishedAt, story).not.toBeNull();
    expect(log.map((s) => s.id)).toEqual(order(l));
    expect(run.monitors.altitude).toBeLessThanOrEqual(100);
  });

  it('partial panel: the scheduled failure arrives and every step can be flown', () => {
    const l = lesson('partial-panel');
    // The autopilot stands in for the pilot's hands on the hand-flying steps.
    const { run, log, story } = fly(l, (id, sim) => {
      switch (id) {
        case 'scan':
          return [];
        case 'level':
          return [{ type: 'ap.engage', on: true }, { type: 'ap.lateral', mode: 'HDG' }, { type: 'ap.vertical', mode: 'ALT' }];
        case 'altitude':
          return [];
        case 'turn':
          return [{ type: 'bug.heading', mag: 270 }];
        case 'descend': {
          const ft = Math.round(sim.getDerived().indicatedAltitudeFt / 100) * 100 - 500;
          return [{ type: 'bug.altitude', ft }, { type: 'ap.vertical', mode: 'VS' }, { type: 'bug.verticalSpeed', fpm: -500 }, { type: 'ap.armAltitude', on: true }];
        }
        case 'divert': {
          const near = sim.db.nearestAirports(sim.getState().aircraft, 1)[0]!.item;
          return [{ type: 'fms.directTo', waypoint: NavDatabase.toWaypoint(near) }];
        }
        default:
          return null;
      }
    });
    expect(run.finishedAt, story).not.toBeNull();
    expect(log.map((s) => s.id)).toEqual(order(l));
    // The surprise came between 20 and 90 s after the start (55 s with this seed).
    expect(at(log, 'scan').t).toBeGreaterThanOrEqual(55);
  });
});
