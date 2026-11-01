import { LESSONS } from './catalog';
import { loadProgress, recordFinish, saveProgress, type ProgressData } from './progress';
import { advance, complete, debrief, markAssisted, startRun, type LessonRun, type LiveInput } from './runner';
import type { Lesson } from './types';

/*
 * The lesson in progress and the progress records, for the whole session.
 * Ticked on every simulator frame by the cockpit; the lessons tab and the
 * strip above the sim bar read it. Listeners hear about step changes, not
 * every frame (components that show timers re-render with the sim anyway).
 */

/** Hold timers and monitors change every frame; save them only this often (sim seconds). */
const SAVE_EVERY_S = 10;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export class LessonStore {
  private data: ProgressData;
  private savedAt = -Infinity;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly lessons: readonly Lesson[] = LESSONS,
    private readonly storage: Storage | undefined = safeStorage(),
  ) {
    this.data = loadProgress(storage, new Set(lessons.map((l) => l.id)));
  }

  get run(): LessonRun | null {
    return this.data.active;
  }

  get lesson(): Lesson | null {
    const r = this.data.active;
    return (r && this.find(r.lessonId)) ?? null;
  }

  get records(): ProgressData['records'] {
    return this.data.records;
  }

  find(id: string): Lesson | undefined {
    return this.lessons.find((l) => l.id === id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(data: ProgressData) {
    this.data = data;
    saveProgress(data, this.storage);
    for (const l of this.listeners) l();
  }

  start(lesson: Lesson, input: LiveInput): void {
    this.savedAt = input.state.time;
    this.commit({ ...this.data, active: startRun(lesson, input) });
  }

  /** Leaves the lesson, or closes its debrief. */
  close(): void {
    if (this.data.active) this.commit({ ...this.data, active: null });
  }

  skip(input: LiveInput): void {
    const l = this.lesson;
    const r = this.run;
    if (l && r) this.apply(l, complete(l, r, input, 'skipped'), input);
  }

  /** The pilot pressed "Do it for me": the step counts as assisted when it completes. */
  markAssisted(): void {
    const r = this.run;
    if (r && !r.assisted) this.commit({ ...this.data, active: markAssisted(r) });
  }

  tick(input: LiveInput): void {
    const l = this.lesson;
    const r = this.run;
    if (!l || !r || r.finishedAt !== null) return;
    this.apply(l, advance(l, r, input), input);
  }

  private apply(lesson: Lesson, next: LessonRun, input: LiveInput) {
    const prev = this.data.active;
    if (!prev || next === prev) return;
    let data: ProgressData = { ...this.data, active: next };
    if (next.finishedAt !== null && prev.finishedAt === null) data = recordFinish(data, next, debrief(lesson, next), Date.now());
    if (next.results.length !== prev.results.length || next.finishedAt !== prev.finishedAt) {
      this.savedAt = input.state.time;
      this.commit(data);
      return;
    }
    this.data = data;
    if (Math.abs(input.state.time - this.savedAt) >= SAVE_EVERY_S) {
      this.savedAt = input.state.time;
      saveProgress(data, this.storage);
    }
  }
}
