import type { Lesson } from '../types';
import { ilsLesson, rnavLesson } from './approaches';
import { autopilotLesson, directLesson, radiosLesson, vorLesson } from './basics';
import { pilotHoldLesson, publishedHoldLesson } from './holding';
import { partialPanelLesson } from './partialPanel';

/** The syllabus, in the order a student works through it. */
export const LESSONS: readonly Lesson[] = [
  radiosLesson,
  directLesson,
  autopilotLesson,
  vorLesson,
  rnavLesson,
  ilsLesson,
  publishedHoldLesson,
  pilotHoldLesson,
  partialPanelLesson,
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
