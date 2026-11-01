import { initialSimState } from './defaults';
import { FMS_NULLABLE, SYSTEMS_NULLABLE, type SimState } from './types';

/*
 * Saves the session (radios, flight plan, position) so a reload picks up
 * where you left off. Saved data is merged over fresh defaults field by
 * field, so a newer version of the app with extra state still loads an
 * older save, and anything of the wrong type falls back to the default.
 */

const KEY = 'panelmix:sim:v1';

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** State fields that may legitimately be null. */
const NULLABLE = new Set<string>(['minimumsFt', 'identUntil', 'lateralArmed', 'verticalArmed', ...FMS_NULLABLE, ...SYSTEMS_NULLABLE]);
/** Arrays whose length varies; every other array is a fixed tuple (two radios, two tanks). */
const OPEN_LISTS = new Set(['plan', 'messages']);

/**
 * Deep merge where `saved` may only replace values of the same JSON type as
 * the default. Null is accepted only for the fields that are nullable.
 */
export function mergeOver<T>(defaults: T, saved: unknown, key = ''): T {
  if (saved === null && NULLABLE.has(key)) return null as T;
  if (isPlain(defaults)) {
    if (!isPlain(saved)) return defaults;
    const out: Plain = { ...defaults };
    for (const k of Object.keys(defaults)) {
      if (k in saved) out[k] = mergeOver((defaults as Plain)[k], saved[k], k);
    }
    return out as T;
  }
  if (Array.isArray(defaults)) {
    if (!Array.isArray(saved)) return defaults;
    if (OPEN_LISTS.has(key)) return saved as T;
    // Fixed tuples keep their shape: merge element by element, or fall back if the length differs.
    return saved.length === defaults.length ? (defaults.map((d, i) => mergeOver(d, saved[i])) as T) : defaults;
  }
  if (defaults === null) return (typeof saved === 'number' && Number.isFinite(saved) ? saved : null) as T;
  return typeof saved === typeof defaults && (typeof saved !== 'number' || Number.isFinite(saved)) ? (saved as T) : defaults;
}

/** Fields that only make sense in the running session are not restored. */
function sessionOnly(state: SimState): SimState {
  return { ...state, paused: false, rate: 1, controls: { roll: 0, pitch: 0 }, messages: [], xpdr: { ...state.xpdr, identUntil: null } };
}

export function loadSimState(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): SimState {
  const defaults = initialSimState();
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!isPlain(saved) || saved.v !== 1) return defaults;
    const state = mergeOver(defaults, saved.state);
    // A plan restored without its active leg is still valid; a leg without the plan is cleared.
    const leg = state.fms.activeLeg;
    const legOk = !leg || leg.planIndex === null || state.fms.plan[leg.planIndex]?.ident === leg.to.ident;
    return sessionOnly({ ...state, fms: legOk ? state.fms : { ...state.fms, activeLeg: null } });
  } catch {
    return defaults;
  }
}

export function saveSimState(state: SimState, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ v: 1, state: sessionOnly(state) }));
  } catch {
    // Storage full or blocked: the session simply won't be remembered.
  }
}

export function clearSavedSimState(storage: Pick<Storage, 'removeItem'> | undefined = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
