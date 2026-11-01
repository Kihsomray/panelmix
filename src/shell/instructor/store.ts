import type { SimCommand } from '../../sim/commands';
import { actionLabel, failureCommand, pickSurprise, schedule, takeDue, type FailureAction, type PendingFailure } from './failures';

/*
 * The instructor's schedule of failures still to come. It lives for the
 * whole session (not inside the drawer) and is ticked on every simulator
 * frame, so a failure set for "in 5 minutes" happens with the drawer closed.
 */

export class InstructorStore {
  private pending: PendingFailure[] = [];
  private lastNow = 0;
  private readonly listeners = new Set<() => void>();
  /** The most recent scheduled failure that fired, for the station's status line. */
  lastFired: { readonly label: string; readonly at: number; readonly surprise: boolean } | null = null;

  get list(): readonly PendingFailure[] {
    return this.pending;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: PendingFailure[]) {
    this.pending = next;
    for (const l of this.listeners) l();
  }

  /**
   * A failure (or restore) after `delaySec`. With `surpriseWithinSec` it is a surprise: the
   * station hides what it is and only shows that something will happen within that window.
   */
  schedule(action: FailureAction, now: number, delaySec: number, surpriseWithinSec?: number): void {
    this.set(schedule(this.pending, action, now, delaySec, surpriseWithinSec));
  }

  /** Arms a surprise from `pool` within `withinSec`; false when there is nothing left to fail. */
  armSurprise(pool: readonly FailureAction[], now: number, withinSec: number, random: () => number = Math.random): boolean {
    const pick = pickSurprise(pool, now, withinSec, random);
    if (!pick) return false;
    this.set(schedule(this.pending, pick.action, now, pick.at - now, withinSec));
    return true;
  }

  cancel(id: number): void {
    this.set(this.pending.filter((p) => p.id !== id));
  }

  clear(): void {
    if (this.pending.length > 0) this.set([]);
  }

  /** Fires what is due. Called on every simulator frame. */
  tick(now: number, dispatch: (cmd: SimCommand) => void): void {
    const back = now < this.lastNow - 1 ? now - this.lastNow : 0;
    this.lastNow = now;
    if (this.pending.length === 0) return;
    // The session was reset (time went back): keep the remaining delays.
    const list = back ? this.pending.map((p) => ({ ...p, at: p.at + back, ...(p.until !== undefined && { until: p.until + back }) })) : this.pending;
    const { due, rest } = takeDue(list, now);
    if (due.length === 0) {
      if (back) this.pending = list;
      return;
    }
    const last = due[due.length - 1]!;
    this.lastFired = { label: actionLabel(last.action), at: now, surprise: last.surprise };
    this.set(rest);
    for (const p of due) dispatch(failureCommand(p.action));
  }
}
