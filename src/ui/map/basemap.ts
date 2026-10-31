/*
 * Natural Earth coastline, lakes and borders (public/data/basemap.json),
 * loaded once and shared by every map.
 */

export interface Basemap {
  /** Each line is a flat [lon, lat, lon, lat, ...] array. */
  readonly coast: readonly (readonly number[])[];
  readonly lakes: readonly (readonly number[])[];
  readonly states: readonly (readonly number[])[];
  readonly borders: readonly (readonly number[])[];
}

let cache: Basemap | null = null;
let pending: Promise<Basemap | null> | null = null;
const listeners = new Set<() => void>();

export function getBasemap(): Basemap | null {
  if (!cache && !pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/basemap.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Basemap>) : null))
      .catch(() => null)
      .then((b) => {
        cache = b;
        for (const l of listeners) l();
        return b;
      });
  }
  return cache;
}

/** Call `l` once the basemap arrives (maps redraw every frame anyway; this is for static ones). */
export function onBasemap(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
