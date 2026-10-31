/*
 * Softkey rows: twelve slots under the display, numbered 1 to 12 from the
 * left as in the Pilot's Guide flowcharts. Empty slots have no function.
 */

export type AlertLevel = 'advisory' | 'caution' | 'warning';

export interface Softkey {
  readonly id: string;
  readonly label: string;
  /** Function currently on: drawn black on gray. */
  readonly on?: boolean;
  /** Not available now: gray label, pressing does nothing. */
  readonly disabled?: boolean;
  /** ALERTS key replaced by a flashing alert label. */
  readonly alert?: AlertLevel;
}

export type SoftkeyRow = readonly (Softkey | null)[];

export interface SoftkeyOptions {
  readonly on?: boolean;
  readonly disabled?: boolean;
}

export function sk(id: string, label: string, opts: SoftkeyOptions = {}): Softkey {
  return {
    id,
    label,
    ...(opts.on ? { on: true } : {}),
    ...(opts.disabled ? { disabled: true } : {}),
  };
}

/** Builds a row from 1-based positions. */
export function softkeyRow(at: Readonly<Record<number, Softkey>>): SoftkeyRow {
  return Array.from({ length: 12 }, (_, i) => at[i + 1] ?? null);
}

/** The id under a 0-based key, or null for an empty or disabled slot. */
export function softkeyAt(row: SoftkeyRow, index: number): string | null {
  const k = row[index];
  return k && !k.disabled ? k.id : null;
}
