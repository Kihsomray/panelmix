import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { InstructorStore } from './instructor/store';
import type { LessonStore } from './lessons/store';

/*
 * Session-wide shell stores (the instructor's failure schedule and the
 * lesson in progress), shared by the sim bar, the drawer tabs and the
 * lesson strip.
 */

export interface ShellStores {
  readonly instructor: InstructorStore;
  readonly lessons: LessonStore;
}

export const ShellContext = createContext<ShellStores | null>(null);

export function useShell(): ShellStores {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside <ShellContext.Provider>');
  return s;
}

/** Re-renders when the store notifies; returns `read()` of the latest value. */
export function useStore<T>(store: { subscribe(l: () => void): () => void }, read: () => T): T {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
  return read();
}

const memory = new Map<string, unknown>();

/**
 * useState that survives the component unmounting for the rest of the
 * session: the instructor's scenario form keeps its choices when the
 * drawer is closed and opened again.
 */
export function useSessionState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  return [
    value,
    (next: T) => {
      memory.set(key, next);
      setValue(next);
    },
  ];
}
