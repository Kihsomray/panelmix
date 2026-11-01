import type { PanelInfo } from '../../devices/types';
import type { Simulator } from '../../sim/simulator';
import type { InstructorStore } from '../instructor/store';
import { resolveSetup, setupAirports } from './setup';
import type { LessonStore } from './store';
import type { Lesson, LessonEnv } from './types';

/*
 * Starting a lesson: optionally apply its set-up (loading any procedure
 * files it needs first), then start the run from where the airplane is.
 */

export function lessonEnv(sim: Simulator, panel: PanelInfo): LessonEnv {
  return { db: sim.db, mag: sim.mag, procedures: sim.procedures, panel };
}

/** Returns what could not be set up, if anything. */
export async function launchLesson(
  lesson: Lesson,
  withSetup: boolean,
  deps: { readonly sim: Simulator; readonly lessons: LessonStore; readonly instructor: InstructorStore; readonly panel: PanelInfo },
): Promise<readonly string[]> {
  const { sim, lessons, instructor, panel } = deps;
  let problems: readonly string[] = [];
  if (withSetup) {
    for (const airport of setupAirports(lesson.setup)) await sim.procedures?.load(airport);
    const result = resolveSetup(lesson.setup, lessonEnv(sim, panel), sim.getState());
    // A lesson that brings its own surprise replaces whatever the instructor had scheduled;
    // otherwise an instructor's surprise can still spice up the lesson.
    if (result.failures.length > 0) instructor.clear();
    for (const cmd of result.commands) sim.dispatch(cmd);
    const now = sim.getState().time;
    for (const f of result.failures) instructor.schedule(f.action, now, f.delaySec, f.withinSec);
    problems = result.problems;
  }
  lessons.start(lesson, { state: sim.getState(), derived: sim.getDerived(), panel });
  return problems;
}
