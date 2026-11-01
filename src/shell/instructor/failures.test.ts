import { describe, expect, it } from 'vitest';
import type { SimCommand } from '../../sim/commands';
import { initialSystemsState } from '../../sim/systems';
import { G1000_PANEL, G5_PANEL, STEAM_PANEL } from '../testFixtures';
import {
  actionLabel,
  activeFailures,
  failureCommand,
  FAILURES,
  formatCountdown,
  pickSurprise,
  schedule,
  surprisePool,
  takeDue,
  type FailureAction,
} from './failures';
import { InstructorStore } from './store';
import { aloftRows, altimeterErrorFt, presetLayers, WEATHER_PRESETS, withAloft } from './weather';

const VACUUM: FailureAction = { kind: 'fail', failure: 'vacuum', failed: true };
const GPS: FailureAction = { kind: 'fail', failure: 'gps', failed: true };
const ROUGH: FailureAction = { kind: 'engine', condition: 'rough' };

describe('failure catalog', () => {
  it('covers every boolean failure in the contract', () => {
    const keys = Object.keys(initialSystemsState().failures).filter((k) => k !== 'engine').sort();
    expect(FAILURES.map((f) => f.id).sort()).toEqual(keys);
  });

  it('knows which failures matter on which panel', () => {
    const vac = FAILURES.find((f) => f.id === 'vacuum')!;
    const ahrs = FAILURES.find((f) => f.id === 'ahrs')!;
    const pfd = FAILURES.find((f) => f.id === 'pfdDisplay')!;
    expect([vac.appliesTo(STEAM_PANEL), vac.appliesTo(G5_PANEL)]).toEqual([true, false]);
    expect([ahrs.appliesTo(STEAM_PANEL), ahrs.appliesTo(G5_PANEL)]).toEqual([false, true]);
    expect([pfd.appliesTo(G5_PANEL), pfd.appliesTo(G1000_PANEL)]).toEqual([false, true]);
  });

  it('turns actions into the contract commands and words', () => {
    expect(failureCommand(VACUUM)).toEqual({ type: 'failure.set', failure: 'vacuum', failed: true });
    expect(failureCommand(ROUGH)).toEqual({ type: 'failure.engine', condition: 'rough' });
    expect(actionLabel(VACUUM)).toBe('Vacuum pump fails');
    expect(actionLabel({ kind: 'fail', failure: 'gps', failed: false })).toBe('GPS restored');
    expect(actionLabel({ kind: 'engine', condition: 'failed' })).toBe('Engine fails');
  });

  it('lists what is failed now', () => {
    const f = { ...initialSystemsState().failures, vacuum: true, gps: true, engine: 'rough' as const };
    expect(activeFailures(f)).toEqual(['Vacuum pump', 'GPS', 'Engine rough']);
    expect(activeFailures(initialSystemsState().failures)).toEqual([]);
  });
});

describe('failure schedule', () => {
  it('keeps the schedule in time order and fires what is due', () => {
    let list = schedule([], GPS, 100, 300);
    list = schedule(list, VACUUM, 100, 60);
    expect(list.map((p) => p.at)).toEqual([160, 400]);
    const { due, rest } = takeDue(list, 160);
    expect(due.map((p) => p.action)).toEqual([VACUUM]);
    expect(rest.map((p) => p.action)).toEqual([GPS]);
  });

  it('a new time for the same failure replaces the old one, surprises stack', () => {
    let list = schedule([], VACUUM, 0, 300);
    list = schedule(list, VACUUM, 0, 30);
    expect(list).toHaveLength(1);
    expect(list[0]!.at).toBe(30);
    list = schedule(list, VACUUM, 0, 90, 300);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((p) => p.id)).size).toBe(2);
    // A surprise shows only its window, never the moment.
    expect(list.find((p) => p.surprise)).toMatchObject({ at: 90, until: 300 });
  });

  it('springs surprises only from failures that matter and are not failed yet', () => {
    const f = initialSystemsState().failures;
    const steam = surprisePool(STEAM_PANEL, f);
    expect(steam).toContainEqual(VACUUM);
    expect(steam).not.toContainEqual({ kind: 'fail', failure: 'ahrs', failed: true });
    expect(steam).toContainEqual(ROUGH);
    expect(surprisePool(G5_PANEL, { ...f, ahrs: true })).not.toContainEqual({ kind: 'fail', failure: 'ahrs', failed: true });
    // The displays and a dead engine are left to the instructor to choose.
    expect(surprisePool(G1000_PANEL, f).some((a) => a.kind === 'fail' && a.failure === 'pfdDisplay')).toBe(false);
    expect(surprisePool(G1000_PANEL, f).some((a) => a.kind === 'engine' && a.condition === 'failed')).toBe(false);
  });

  it('picks a surprise at a random time inside the window, never in the first 20 s', () => {
    const pool = [VACUUM, GPS, ROUGH];
    expect(pickSurprise(pool, 1000, 300, () => 0)).toEqual({ action: VACUUM, at: 1020 });
    expect(pickSurprise(pool, 1000, 300, () => 0.999)!.action).toEqual(ROUGH);
    expect(pickSurprise(pool, 1000, 300, () => 0.999)!.at).toBeCloseTo(1000 + 20 + 0.999 * 280, 6);
    expect(pickSurprise([], 0, 300, () => 0.5)).toBeNull();
  });

  it('formats the countdown', () => {
    expect([0, 9.2, 65, 600].map(formatCountdown)).toEqual(['0:00', '0:10', '1:05', '10:00']);
  });
});

describe('instructor store', () => {
  const run = (store: InstructorStore, now: number) => {
    const sent: SimCommand[] = [];
    store.tick(now, (c) => sent.push(c));
    return sent;
  };

  it('fires scheduled failures on simulation time, once', () => {
    const store = new InstructorStore();
    store.schedule(VACUUM, 10, 30);
    expect(run(store, 39)).toEqual([]);
    expect(run(store, 40)).toEqual([{ type: 'failure.set', failure: 'vacuum', failed: true }]);
    expect(run(store, 41)).toEqual([]);
    expect(store.lastFired).toMatchObject({ label: 'Vacuum pump fails', at: 40, surprise: false });
  });

  it('keeps the remaining delay when the session restarts at time zero', () => {
    const store = new InstructorStore();
    run(store, 500);
    store.schedule(GPS, 500, 60);
    // Reset: the clock is back at 0; the failure is still 60 s away, not 560.
    expect(run(store, 0)).toEqual([]);
    expect(run(store, 59)).toEqual([]);
    expect(run(store, 60.5)).toEqual([{ type: 'failure.set', failure: 'gps', failed: true }]);
  });

  it('arms surprises, cancels and clears, and tells listeners', () => {
    const store = new InstructorStore();
    let heard = 0;
    store.subscribe(() => heard++);
    expect(store.armSurprise([GPS], 0, 120, () => 0.5)).toBe(true);
    expect(store.list[0]).toMatchObject({ surprise: true, action: GPS, at: 70, until: 120 });
    store.cancel(store.list[0]!.id);
    expect(store.list).toHaveLength(0);
    store.schedule(VACUUM, 0, 10);
    store.clear();
    expect(store.list).toHaveLength(0);
    expect(heard).toBe(4);
    expect(store.armSurprise([], 0, 120)).toBe(false);
  });
});

describe('weather', () => {
  const surface = { fromTrue: 280, kt: 10 };

  it('shows unset levels with the wind below them', () => {
    expect(aloftRows([], surface)).toEqual([
      { altitudeFt: 3000, fromTrue: 280, kt: 10, set: false },
      { altitudeFt: 6000, fromTrue: 280, kt: 10, set: false },
      { altitudeFt: 9000, fromTrue: 280, kt: 10, set: false },
    ]);
    const rows = aloftRows([{ altitudeFt: 6000, fromTrue: 300, kt: 25 }], surface);
    expect(rows.map((r) => [r.fromTrue, r.kt, r.set])).toEqual([
      [280, 10, false],
      [300, 25, true],
      [300, 25, false],
    ]);
  });

  it('editing one level sets the whole forecast', () => {
    const layers = withAloft(aloftRows([], surface), 9000, { fromTrue: 365, kt: 41.4 });
    expect(layers).toEqual([
      { altitudeFt: 3000, fromTrue: 280, kt: 10 },
      { altitudeFt: 6000, fromTrue: 280, kt: 10 },
      { altitudeFt: 9000, fromTrue: 5, kt: 41 },
    ]);
  });

  it('presets cover 3,000, 6,000 and 9,000 ft', () => {
    for (const p of WEATHER_PRESETS) expect(presetLayers(p).map((l) => l.altitudeFt)).toEqual([3000, 6000, 9000]);
  });

  it('reads about 1,000 ft per inch of altimeter error', () => {
    expect(altimeterErrorFt(30.12, 29.87)).toBe(250);
    expect(altimeterErrorFt(29.92, 30.12)).toBe(-200);
  });
});
