import type { Debrief, LessonRun, StepOutcome } from './runner';

/*
 * Lesson progress in localStorage: what has been completed (and how well),
 * and the lesson in progress so a reload carries on where it left off.
 * Anything malformed is dropped rather than trusted.
 */

const KEY = 'panelmix:lessons:v1';

export interface LessonRecord {
  readonly completions: number;
  /** Fastest completion, simulation seconds. */
  readonly bestSec: number | null;
  /** Ever flown with every step by the pilot and every measurement in limits. */
  readonly clean: boolean;
  /** Wall-clock time of the last completion (ms since 1970). */
  readonly lastAt: number;
}

export interface ProgressData {
  readonly v: 1;
  readonly records: Readonly<Record<string, LessonRecord>>;
  readonly active: LessonRun | null;
}

export const EMPTY_PROGRESS: ProgressData = { v: 1, records: {}, active: null };

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const OUTCOMES: readonly StepOutcome[] = ['done', 'assisted', 'skipped'];

function readRecord(v: unknown): LessonRecord | null {
  if (!isPlain(v) || !isNum(v.completions) || !isNum(v.lastAt) || typeof v.clean !== 'boolean') return null;
  return { completions: v.completions, bestSec: isNum(v.bestSec) ? v.bestSec : null, clean: v.clean, lastAt: v.lastAt };
}

function readRun(v: unknown, known: ReadonlySet<string>): LessonRun | null {
  if (!isPlain(v) || typeof v.lessonId !== 'string' || !known.has(v.lessonId) || !isNum(v.startedAt)) return null;
  const s = v.stepStart;
  if (!isPlain(s) || !isNum(s.time) || !isNum(s.altitudeFt) || !isNum(s.headingMag) || !isNum(s.lat) || !isNum(s.lon)) return null;
  if (!Array.isArray(v.results)) return null;
  const results = v.results.flatMap((r: unknown) =>
    isPlain(r) && typeof r.id === 'string' && isNum(r.at) && OUTCOMES.includes(r.how as StepOutcome)
      ? [{ id: r.id, at: r.at, how: r.how as StepOutcome }]
      : [],
  );
  const monitors: Record<string, number> = {};
  if (isPlain(v.monitors)) for (const [k, m] of Object.entries(v.monitors)) if (isNum(m)) monitors[k] = m;
  return {
    lessonId: v.lessonId,
    startedAt: v.startedAt,
    results,
    stepStart: { time: s.time, altitudeFt: s.altitudeFt, headingMag: s.headingMag, lat: s.lat, lon: s.lon },
    passingSince: null,
    assisted: v.assisted === true,
    monitors,
    finishedAt: isNum(v.finishedAt) ? v.finishedAt : null,
  };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined, knownLessons: ReadonlySet<string>): ProgressData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return EMPTY_PROGRESS;
    const saved: unknown = JSON.parse(raw);
    if (!isPlain(saved) || saved.v !== 1) return EMPTY_PROGRESS;
    const records: Record<string, LessonRecord> = {};
    if (isPlain(saved.records)) {
      for (const [id, r] of Object.entries(saved.records)) {
        const rec = knownLessons.has(id) ? readRecord(r) : null;
        if (rec) records[id] = rec;
      }
    }
    return { v: 1, records, active: readRun(saved.active, knownLessons) };
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function saveProgress(data: ProgressData, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: progress just isn't kept.
  }
}

/** Adds a finished lesson to the records. */
export function recordFinish(data: ProgressData, run: LessonRun, result: Debrief, nowMs: number): ProgressData {
  const old = data.records[run.lessonId];
  const best = old?.bestSec ?? null;
  const record: LessonRecord = {
    completions: (old?.completions ?? 0) + 1,
    bestSec: best === null ? result.durationSec : Math.min(best, result.durationSec),
    clean: (old?.clean ?? false) || result.clean,
    lastAt: nowMs,
  };
  return { ...data, records: { ...data.records, [run.lessonId]: record } };
}
