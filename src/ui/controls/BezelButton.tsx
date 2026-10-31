import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/*
 * A physical push button on a bezel. Real <button> for keyboard and screen
 * readers; pointer handling adds press-and-hold (Garmin CLR held = default
 * map page) and auto-repeat (range rockers).
 */

export interface BezelButtonProps {
  /** Top-left, design px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** What is printed on the key. */
  readonly label: ComponentChildren;
  /** Spoken name when the printed label isn't enough ("Direct-to"). */
  readonly ariaLabel?: string;
  readonly onPress: () => void;
  /** Fired instead of onPress when held for 700 ms. */
  readonly onLongPress?: () => void;
  /** Repeats onPress while held (after 400 ms, every 120 ms). */
  readonly repeat?: boolean;
  readonly shape?: 'rect' | 'round' | 'pill';
  /** Visual family; styles live in styles/devices.css. */
  readonly look?: 'garmin' | 'garmin-light' | 'aspen' | 'bendix' | 'softkey' | 'touch';
  readonly fontSize?: number;
  /** Lit annunciator, e.g. an engaged autopilot mode. */
  readonly lit?: boolean;
  readonly disabled?: boolean;
  readonly class?: string;
}

const LONG_MS = 700;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

export function BezelButton(p: BezelButtonProps) {
  const [pressed, setPressed] = useState(false);
  const latest = useRef(p);
  latest.current = p;
  const timers = useRef<number[]>([]);
  const consumed = useRef(false);

  const clearTimers = () => {
    for (const t of timers.current) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || latest.current.disabled) return;
    consumed.current = false;
    setPressed(true);
    if (latest.current.onLongPress) {
      timers.current.push(
        window.setTimeout(() => {
          consumed.current = true;
          latest.current.onLongPress?.();
        }, LONG_MS),
      );
    } else if (latest.current.repeat) {
      timers.current.push(
        window.setTimeout(() => {
          consumed.current = true;
          latest.current.onPress();
          timers.current.push(window.setInterval(() => latest.current.onPress(), REPEAT_EVERY_MS));
        }, REPEAT_DELAY_MS),
      );
    }
  };

  const release = () => {
    setPressed(false);
    clearTimers();
  };

  const shape = p.shape ?? 'rect';
  return (
    <button
      type="button"
      class={`bezel-btn bezel-btn-${p.look ?? 'garmin'} bezel-btn-${shape}${pressed ? ' is-pressed' : ''}${p.lit ? ' is-lit' : ''}${p.class ? ` ${p.class}` : ''}`}
      style={{
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: `${p.w}px`,
        height: `${p.h}px`,
        ...(p.fontSize !== undefined && { fontSize: `${p.fontSize}px` }),
      }}
      aria-label={p.ariaLabel}
      aria-pressed={p.lit === undefined ? undefined : p.lit}
      disabled={p.disabled}
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (consumed.current) {
          consumed.current = false;
          return;
        }
        latest.current.onPress();
      }}
    >
      <span class="bezel-btn-label">{p.label}</span>
    </button>
  );
}
