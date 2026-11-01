import type { PanelInfo } from '../../devices/types';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import { stepsFor } from './families';
import type { CheckContext, Lesson, LessonStep, Monitor, StepStart, Text } from './types';

/*
 * A lesson in progress, as a pure state machine advanced once per
 * simulator frame. The current step is the first one not yet done (so a
 * lesson still makes sense if the panel changes and steps appear or go).
 * A step completes when its check holds for `holdSec`; the next one starts
 * fresh with a snapshot of where the airplane is.
 *
 * Times are simulation seconds: pausing pauses the lesson too.
 */

export type StepOutcome = 'done' | 'assisted' | 'skipped';

export interface StepResult {
  readonly id: string;
  readonly at: number;
  readonly how: StepOutcome;
}

export interface LessonRun {
  readonly lessonId: string;
  readonly startedAt: number;
  readonly results: readonly StepResult[];
  readonly stepStart: StepStart;
  /** Since when the current step's check has held, for steps that must be held. */
  readonly passingSince: number | null;
  /** The pilot used "Do it for me" on the current step. */
  readonly assisted: boolean;
  /** The worst value of each monitor so far. */
  readonly monitors: Readonly<Record<string, number>>;
  readonly finishedAt: number | null;
}

export interface LiveInput {
  readonly state: SimState;
  readonly derived: Derived;
  readonly panel: PanelInfo;
}

export function snapshot({ state, derived }: LiveInput): StepStart {
  return {
    time: state.time,
    altitudeFt: derived.indicatedAltitudeFt,
    headingMag: derived.headingMag,
    lat: state.aircraft.lat,
    lon: state.aircraft.lon,
  };
}

export function startRun(lesson: Lesson, input: LiveInput): LessonRun {
  return {
    lessonId: lesson.id,
    startedAt: input.state.time,
    results: [],
    stepStart: snapshot(input),
    passingSince: null,
    assisted: false,
    monitors: {},
    finishedAt: null,
  };
}

export interface CurrentStep {
  readonly step: LessonStep;
  readonly index: number;
  readonly total: number;
}

export function currentStep(lesson: Lesson, run: LessonRun, panel: PanelInfo): CurrentStep | null {
  const steps = stepsFor(lesson.steps, panel);
  const done = new Set(run.results.map((r) => r.id));
  const index = steps.findIndex((s) => !done.has(s.id));
  return index < 0 ? null : { step: steps[index]!, index, total: steps.length };
}

export function checkContext(run: LessonRun, input: LiveInput): CheckContext {
  return { ...input, stepStart: run.stepStart };
}

/** A check that throws (data still loading, a contract field not filled yet) counts as not done. */
export function passes(step: LessonStep, ctx: CheckContext): boolean {
  try {
    return step.check(ctx);
  } catch {
    return false;
  }
}

export function textOf(t: Text | undefined, ctx: CheckContext): string {
  if (t === undefined) return '';
  if (typeof t === 'string') return t;
  try {
    return t(ctx);
  } catch {
    return '';
  }
}

function sampleMonitors(
  monitors: readonly Monitor[] | undefined,
  prev: Readonly<Record<string, number>>,
  ctx: CheckContext,
  stepId: string,
): Readonly<Record<string, number>> {
  if (!monitors || monitors.length === 0) return prev;
  let out: Record<string, number> | null = null;
  for (const m of monitors) {
    if (m.during && !m.during.includes(stepId)) continue;
    let v: number | null;
    try {
      v = m.sample(ctx);
    } catch {
      v = null;
    }
    if (v === null || !Number.isFinite(v)) continue;
    const old = (out ?? prev)[m.id];
    if (old === undefined || v > old) {
      out ??= { ...prev };
      out[m.id] = v;
    }
  }
  return out ?? prev;
}

/** One frame: sample the monitors, check the current step, complete it when it has held. */
export function advance(lesson: Lesson, run: LessonRun, input: LiveInput): LessonRun {
  if (run.finishedAt !== null) return run;
  const now = input.state.time;
  let r = run;
  // The clock went back (session reset, or a reload from an older save): time the step afresh.
  if (now < r.stepStart.time || (r.passingSince !== null && now < r.passingSince)) {
    r = { ...r, stepStart: snapshot(input), passingSince: null };
  }
  const cur = currentStep(lesson, r, input.panel);
  if (!cur) return { ...r, finishedAt: now };
  const ctx = checkContext(r, input);
  const monitors = sampleMonitors(lesson.monitors, r.monitors, ctx, cur.step.id);
  if (monitors !== r.monitors) r = { ...r, monitors };
  if (!passes(cur.step, ctx)) return r.passingSince === null ? r : { ...r, passingSince: null };
  const since = r.passingSince ?? now;
  if (now - since < (cur.step.holdSec ?? 0)) return r.passingSince === since ? r : { ...r, passingSince: since };
  return complete(lesson, r, input, r.assisted ? 'assisted' : 'done');
}

/** Marks the current step done (or skipped) and moves on. */
export function complete(lesson: Lesson, run: LessonRun, input: LiveInput, how: StepOutcome): LessonRun {
  if (run.finishedAt !== null) return run;
  const cur = currentStep(lesson, run, input.panel);
  if (!cur) return run;
  const now = input.state.time;
  const next: LessonRun = {
    ...run,
    results: [...run.results, { id: cur.step.id, at: now, how }],
    stepStart: snapshot(input),
    passingSince: null,
    assisted: false,
  };
  return currentStep(lesson, next, input.panel) ? next : { ...next, finishedAt: now };
}

export function markAssisted(run: LessonRun): LessonRun {
  return run.assisted ? run : { ...run, assisted: true };
}

/** 0..1 through a step that must be held, or null for steps that complete at once. */
export function holdProgress(step: LessonStep, run: LessonRun, now: number): number | null {
  if (!step.holdSec) return null;
  if (run.passingSince === null) return 0;
  return Math.min(Math.max((now - run.passingSince) / step.holdSec, 0), 1);
}

// Debrief --------------------------------------------------------------------

export interface DebriefLine {
  readonly label: string;
  readonly value: string;
  /** Within the limit, over it, or no limit. */
  readonly ok: boolean | null;
}

export interface Debrief {
  readonly headline: string;
  readonly durationSec: number;
  readonly done: number;
  readonly assisted: number;
  readonly skipped: number;
  readonly lines: readonly DebriefLine[];
  readonly tips: readonly string[];
  /** Every step by the pilot and every measurement within its limit. */
  readonly clean: boolean;
}

export function debrief(lesson: Lesson, run: LessonRun): Debrief {
  const count = (how: StepOutcome) => run.results.filter((r) => r.how === how).length;
  const lines: DebriefLine[] = (lesson.monitors ?? []).map((m) => {
    const v = run.monitors[m.id];
    if (v === undefined) return { label: m.label, value: 'Not measured', ok: null };
    return { label: m.label, value: m.format(v), ok: m.limit === undefined ? null : v <= m.limit + 1e-9 };
  });
  const done = count('done');
  const assisted = count('assisted');
  const skipped = count('skipped');
  const over = lines.some((l) => l.ok === false);
  const clean = assisted === 0 && skipped === 0 && !over;
  const headline = clean ? 'Well flown' : over ? 'Done: worth another try' : 'Done, with some help';
  return {
    headline,
    durationSec: Math.max((run.finishedAt ?? run.startedAt) - run.startedAt, 0),
    done,
    assisted,
    skipped,
    lines,
    tips: lesson.tips,
    clean,
  };
}

/** "4:05" (sim time). */
export function formatDuration(sec: number): string {
  const s = Math.max(Math.round(sec), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
