import type { AirportProcedures, ProcedureSource } from './procedures';

/*
 * Loads the per-airport procedure files (public/data/proc/{IDENT}.json)
 * listed in public/data/proc/index.json, on demand, with an in-memory cache.
 */

interface ProcIndex {
  readonly v: 1;
  readonly cycle: string;
  readonly airports: readonly string[];
}

export async function createProcedureSource(baseUrl: string): Promise<ProcedureSource> {
  let index: ProcIndex = { v: 1, cycle: '', airports: [] };
  try {
    const res = await fetch(`${baseUrl}data/proc/index.json`);
    if (res.ok) index = (await res.json()) as ProcIndex;
  } catch {
    // No procedure database: every airport simply has none.
  }
  const available = new Set(index.airports);
  const cache = new Map<string, AirportProcedures | null>();
  const pending = new Map<string, Promise<AirportProcedures | null>>();
  const listeners = new Set<() => void>();

  const load = (airport: string): Promise<AirportProcedures | null> => {
    const key = airport.toUpperCase();
    if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
    if (!available.has(key)) {
      cache.set(key, null);
      return Promise.resolve(null);
    }
    let p = pending.get(key);
    if (!p) {
      p = fetch(`${baseUrl}data/proc/${key}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<AirportProcedures>) : null))
        .catch(() => null)
        .then((data) => {
          cache.set(key, data);
          pending.delete(key);
          for (const l of listeners) l();
          return data;
        });
      pending.set(key, p);
    }
    return p;
  };

  return {
    cycle: index.cycle,
    has: (airport) => available.has(airport.toUpperCase()),
    get: (airport) => {
      const key = airport.toUpperCase();
      if (!cache.has(key)) {
        void load(key);
        return undefined;
      }
      return cache.get(key) ?? null;
    },
    load,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
