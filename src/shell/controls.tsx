import { useState } from 'preact/hooks';

/*
 * Small native form controls for the drawer tabs.
 */

/**
 * A number input that edits freely (an empty or half-typed field isn't
 * forced back to a number) and commits a valid value on change: Enter,
 * blur or the spinner arrows.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  decimals = 0,
  label,
  wrap = false,
}: {
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  /** Accessible name when there is no visible label. */
  label?: string;
  /** Directions: 360 and beyond wrap around instead of being refused. */
  wrap?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    let v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) return;
    if (wrap) v = ((v % 360) + 360) % 360;
    if (v >= min && v <= max) onCommit(Number(v.toFixed(decimals)));
  };
  return (
    <input
      type="number"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      value={draft ?? value.toFixed(decimals)}
      min={wrap ? undefined : min}
      max={wrap ? undefined : max}
      step={step}
      aria-label={label}
      onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
      onChange={(e) => {
        commit((e.currentTarget as HTMLInputElement).value);
        setDraft(null);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** A segmented choice (radio group) of a few options. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  small = false,
}: {
  label: string;
  options: readonly { readonly id: T; readonly name: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div class={`seg${small ? ' seg-small' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}
