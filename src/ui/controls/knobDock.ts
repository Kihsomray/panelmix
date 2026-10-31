/*
 * On touch screens a real knob is small and fiddly. Tapping one selects it
 * into the knob dock, a bar of large buttons at the bottom of the screen that
 * turns it and pushes it. This module is the tiny store the knobs and the
 * dock share.
 */

export interface KnobHandlers {
  readonly id: string;
  readonly label: string;
  readonly outerLabel?: string;
  readonly innerLabel?: string;
  readonly pushLabel?: string;
  readonly turnOuter?: (steps: number) => void;
  readonly turnInner?: (steps: number) => void;
  readonly push?: () => void;
}

type Listener = (k: KnobHandlers | null) => void;

let current: KnobHandlers | null = null;
const listeners = new Set<Listener>();

export function openDock(k: KnobHandlers): void {
  current = k;
  for (const l of listeners) l(current);
}

/** Keeps the dock's handlers fresh while the same knob stays selected. */
export function refreshDock(k: KnobHandlers): void {
  if (current?.id === k.id) {
    current = k;
  }
}

export function closeDock(): void {
  current = null;
  for (const l of listeners) l(null);
}

export function getDock(): KnobHandlers | null {
  return current;
}

export function onDockChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
