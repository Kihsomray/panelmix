import type { PanelInfo } from '../../devices/types';
import { useSim } from '../../sim/hooks';
import { useShell, useStore } from '../context';
import { Icon } from '../Icon';
import { stepsFor } from './families';
import { checkContext, currentStep, holdProgress, textOf } from './runner';

/*
 * The lesson in progress, one line above the sim bar: the current step, a
 * check mark as each one is done, and a tap to open the full lesson.
 */

/** How long a completed step is shown before the next one, sim seconds. */
const FLASH_S = 2.5;

export function LessonStrip({ panel, onOpen }: { panel: PanelInfo; onOpen: () => void }) {
  const { state, derived } = useSim();
  const { lessons } = useShell();
  const run = useStore(lessons, () => lessons.run);
  const lesson = lessons.lesson;
  if (!lesson || !run) return null;

  const steps = stepsFor(lesson.steps, panel);
  const cur = currentStep(lesson, run, panel);
  const ctx = checkContext(run, { state, derived, panel });
  const done = new Set(run.results.map((r) => r.id));
  const last = run.results[run.results.length - 1];
  const finished = run.finishedAt !== null;
  const flash = !!last && state.time >= last.at && state.time - last.at < FLASH_S;
  const lastStep = last && lesson.steps.find((s) => s.id === last.id);
  const title = cur ? textOf(cur.step.title, ctx) : '';
  const progress = cur ? holdProgress(cur.step, run, state.time) : null;

  const text = finished
    ? `${lesson.title}: complete. Open the debrief.`
    : flash && lastStep
      ? `Done: ${textOf(lastStep.title, ctx)}`
      : title;

  return (
    <div class="lsn-strip-wrap">
      <button
        type="button"
        class={`lsn-strip${flash || finished ? ' is-done' : ''}`}
        onClick={onOpen}
        aria-label={finished ? `${lesson.title} complete. Open the debrief.` : `Lesson, step ${(cur?.index ?? 0) + 1} of ${steps.length}: ${title}. Open the lesson.`}
      >
        <span class="lsn-strip-mark" aria-hidden="true">
          {flash || finished ? <Icon name="check" /> : `${(cur?.index ?? 0) + 1}/${steps.length}`}
        </span>
        <span class="lsn-strip-text">{text}</span>
        <span class="lsn-strip-dots" aria-hidden="true">
          {steps.map((s) => (
            <i key={s.id} class={done.has(s.id) ? 'is-done' : s.id === cur?.step.id ? 'is-current' : ''} />
          ))}
        </span>
        {progress !== null && (
          <span class="lsn-strip-hold" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </button>
      <span class="sr-only" aria-live="polite">
        {flash && lastStep ? `Step done: ${textOf(lastStep.title, ctx)}` : finished ? `${lesson.title} complete` : ''}
      </span>
    </div>
  );
}
