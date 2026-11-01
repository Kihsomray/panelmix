import { useEffect, useRef, useState } from 'preact/hooks';
import type { PanelInfo } from '../../devices/types';
import type { SimCommand } from '../../sim/commands';
import { useSim, useSimulator } from '../../sim/hooks';
import { useSessionState, useShell, useStore } from '../context';
import { Icon } from '../Icon';
import { hintsFor, stepsFor } from './families';
import { launchLesson, lessonEnv } from './launch';
import type { LessonRecord } from './progress';
import {
  checkContext,
  currentStep,
  debrief,
  formatDuration,
  holdProgress,
  snapshot,
  textOf,
  type LessonRun,
  type LiveInput,
} from './runner';
import type { CheckContext, Lesson, LessonEnv, LessonStep } from './types';

/*
 * The Lessons tab: the syllabus, a lesson's briefing, the lesson in progress
 * with live check marks and per-unit hints, and the debrief.
 */

export function LessonsPanel({ panel }: { panel: PanelInfo }) {
  const sim = useSimulator();
  const { state, derived } = useSim();
  const { lessons, instructor } = useShell();
  const run = useStore(lessons, () => lessons.run);
  const lesson = lessons.lesson;
  const [browsing, setBrowsing] = useSessionState('lsn.browse', '');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const input: LiveInput = { state, derived, panel };
  const env = lessonEnv(sim, panel);

  const start = (l: Lesson, withSetup: boolean) => {
    setBusy(true);
    void launchLesson(l, withSetup, { sim, lessons, instructor, panel })
      .then((p) => {
        setProblems(p);
        setBrowsing('');
      })
      .finally(() => setBusy(false));
  };
  const assist = (cmds: readonly SimCommand[]) => {
    lessons.markAssisted();
    for (const c of cmds) sim.dispatch(c);
  };
  const browse = (id: string) => {
    setProblems([]);
    setBrowsing(id);
  };

  let body;
  if (lesson && run && run.finishedAt !== null) {
    const next = lessons.lessons[lessons.lessons.indexOf(lesson) + 1];
    const openNext = (l: Lesson) => {
      lessons.close();
      browse(l.id);
    };
    body = (
      <DebriefView
        lesson={lesson}
        run={run}
        panel={panel}
        onAgain={() => start(lesson, true)}
        {...(next && { next, onNext: () => openNext(next) })}
        onClose={() => lessons.close()}
      />
    );
  } else if (lesson && run) {
    body = (
      <ActiveLesson
        lesson={lesson}
        run={run}
        input={input}
        env={env}
        onAssist={assist}
        onSkip={() => lessons.skip(input)}
        onRestart={() => start(lesson, true)}
        onQuit={() => lessons.close()}
      />
    );
  } else {
    const picked = browsing ? lessons.find(browsing) : undefined;
    body = picked ? (
      <LessonDetail
        lesson={picked}
        env={env}
        ctx={{ ...input, stepStart: snapshot(input) }}
        record={lessons.records[picked.id]}
        busy={busy}
        onBack={() => browse('')}
        onStart={(withSetup) => start(picked, withSetup)}
      />
    ) : (
      <LessonList lessons={lessons.lessons} records={lessons.records} env={env} onPick={browse} />
    );
  }

  return (
    <div class="drawer-body lsn">
      {problems.length > 0 && (
        <div class="lsn-problems" role="alert">
          <Icon name="alert" />
          <div>
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      )}
      {body}
    </div>
  );
}

function LessonList({
  lessons,
  records,
  env,
  onPick,
}: {
  lessons: readonly Lesson[];
  records: Readonly<Record<string, LessonRecord>>;
  env: LessonEnv;
  onPick: (id: string) => void;
}) {
  const done = lessons.filter((l) => records[l.id]).length;
  return (
    <>
      <div class="lsn-head">
        <div>
          <h3>Lessons</h3>
          <p class="sim-ap-note">Guided exercises, checked live against the simulator. The hints follow the units in your panel.</p>
        </div>
        <span class="lsn-count">
          {done} of {lessons.length} done
        </span>
      </div>
      <ol class="lsn-list">
        {lessons.map((l, i) => {
          const rec = records[l.id];
          const why = l.unavailable?.(env) ?? null;
          return (
            <li key={l.id}>
              <button type="button" class={`lsn-item${rec ? ' is-done' : ''}`} onClick={() => onPick(l.id)}>
                <span class="lsn-mark" aria-hidden="true">
                  {rec ? <Icon name="check" /> : i + 1}
                </span>
                <span class="lsn-item-text">
                  <strong>{l.title}</strong>
                  <small>{l.summary}</small>
                  {why && <small class="lsn-warn">{why}</small>}
                </span>
                <span class="lsn-meta">{rec ? (rec.clean ? 'Well flown' : 'Done') : `${l.minutes} min`}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function LessonDetail({
  lesson,
  env,
  ctx,
  record,
  busy,
  onBack,
  onStart,
}: {
  lesson: Lesson;
  env: LessonEnv;
  ctx: CheckContext;
  record: LessonRecord | undefined;
  busy: boolean;
  onBack: () => void;
  onStart: (withSetup: boolean) => void;
}) {
  const why = lesson.unavailable?.(env) ?? null;
  const steps = stepsFor(lesson.steps, env.panel);
  return (
    <div class="lsn-detail">
      <button type="button" class="link-btn lsn-back" onClick={onBack}>
        <Icon name="back" /> All lessons
      </button>
      <div class="lsn-head">
        <div>
          <h3>{lesson.title}</h3>
          <p class="lsn-summary">{lesson.summary}</p>
        </div>
        <span class="lsn-count">
          {record ? `Done ${record.completions}x${record.bestSec !== null ? `, best ${formatDuration(record.bestSec)}` : ''}` : `About ${lesson.minutes} min`}
        </span>
      </div>
      {why && (
        <p class="lsn-warn lsn-warn-box">
          <Icon name="alert" /> {why}
        </p>
      )}
      <div class="lsn-cols">
        <section>
          <h4>Steps</h4>
          <ol class="lsn-preview">
            {steps.map((s) => (
              <li key={s.id}>{textOf(s.title, ctx)}</li>
            ))}
          </ol>
        </section>
        <section>
          <h4>Set up for you</h4>
          <ul class="lsn-setup">
            {lesson.setup.map((a) => (
              <li key={a.label}>{a.label}</li>
            ))}
          </ul>
          <p class="sim-ap-note">Or start from where you are and set things up yourself. Speed up the sim (2x, 4x) for the long legs.</p>
        </section>
      </div>
      <div class="form-actions">
        <button type="button" class="pill-btn pill-primary" disabled={!!why || busy} onClick={() => onStart(true)}>
          Set up and start
        </button>
        <button type="button" class="pill-btn" disabled={busy} onClick={() => onStart(false)}>
          Start from here
        </button>
      </div>
    </div>
  );
}

function ActiveLesson({
  lesson,
  run,
  input,
  env,
  onAssist,
  onSkip,
  onRestart,
  onQuit,
}: {
  lesson: Lesson;
  run: LessonRun;
  input: LiveInput;
  env: LessonEnv;
  onAssist: (cmds: readonly SimCommand[]) => void;
  onSkip: () => void;
  onRestart: () => void;
  onQuit: () => void;
}) {
  const steps = stepsFor(lesson.steps, input.panel);
  const cur = currentStep(lesson, run, input.panel);
  const ctx = checkContext(run, input);
  const results = new Map(run.results.map((r) => [r.id, r]));
  const now = input.state.time;
  const currentRef = useRef<HTMLLIElement>(null);

  // Keep the current step in view inside the drawer as the lesson moves on.
  useEffect(() => {
    const el = currentRef.current;
    const box = el?.closest('.drawer');
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 60 || top > box.clientHeight - 120) box.scrollTop += top - 70;
  }, [cur?.step.id]);

  return (
    <div class="lsn-active">
      <div class="lsn-head">
        <div>
          <small class="lsn-eyebrow">{cur ? `Step ${cur.index + 1} of ${cur.total}` : 'Finishing'}</small>
          <h3>{lesson.title}</h3>
        </div>
        <span class="lsn-count" aria-label={`Elapsed ${formatDuration(now - run.startedAt)}`}>
          {formatDuration(now - run.startedAt)}
        </span>
      </div>
      <div class="lsn-bar" aria-hidden="true">
        <span style={{ width: `${(run.results.length / Math.max(steps.length, 1)) * 100}%` }} />
      </div>
      <ol class="lsn-steps">
        {steps.map((s, i) => {
          const res = results.get(s.id);
          const isCurrent = cur?.step.id === s.id;
          return (
            <li
              key={s.id}
              {...(isCurrent && { ref: currentRef, 'aria-current': 'step' as const })}
              class={`lsn-step${res ? ' is-done' : isCurrent ? ' is-current' : ''}`}
            >
              <span class="lsn-mark" aria-hidden="true">
                {res ? <Icon name="check" /> : i + 1}
              </span>
              <div class="lsn-step-body">
                <p class="lsn-step-title">
                  <span class="sr-only">{res ? 'Done: ' : isCurrent ? 'Now: ' : ''}</span>
                  {textOf(s.title, ctx)}
                  {res && res.how !== 'done' && <span class="lsn-how">{res.how === 'assisted' ? 'done for you' : 'skipped'}</span>}
                </p>
                {isCurrent && <StepNow key={s.id} step={s} run={run} ctx={ctx} env={env} now={now} onAssist={onAssist} onSkip={onSkip} />}
              </div>
            </li>
          );
        })}
      </ol>
      <div class="form-actions">
        <button type="button" class="pill-btn pill-sm" onClick={onRestart}>
          Restart
        </button>
        <button type="button" class="pill-btn pill-sm" onClick={onQuit}>
          End lesson
        </button>
      </div>
    </div>
  );
}

function StepNow({
  step,
  run,
  ctx,
  env,
  now,
  onAssist,
  onSkip,
}: {
  step: LessonStep;
  run: LessonRun;
  ctx: CheckContext;
  env: LessonEnv;
  now: number;
  onAssist: (cmds: readonly SimCommand[]) => void;
  onSkip: () => void;
}) {
  const hints = hintsFor(step.hints, ctx.panel);
  const progress = holdProgress(step, run, now);
  const detail = textOf(step.detail, ctx);
  let assist: readonly SimCommand[] | null = null;
  try {
    assist = step.assist?.(ctx, env) ?? null;
  } catch {
    assist = null;
  }
  return (
    <div class="lsn-now">
      {detail && <p class="lsn-detail-text">{detail}</p>}
      {progress !== null && step.holdSec && (
        <div
          class="lsn-hold"
          role="progressbar"
          aria-label="Held"
          aria-valuemin={0}
          aria-valuemax={step.holdSec}
          aria-valuenow={Math.floor(progress * step.holdSec)}
        >
          <span class="lsn-hold-track">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
          <small>
            {Math.floor(progress * step.holdSec)} of {step.holdSec} s
          </small>
        </div>
      )}
      {hints.length > 0 && (
        <details class="lsn-hints">
          <summary>How on this panel</summary>
          <dl>
            {hints.map((h) => (
              <div key={h.unit + h.text}>
                <dt>{h.unit}</dt>
                <dd>{h.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div class="lsn-step-actions">
        {assist && (
          <button type="button" class="pill-btn pill-sm" onClick={() => onAssist(assist)}>
            Do it for me
          </button>
        )}
        <button type="button" class="link-btn" onClick={onSkip}>
          Skip this step
        </button>
      </div>
    </div>
  );
}

function DebriefView({
  lesson,
  run,
  panel,
  next,
  onAgain,
  onNext,
  onClose,
}: {
  lesson: Lesson;
  run: LessonRun;
  panel: PanelInfo;
  next?: Lesson;
  onAgain: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const d = debrief(lesson, run);
  const total = stepsFor(lesson.steps, panel).length;
  return (
    <div class="lsn-debrief">
      <div class={`lsn-debrief-head${d.clean ? ' is-clean' : ''}`}>
        <span class="lsn-badge" aria-hidden="true">
          <Icon name="check" />
        </span>
        <div>
          <small class="lsn-eyebrow">Debrief</small>
          <h3>{d.headline}</h3>
          <p class="lsn-summary">{lesson.title}</p>
        </div>
      </div>
      <dl class="lsn-stats">
        <div>
          <dt>Time (sim)</dt>
          <dd>{formatDuration(d.durationSec)}</dd>
        </div>
        <div>
          <dt>By you</dt>
          <dd>
            {d.done} of {total}
          </dd>
        </div>
        {d.assisted > 0 && (
          <div>
            <dt>Done for you</dt>
            <dd>{d.assisted}</dd>
          </div>
        )}
        {d.skipped > 0 && (
          <div>
            <dt>Skipped</dt>
            <dd>{d.skipped}</dd>
          </div>
        )}
      </dl>
      {d.lines.length > 0 && (
        <ul class="lsn-results">
          {d.lines.map((l) => (
            <li key={l.label} class={l.ok === true ? 'is-good' : l.ok === false ? 'is-bad' : ''}>
              <span class="lsn-res-dot" aria-hidden="true" />
              <span class="lsn-res-label">{l.label}</span>
              <strong>{l.value}</strong>
              {l.ok !== null && <span class="sr-only">{l.ok ? 'within limits' : 'outside limits'}</span>}
            </li>
          ))}
        </ul>
      )}
      <h4>Remember</h4>
      <ul class="help-list">
        {d.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div class="form-actions">
        <button type="button" class="pill-btn pill-primary" onClick={onAgain}>
          Fly it again
        </button>
        {next && onNext && (
          <button type="button" class="pill-btn" onClick={onNext}>
            Next: {next.title}
          </button>
        )}
        <button type="button" class="pill-btn" onClick={onClose}>
          All lessons
        </button>
      </div>
    </div>
  );
}
