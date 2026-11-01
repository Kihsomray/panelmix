import type { PanelInfo } from '../../devices/types';
import { useSim } from '../../sim/hooks';
import { useSessionState, useShell, useStore } from '../context';
import { Segmented } from '../controls';
import {
  activeFailures,
  ENGINE_CONDITIONS,
  FAILURES,
  failureCommand,
  formatCountdown,
  surprisePool,
  type FailureAction,
  type FailureInfo,
  type PendingFailure,
} from './failures';

/*
 * Fail and restore every system, now or after a delay, or arm a surprise.
 */

const DELAYS: readonly { readonly sec: number; readonly name: string }[] = [
  { sec: 0, name: 'Now' },
  { sec: 30, name: 'In 30 s' },
  { sec: 60, name: 'In 1 min' },
  { sec: 120, name: 'In 2 min' },
  { sec: 300, name: 'In 5 min' },
  { sec: 600, name: 'In 10 min' },
];

const SURPRISE_WINDOWS: readonly { readonly sec: number; readonly name: string }[] = [
  { sec: 120, name: '2 min' },
  { sec: 300, name: '5 min' },
  { sec: 600, name: '10 min' },
  { sec: 1200, name: '20 min' },
];

const pendingFor = (list: readonly PendingFailure[], match: (a: FailureAction) => boolean) => list.find((p) => !p.surprise && match(p.action));

export function FailuresTab({ panel }: { panel: PanelInfo }) {
  const { state, dispatch } = useSim();
  const { instructor } = useShell();
  const pending = useStore(instructor, () => instructor.list);
  const [delay, setDelay] = useSessionState('ins.delay', 0);
  const [within, setWithin] = useSessionState('ins.within', 300);
  const failures = state.systems.failures;
  const now = state.time;
  const active = activeFailures(failures);
  const surprises = pending.filter((p) => p.surprise);
  const delayName = DELAYS.find((d) => d.sec === delay)?.name ?? 'Now';

  const apply = (action: FailureAction) => {
    if (delay > 0) return instructor.schedule(action, now, delay);
    // Done now: a timer still pending for the same item would undo it later.
    const stale = pendingFor(pending, (a) => a.kind === action.kind && (a.kind === 'engine' || (action.kind === 'fail' && a.failure === action.failure)));
    if (stale) instructor.cancel(stale.id);
    dispatch(failureCommand(action));
  };
  const restoreAll = () => {
    instructor.clear();
    dispatch({ type: 'failure.clearAll' });
    dispatch({ type: 'systems.chargeBattery' });
  };
  const pool = surprisePool(panel, failures);
  const fired = instructor.lastFired && now - instructor.lastFired.at < 8 ? instructor.lastFired : null;

  return (
    <div class="ins-section">
      <div class={`ins-status${active.length ? ' is-bad' : ''}`} role="status">
        <span class="ins-status-text">
          {active.length ? (
            <>
              <strong>Failed:</strong> {active.join(', ')}
            </>
          ) : (
            'All systems normal.'
          )}
          {fired && <span class="ins-fired"> Just now: {fired.surprise ? 'a surprise failure happened' : fired.label}.</span>}
        </span>
        <button type="button" class="pill-btn pill-sm" disabled={active.length === 0 && pending.length === 0} onClick={restoreAll}>
          Restore all
        </button>
      </div>

      <div class="ins-controls">
        <label class="ins-inline">
          <span>Apply</span>
          <select value={delay} onChange={(e) => setDelay(Number((e.currentTarget as HTMLSelectElement).value))}>
            {DELAYS.map((d) => (
              <option key={d.sec} value={d.sec}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <span class="ins-surprise">
          <label class="ins-inline">
            <span>Surprise me within</span>
            <select value={within} onChange={(e) => setWithin(Number((e.currentTarget as HTMLSelectElement).value))}>
              {SURPRISE_WINDOWS.map((d) => (
                <option key={d.sec} value={d.sec}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="pill-btn pill-sm" disabled={pool.length === 0} onClick={() => instructor.armSurprise(pool, now, within)}>
            Arm
          </button>
        </span>
      </div>

      {surprises.length > 0 && (
        <ul class="ins-pending" aria-label="Armed surprises">
          {surprises.map((p) => (
            <li key={p.id}>
              <span class="ins-dot is-pending" aria-hidden="true" />
              <span>A surprise failure is armed: some time in the next {formatCountdown((p.until ?? p.at) - now)}.</span>
              <button type="button" class="pill-btn pill-sm" onClick={() => instructor.cancel(p.id)}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul class="ins-list">
        {FAILURES.map((f) => (
          <FailureRow
            key={f.id}
            info={f}
            failed={failures[f.id]}
            applies={f.appliesTo(panel)}
            pending={pendingFor(pending, (a) => a.kind === 'fail' && a.failure === f.id)}
            now={now}
            delayName={delayName}
            onToggle={() => apply({ kind: 'fail', failure: f.id, failed: !failures[f.id] })}
            onCancel={(id) => instructor.cancel(id)}
          />
        ))}
        <li class={`ins-row ins-row-engine${failures.engine !== 'ok' ? ' is-failed' : ''}`}>
          <span class={`ins-dot${failures.engine !== 'ok' ? ' is-bad' : ''}`} aria-hidden="true" />
          <span class="ins-name">
            <strong>Engine</strong>
            <small>Rough: power loss with surges. Failed: windmilling, glide.</small>
            <EnginePending pending={pendingFor(pending, (a) => a.kind === 'engine')} now={now} onCancel={(id) => instructor.cancel(id)} />
          </span>
          <Segmented
            small
            label={`Engine${delay ? ` (${delayName.toLowerCase()})` : ''}`}
            options={ENGINE_CONDITIONS}
            value={failures.engine}
            onChange={(condition) => apply({ kind: 'engine', condition })}
          />
        </li>
      </ul>
    </div>
  );
}

function FailureRow({
  info,
  failed,
  applies,
  pending,
  now,
  delayName,
  onToggle,
  onCancel,
}: {
  info: FailureInfo;
  failed: boolean;
  applies: boolean;
  pending: PendingFailure | undefined;
  now: number;
  delayName: string;
  onToggle: () => void;
  onCancel: (id: number) => void;
}) {
  const verb = failed ? 'Restore' : 'Fail';
  const when = delayName === 'Now' ? '' : ` ${delayName.toLowerCase()}`;
  return (
    <li class={`ins-row${failed ? ' is-failed' : ''}${pending ? ' is-pending' : ''}${applies ? '' : ' is-na'}`}>
      <span class={`ins-dot${failed ? ' is-bad' : pending ? ' is-pending' : ''}`} aria-hidden="true" />
      <span class="ins-name">
        <strong>
          {info.name}
          {failed && <span class="ins-flag">Failed</span>}
        </strong>
        <small>{applies ? info.effect : `${info.effect} No effect on this panel.`}</small>
        {pending && (
          <small class="ins-when">
            {pending.action.kind === 'fail' && pending.action.failed ? 'Fails' : 'Restored'} in {formatCountdown(pending.at - now)}{' '}
            <button type="button" class="link-btn" onClick={() => onCancel(pending.id)}>
              Cancel
            </button>
          </small>
        )}
      </span>
      <button
        type="button"
        class={`pill-btn pill-sm${failed ? '' : ' pill-danger'}`}
        onClick={onToggle}
        aria-label={`${verb} ${info.name}${when}`}
      >
        {verb}
        {when && <span class="hide-narrow">{when}</span>}
      </button>
    </li>
  );
}

function EnginePending({ pending, now, onCancel }: { pending: PendingFailure | undefined; now: number; onCancel: (id: number) => void }) {
  if (!pending || pending.action.kind !== 'engine') return null;
  const name = ENGINE_CONDITIONS.find((e) => pending.action.kind === 'engine' && e.id === pending.action.condition)?.name ?? '';
  return (
    <small class="ins-when">
      {name} in {formatCountdown(pending.at - now)}{' '}
      <button type="button" class="link-btn" onClick={() => onCancel(pending.id)}>
        Cancel
      </button>
    </small>
  );
}
