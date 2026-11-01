import { describe, expect, it } from 'vitest';
import type { SimState } from '../../sim/types';
import { G5_PANEL, live, STEAM_PANEL, stateWith } from '../testFixtures';
import * as c from './checks';
import { EMPTY_PROGRESS, loadProgress, recordFinish, saveProgress } from './progress';
import { advance, complete, currentStep, debrief, formatDuration, holdProgress, markAssisted, startRun, textOf, type LessonRun } from './runner';
import { LessonStore } from './store';
import type { Lesson } from './types';

/*
 * A small lesson: swap to 121.5, squawk 4521 and keep it for 10 s, and a
 * step that only steam panels get.
 */
const LESSON: Lesson = {
  id: 'test',
  title: 'Test lesson',
  summary: 'For the tests.',
  minutes: 1,
  setup: [],
  steps: [
    { id: 'com', title: 'Make 121.500 active', check: c.comActive(0, 121500) },
    { id: 'squawk', title: ({ state }) => `Squawk 4521 (now ${state.xpdr.code})`, check: c.squawk('4521'), holdSec: 10 },
    { id: 'steam-only', title: 'Only on steam', check: c.xpdrMode('ALT'), when: (p) => p.pfd === 'steam' },
  ],
  monitors: [
    {
      id: 'bank',
      label: 'Steepest bank',
      during: ['squawk'],
      sample: ({ state }) => Math.abs(state.aircraft.bankDeg),
      format: (v) => `${Math.round(v)} degrees`,
      limit: 30,
    },
  ],
  tips: ['Tip one.'],
};

const at = (time: number, patch: (s: SimState) => SimState = (s) => s): SimState => stateWith((s) => patch({ ...s, time }));
const com121 = (s: SimState): SimState => ({ ...s, radios: { ...s.radios, com: [{ activeKhz: 121500, standbyKhz: 126100 }, s.radios.com[1]] } });
const squawking = (s: SimState): SimState => ({ ...com121(s), xpdr: { ...s.xpdr, code: '4521' } });
const banked = (deg: number) => (s: SimState): SimState => ({ ...squawking(s), aircraft: { ...s.aircraft, bankDeg: deg } });

describe('lesson runner', () => {
  it('waits on the current step and moves on when its check passes', () => {
    let run = startRun(LESSON, live(at(0)));
    expect(currentStep(LESSON, run, G5_PANEL)).toMatchObject({ index: 0, total: 2 });
    // Nothing done: the same object comes back (no re-render, no save).
    expect(advance(LESSON, run, live(at(1)))).toBe(run);
    run = advance(LESSON, run, live(at(2, com121)));
    expect(run.results).toEqual([{ id: 'com', at: 2, how: 'done' }]);
    expect(run.stepStart.time).toBe(2);
    expect(currentStep(LESSON, run, G5_PANEL)?.step.id).toBe('squawk');
  });

  it('a held step needs its condition for the whole time, and starts over when it slips', () => {
    let run = advance(LESSON, startRun(LESSON, live(at(0))), live(at(1, com121)));
    run = advance(LESSON, run, live(at(10, squawking)));
    expect(run.passingSince).toBe(10);
    run = advance(LESSON, run, live(at(15, squawking)));
    expect(holdProgress(LESSON.steps[1]!, run, 15)).toBeCloseTo(0.5, 6);
    expect(run.results).toHaveLength(1);
    // The code changes for a moment: the timer resets.
    run = advance(LESSON, run, live(at(16, com121)));
    expect(run.passingSince).toBeNull();
    run = advance(LESSON, run, live(at(17, squawking)));
    run = advance(LESSON, run, live(at(26.9, squawking)));
    expect(run.results).toHaveLength(1);
    run = advance(LESSON, run, live(at(27, squawking)));
    // Done, and with no steam step on a G5 panel the lesson is finished.
    expect(run.results.map((r) => r.id)).toEqual(['com', 'squawk']);
    expect(run.finishedAt).toBe(27);
    expect(advance(LESSON, run, live(at(30, squawking)))).toBe(run);
  });

  it('includes panel-specific steps only on that panel', () => {
    const steam = (t: number) => live(at(t), {}, STEAM_PANEL);
    let run = startRun(LESSON, steam(0));
    expect(currentStep(LESSON, run, STEAM_PANEL)?.total).toBe(3);
    run = complete(LESSON, run, steam(1), 'skipped');
    run = complete(LESSON, run, steam(2), 'skipped');
    expect(run.finishedAt).toBeNull();
    expect(currentStep(LESSON, run, STEAM_PANEL)?.step.id).toBe('steam-only');
  });

  it('records assisted and skipped steps', () => {
    let run = markAssisted(startRun(LESSON, live(at(0))));
    run = advance(LESSON, run, live(at(1, com121)));
    expect(run.results[0]!.how).toBe('assisted');
    expect(run.assisted).toBe(false);
    run = complete(LESSON, run, live(at(2, com121)), 'skipped');
    expect(run.results.map((r) => r.how)).toEqual(['assisted', 'skipped']);
    expect(run.finishedAt).toBe(2);
  });

  it('times the step afresh if the clock goes back (session reset)', () => {
    let run = advance(LESSON, startRun(LESSON, live(at(100))), live(at(101, com121)));
    run = advance(LESSON, run, live(at(105, squawking)));
    run = advance(LESSON, run, live(at(3, squawking)));
    expect(run.stepStart.time).toBe(3);
    expect(run.passingSince).toBe(3);
  });

  it('keeps the worst monitor value, only during its steps', () => {
    let run = startRun(LESSON, live(at(0, (s) => ({ ...s, aircraft: { ...s.aircraft, bankDeg: 40 } }))));
    run = advance(LESSON, run, live(at(1, (s) => ({ ...s, aircraft: { ...s.aircraft, bankDeg: 40 } }))));
    expect(run.monitors).toEqual({});
    run = advance(LESSON, run, live(at(2, com121)));
    run = advance(LESSON, run, live(at(3, banked(-25))));
    run = advance(LESSON, run, live(at(4, banked(12))));
    expect(run.monitors).toEqual({ bank: 25 });
  });

  it('evaluates text from the state', () => {
    const input = live(at(0, squawking));
    const ctx = { ...input, stepStart: startRun(LESSON, input).stepStart };
    expect(textOf(LESSON.steps[1]!.title, ctx)).toBe('Squawk 4521 (now 4521)');
    expect(textOf(undefined, ctx)).toBe('');
    expect(textOf(() => { throw new Error('no data yet'); }, ctx)).toBe('');
  });
});

describe('debrief', () => {
  const finish = (bank: number, how: 'done' | 'skipped' = 'done'): LessonRun => {
    let run = advance(LESSON, startRun(LESSON, live(at(0))), live(at(65, com121)));
    run = advance(LESSON, run, live(at(70, banked(bank))));
    return how === 'done' ? advance(LESSON, run, live(at(80, banked(bank)))) : complete(LESSON, run, live(at(80, banked(bank))), 'skipped');
  };

  it('a clean run is well flown', () => {
    const d = debrief(LESSON, finish(20));
    expect(d).toMatchObject({ headline: 'Well flown', durationSec: 80, done: 2, assisted: 0, skipped: 0, clean: true });
    expect(d.lines).toEqual([{ label: 'Steepest bank', value: '20 degrees', ok: true }]);
    expect(d.tips).toEqual(['Tip one.']);
  });

  it('a measurement over its limit asks for another try; help is noted', () => {
    expect(debrief(LESSON, finish(35)).headline).toBe('Done: worth another try');
    expect(debrief(LESSON, finish(20, 'skipped'))).toMatchObject({ headline: 'Done, with some help', skipped: 1, clean: false });
  });

  it('formats durations', () => {
    expect([0, 65, 600, 3725].map(formatDuration)).toEqual(['0:00', '1:05', '10:00', '1:02:05']);
  });
});

describe('progress storage', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
  };
  const known = new Set(['test']);

  it('round-trips records and the lesson in progress', () => {
    const store = memory();
    let run = advance(LESSON, startRun(LESSON, live(at(0))), live(at(5, com121)));
    run = advance(LESSON, run, live(at(6, squawking)));
    saveProgress({ v: 1, records: { test: { completions: 2, bestSec: 300, clean: true, lastAt: 1 } }, active: run }, store);
    const back = loadProgress(store, known);
    expect(back.records.test).toEqual({ completions: 2, bestSec: 300, clean: true, lastAt: 1 });
    expect(back.active?.results).toEqual(run.results);
    // A hold in progress is not trusted across a reload.
    expect(run.passingSince).toBe(6);
    expect(back.active?.passingSince).toBeNull();
  });

  it('drops what it does not recognise', () => {
    const store = memory();
    store.setItem('panelmix:lessons:v1', JSON.stringify({ v: 1, records: { gone: { completions: 1, bestSec: 1, clean: false, lastAt: 0 }, test: { completions: 'x' } }, active: { lessonId: 'gone' } }));
    expect(loadProgress(store, known)).toEqual(EMPTY_PROGRESS);
    store.setItem('panelmix:lessons:v1', '{not json');
    expect(loadProgress(store, known)).toEqual(EMPTY_PROGRESS);
    expect(loadProgress(undefined, known)).toEqual(EMPTY_PROGRESS);
  });

  it('records completions, the best time and whether it was ever clean', () => {
    const run = { ...startRun(LESSON, live(at(0))), finishedAt: 100 };
    let data = recordFinish(EMPTY_PROGRESS, run, debrief(LESSON, run), 1000);
    data = recordFinish(data, { ...run, finishedAt: 300 }, { ...debrief(LESSON, run), durationSec: 300, clean: false }, 2000);
    expect(data.records.test).toEqual({ completions: 2, bestSec: 100, clean: true, lastAt: 2000 });
  });
});

describe('lesson store', () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
  };

  it('runs a lesson from start to the records, telling listeners about steps', () => {
    const s = storage();
    const store = new LessonStore([LESSON], s);
    let heard = 0;
    store.subscribe(() => heard++);
    store.start(LESSON, live(at(0)));
    store.tick(live(at(1)));
    expect(heard).toBe(1);
    store.tick(live(at(2, com121)));
    expect(heard).toBe(2);
    store.tick(live(at(3, squawking)));
    store.tick(live(at(13, squawking)));
    expect(store.run?.finishedAt).toBe(13);
    expect(store.records.test?.completions).toBe(1);
    // A new store reads it all back.
    const again = new LessonStore([LESSON], s);
    expect(again.records.test?.completions).toBe(1);
    expect(again.lesson?.id).toBe('test');
    again.close();
    expect(again.run).toBeNull();
  });

  it('skips and marks assisted steps', () => {
    const store = new LessonStore([LESSON], storage());
    store.start(LESSON, live(at(0)));
    store.markAssisted();
    expect(store.run?.assisted).toBe(true);
    store.skip(live(at(1)));
    expect(store.run?.results).toEqual([{ id: 'com', at: 1, how: 'skipped' }]);
  });
});
