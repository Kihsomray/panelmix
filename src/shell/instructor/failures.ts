import type { PanelInfo } from '../../devices/types';
import type { SimCommand } from '../../sim/commands';
import type { EngineCondition, FailureState } from '../../sim/types';

/*
 * What an instructor can fail, and the schedule of failures still to come
 * ("in 5 minutes", or a surprise at a random moment). Pure: the store that
 * fires them lives in store.ts.
 *
 * Times are simulation seconds, so pausing or speeding up the sim moves a
 * scheduled failure with it.
 */

export type BooleanFailure = Exclude<keyof FailureState, 'engine'>;

export interface FailureInfo {
  readonly id: BooleanFailure;
  readonly name: string;
  /** What the pilot will see, in a few words. */
  readonly effect: string;
  /** Whether it changes anything on this panel. */
  readonly appliesTo: (panel: PanelInfo) => boolean;
}

const isSteam = (p: PanelInfo) => p.pfd === 'steam';
const isGlass = (p: PanelInfo) => p.pfd !== 'steam';
const isG1000 = (p: PanelInfo) => p.pfd === 'g1000-pfd';
const always = () => true;

/** In the order an instructor reaches for them. */
export const FAILURES: readonly FailureInfo[] = [
  { id: 'vacuum', name: 'Vacuum pump', effect: 'Attitude and heading indicators slowly spin down.', appliesTo: isSteam },
  { id: 'ahrs', name: 'AHRS', effect: 'Glass attitude and heading lost (red X).', appliesTo: isGlass },
  { id: 'adc', name: 'Air data computer', effect: 'Glass airspeed, altitude and VSI lost (red X).', appliesTo: isGlass },
  { id: 'pitot', name: 'Pitot tube blocked', effect: 'Airspeed acts like an altimeter.', appliesTo: always },
  { id: 'static', name: 'Static port blocked', effect: 'Altimeter frozen, VSI at zero.', appliesTo: always },
  { id: 'alternator', name: 'Alternator', effect: 'Battery only until it is flat (LOW VOLTS).', appliesTo: always },
  { id: 'gps', name: 'GPS', effect: 'GPS position and integrity lost.', appliesTo: always },
  { id: 'pfdDisplay', name: 'PFD display', effect: 'G1000 PFD dark; the MFD reverts.', appliesTo: isG1000 },
  { id: 'mfdDisplay', name: 'MFD display', effect: 'G1000 MFD dark; the PFD reverts.', appliesTo: isG1000 },
];

export const ENGINE_CONDITIONS: readonly { readonly id: EngineCondition; readonly name: string }[] = [
  { id: 'ok', name: 'Normal' },
  { id: 'rough', name: 'Rough' },
  { id: 'failed', name: 'Failed' },
];

export type FailureAction =
  | { readonly kind: 'fail'; readonly failure: BooleanFailure; readonly failed: boolean }
  | { readonly kind: 'engine'; readonly condition: EngineCondition };

export interface PendingFailure {
  readonly id: number;
  /** Simulation time it happens. */
  readonly at: number;
  readonly action: FailureAction;
  /** A surprise: the instructor station hides what it is until it happens. */
  readonly surprise: boolean;
  /** End of a surprise's window, shown instead of `at` so the moment stays a surprise. */
  readonly until?: number;
}

export function failureName(id: BooleanFailure): string {
  return FAILURES.find((f) => f.id === id)?.name ?? id;
}

export function actionLabel(a: FailureAction): string {
  if (a.kind === 'engine') return a.condition === 'ok' ? 'Engine restored' : a.condition === 'rough' ? 'Engine runs rough' : 'Engine fails';
  return `${failureName(a.failure)} ${a.failed ? 'fails' : 'restored'}`;
}

export function failureCommand(a: FailureAction): SimCommand {
  return a.kind === 'engine'
    ? { type: 'failure.engine', condition: a.condition }
    : { type: 'failure.set', failure: a.failure, failed: a.failed };
}

/** Names of what is failed right now, for the summary line. */
export function activeFailures(f: FailureState): string[] {
  const out = FAILURES.filter((x) => f[x.id]).map((x) => x.name);
  if (f.engine !== 'ok') out.push(f.engine === 'rough' ? 'Engine rough' : 'Engine failed');
  return out;
}

export function nextPendingId(list: readonly PendingFailure[]): number {
  return list.reduce((m, p) => Math.max(m, p.id), 0) + 1;
}

/**
 * Adds a failure `delaySec` from now; a newer schedule for the same item replaces the older one.
 * A surprise (`untilSec` = the end of its window, from now) stacks with whatever else is planned.
 */
export function schedule(list: readonly PendingFailure[], action: FailureAction, now: number, delaySec: number, untilSec?: number): PendingFailure[] {
  const surprise = untilSec !== undefined;
  const same = (p: PendingFailure) =>
    !p.surprise && p.action.kind === action.kind && (action.kind === 'engine' || (p.action.kind === 'fail' && p.action.failure === action.failure));
  const kept = surprise ? [...list] : list.filter((p) => !same(p));
  const at = now + Math.max(delaySec, 0);
  const item: PendingFailure = surprise ? { id: nextPendingId(list), at, action, surprise, until: Math.max(now + untilSec, at) } : { id: nextPendingId(list), at, action, surprise };
  return [...kept, item].sort((a, b) => a.at - b.at);
}

/** Splits the schedule into what is due now and what is still to come. */
export function takeDue(list: readonly PendingFailure[], now: number): { due: PendingFailure[]; rest: PendingFailure[] } {
  const due: PendingFailure[] = [];
  const rest: PendingFailure[] = [];
  for (const p of list) (p.at <= now ? due : rest).push(p);
  return { due, rest };
}

/**
 * Failures worth springing on this panel: the ones that change something it
 * shows, not already failed. A rough engine is in the pool; a dead engine is
 * left to the instructor to choose on purpose.
 */
export function surprisePool(panel: PanelInfo, current: FailureState): FailureAction[] {
  const pool: FailureAction[] = FAILURES.filter((f) => f.appliesTo(panel) && !current[f.id] && f.id !== 'pfdDisplay' && f.id !== 'mfdDisplay').map(
    (f) => ({ kind: 'fail', failure: f.id, failed: true }),
  );
  if (current.engine === 'ok') pool.push({ kind: 'engine', condition: 'rough' });
  return pool;
}

/**
 * Picks a surprise: a random failure from the pool at a random time within
 * `withinSec` (never in the first 20 seconds, so it doesn't happen while the
 * instructor is still looking at the screen). `random` returns 0..1.
 */
export function pickSurprise(
  pool: readonly FailureAction[],
  now: number,
  withinSec: number,
  random: () => number,
): { action: FailureAction; at: number } | null {
  if (pool.length === 0) return null;
  const action = pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)]!;
  const earliest = Math.min(20, withinSec / 2);
  return { action, at: now + earliest + random() * Math.max(withinSec - earliest, 0) };
}

/** "1:05", "0:09": time until a scheduled failure. */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
