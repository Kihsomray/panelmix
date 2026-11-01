import type { MessageLevel, SimState } from '../types';
import { TAWS } from './taws';
import type { AlertMemo, SystemsDerived, TerrainAlertLevel } from './types';

/*
 * One-shot alerts. Each step lists the alert conditions that hold now; a
 * condition not yet remembered posts its message once and is remembered.
 * A remembered alert is forgotten only after its condition has been gone
 * for a while (a few seconds for terrain, a minute for airspace), so a
 * condition that flickers (turbulence on the look-ahead, the edge of an
 * airspace) doesn't repeat its message.
 */

export interface ActiveAlert {
  readonly key: string;
  /** Posted when the alert begins; null remembers it silently. */
  readonly text: string | null;
  readonly level: MessageLevel;
}

export interface PostedMessage {
  readonly text: string;
  readonly level: MessageLevel;
}

/** How long a remembered alert outlives its condition before it can be given again, s. */
export function alertHoldS(key: string): number {
  if (key.startsWith('terrain:')) return TAWS.holdS;
  if (key.startsWith('airspace:')) return 60;
  return 10;
}

/** Remembered times are refreshed at most this often, so a steady condition doesn't rewrite the state every step. */
const REFRESH_S = 1;

export function updateAlerts(
  memos: readonly AlertMemo[],
  active: readonly ActiveAlert[],
  now: number,
): { readonly alerts: readonly AlertMemo[]; readonly messages: readonly PostedMessage[] } {
  // One entry per key; an entry with a message wins over a silent one.
  const current = new Map<string, ActiveAlert>();
  for (const alert of active) if (!current.get(alert.key)?.text) current.set(alert.key, alert);

  let changed = false;
  const next: AlertMemo[] = [];
  const known = new Set<string>();
  for (const memo of memos) {
    known.add(memo.key);
    if (current.has(memo.key)) {
      const stale = now - memo.seenAt >= REFRESH_S;
      next.push(stale ? { key: memo.key, seenAt: now } : memo);
      changed ||= stale;
    } else if (now - memo.seenAt <= alertHoldS(memo.key)) {
      next.push(memo);
    } else {
      changed = true;
    }
  }
  const messages: PostedMessage[] = [];
  for (const alert of current.values()) {
    if (known.has(alert.key)) continue;
    next.push({ key: alert.key, seenAt: now });
    if (alert.text) messages.push({ text: alert.text, level: alert.level });
    changed = true;
  }
  return { alerts: changed ? next : memos, messages };
}

/** The annunciated terrain level: the instantaneous one, or a higher one still within its hold. */
export function heldTerrainLevel(instant: TerrainAlertLevel, memos: readonly AlertMemo[], now: number): TerrainAlertLevel {
  if (instant === 'warning') return instant;
  const held = (level: TerrainAlertLevel) =>
    memos.some((m) => m.key === `terrain:${level}` && now - m.seenAt <= TAWS.holdS);
  if (held('warning')) return 'warning';
  return instant === 'caution' || held('caution') ? 'caution' : 'none';
}

/** Every alert condition that holds in this state. */
export function systemAlerts(state: SimState, d: SystemsDerived, terrainLevel: TerrainAlertLevel): ActiveAlert[] {
  const out: ActiveAlert[] = [];
  const an = d.annunciators;
  const caution = (key: string) => out.push({ key, text: key, level: 'caution' });
  if (an.lowVolts) caution('LOW VOLTS');
  if (an.lowVacuum) caution('LOW VACUUM');
  if (an.oilPressure) caution('OIL PRESSURE');
  if (an.lowFuelL) caution('LOW FUEL L');
  if (an.lowFuelR) caution('LOW FUEL R');
  if (state.systems.failures.gps && d.electrical.avionicsPowered) {
    out.push({ key: 'GPS', text: 'GPS NAVIGATION LOST', level: 'caution' });
  }

  if (terrainLevel === 'warning') {
    out.push({ key: 'terrain:warning', text: 'TERRAIN AHEAD, PULL UP', level: 'caution' });
    // A warning covers the caution: easing back to a caution doesn't announce it again.
    out.push({ key: 'terrain:caution', text: null, level: 'caution' });
  } else if (terrainLevel === 'caution') {
    out.push({ key: 'terrain:caution', text: 'CAUTION TERRAIN', level: 'caution' });
  }

  for (const v of d.airspace.inside) {
    out.push({ key: `airspace:in:${v.cls}:${v.name}`, text: `Inside Class ${v.cls}: ${v.name}`, level: 'advisory' });
    // Inside it, the airspace is not "ahead" either: no repeat when stepping out from under a shelf.
    out.push({ key: `airspace:ahead:${v.cls}:${v.name}`, text: null, level: 'advisory' });
  }
  for (const v of d.airspace.ahead) {
    out.push({ key: `airspace:ahead:${v.cls}:${v.name}`, text: `Class ${v.cls} ahead: ${v.name}`, level: 'advisory' });
  }
  return out;
}
