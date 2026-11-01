import type { AirportProcedures, ProcedureSource } from './procedures';

/*
 * Loads the per-airport procedure files (public/data/proc/{IDENT}.json)
 * listed in public/data/proc/index.json, on demand, with an in-memory cache.
 * Both are written by scripts/build-cifp.mjs.
 *
 * A download that fails (offline, server error) is not remembered as "no
 * procedures": get() reports none for a short while and then tries again,
 * so the airport's procedures appear once the network is back.
 */

interface ProcIndex {
  readonly v: 1;
  readonly cycle: string;
  readonly airports: readonly string[];
}

/** The part of fetch() this module uses, so tests can serve the files from disk. */
export type ProcFetch = (url: string) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

/** Pause before get() retries an airport whose file failed to load. */
export const PROC_RETRY_MS = 30_000;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isIndex(x: unknown): x is ProcIndex {
  return isRecord(x) && x.v === 1 && typeof x.cycle === 'string' && Array.isArray(x.airports);
}

function isProcedures(x: unknown, airport: string): x is AirportProcedures {
  return (
    isRecord(x) &&
    x.v === 1 &&
    x.airport === airport &&
    Array.isArray(x.runways) &&
    Array.isArray(x.approaches) &&
    Array.isArray(x.departures) &&
    Array.isArray(x.arrivals)
  );
}

const keyOf = (airport: string) => airport.trim().toUpperCase();

export async function createProcedureSource(
  baseUrl: string,
  fetchJson: ProcFetch = (url) => fetch(url),
  now: () => number = Date.now,
): Promise<ProcedureSource> {
  let index: ProcIndex = { v: 1, cycle: '', airports: [] };
  try {
    const res = await fetchJson(`${baseUrl}data/proc/index.json`);
    const data: unknown = res.ok ? await res.json() : null;
    if (isIndex(data)) index = data;
  } catch {
    // No procedure database: every airport simply has none.
  }
  const available = new Set(index.airports);
  const cache = new Map<string, AirportProcedures>();
  const pending = new Map<string, Promise<AirportProcedures | null>>();
  const failedAt = new Map<string, number>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        // One broken subscriber must not keep the others from hearing about the load.
        console.error(err);
      }
    }
  };

  const fetchAirport = async (key: string): Promise<AirportProcedures> => {
    const res = await fetchJson(`${baseUrl}data/proc/${key}.json`);
    if (!res.ok) throw new Error(`${key}.json: not found`);
    const data: unknown = await res.json();
    if (!isProcedures(data, key)) throw new Error(`${key}.json: not a procedure file`);
    return data;
  };

  const load = (airport: string): Promise<AirportProcedures | null> => {
    const key = keyOf(airport);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (!available.has(key)) return Promise.resolve(null);
    let p = pending.get(key);
    if (!p) {
      p = fetchAirport(key)
        .then(
          (data) => {
            cache.set(key, data);
            failedAt.delete(key);
            return data;
          },
          () => {
            failedAt.set(key, now());
            return null;
          },
        )
        .then((data) => {
          pending.delete(key);
          notify();
          return data;
        });
      pending.set(key, p);
    }
    return p;
  };

  return {
    cycle: index.cycle,
    has: (airport) => available.has(keyOf(airport)),
    get: (airport) => {
      const key = keyOf(airport);
      if (!available.has(key)) return null;
      const cached = cache.get(key);
      if (cached) return cached;
      const failed = failedAt.get(key);
      if (failed !== undefined && now() - failed < PROC_RETRY_MS) return null;
      void load(key);
      return undefined;
    },
    load,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
