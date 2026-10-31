import { useEffect, useRef, useState } from 'preact/hooks';
import { getDock, onDockChange, openDock, refreshDock, type KnobHandlers } from './knobDock';

/*
 * A rotary knob, single or dual concentric, operated like the real thing:
 *
 *   - drag around it (mouse or finger) to turn; each detent is one step
 *   - mouse wheel over the outer ring or the center turns that knob
 *   - click the center to push it (mouse); on touch, tap it to select it into
 *     the knob dock, whose big buttons turn and push it
 *   - keyboard: up/down turn the outer (large) knob, left/right the inner
 *     (small) knob, Enter or Space pushes
 *
 * Clockwise is a positive step.
 */

export interface KnobProps {
  /** Unique id, e.g. "gns430.right-knob". */
  readonly id: string;
  /** Center, design px. */
  readonly x: number;
  readonly y: number;
  /** Outer diameter, design px. */
  readonly size: number;
  /** Diameter of the inner (small) knob. Omit for a single knob. */
  readonly innerSize?: number;
  readonly label: string;
  readonly outerLabel?: string;
  readonly innerLabel?: string;
  readonly pushLabel?: string;
  /** Name of the push-and-hold action in the touch dock ("Sync", "Flip-flop"). */
  readonly longPushLabel?: string;
  /** Large (outer) knob, dual knobs only. */
  readonly onOuter?: (steps: number) => void;
  /** Small (inner) knob, or the only knob. */
  readonly onInner?: (steps: number) => void;
  readonly onPush?: () => void;
  readonly onLongPush?: () => void;
  readonly look?: 'garmin' | 'aspen' | 'steam' | 'bendix';
}

const DETENT_DEG = 20;
const DRAG_PX_PER_STEP = 14;
const WHEEL_PER_STEP = 50;
const TAP_SLOP_PX = 6;
const LONG_PRESS_MS = 650;

type Ring = 'outer' | 'inner';

export function Knob(props: KnobProps) {
  const { id, x, y, size, innerSize, label, look = 'garmin' } = props;
  const dual = innerSize !== undefined;
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [angles, setAngles] = useState({ outer: 0, inner: 0 });
  const [docked, setDocked] = useState(() => getDock()?.id === id);
  const [active, setActive] = useState<Ring | null>(null);

  const handlers = (): KnobHandlers => {
    const p = latest.current;
    const turnOuter = p.onOuter;
    const turnInner = p.onInner;
    return {
      id: p.id,
      label: p.label,
      ...(p.outerLabel !== undefined && { outerLabel: p.outerLabel }),
      ...(p.innerLabel !== undefined && { innerLabel: p.innerLabel }),
      ...(p.pushLabel !== undefined && { pushLabel: p.pushLabel }),
      ...(turnOuter && { turnOuter: (n: number) => turn('outer', n) }),
      ...(turnInner && { turnInner: (n: number) => turn('inner', n) }),
      ...(p.onPush && { push: () => latest.current.onPush?.() }),
      ...(p.onLongPush && { longPush: () => latest.current.onLongPush?.() }),
      ...(p.longPushLabel !== undefined && { longPushLabel: p.longPushLabel }),
    };
  };

  const turn = (ring: Ring, steps: number) => {
    if (steps === 0) return;
    const p = latest.current;
    const fn = ring === 'outer' ? p.onOuter : p.onInner;
    if (!fn) return;
    fn(steps);
    setAngles((a) => ({ ...a, [ring]: a[ring] + steps * DETENT_DEG }));
  };

  useEffect(() => onDockChange((k) => setDocked(k?.id === id)), [id]);
  useEffect(() => {
    if (docked) refreshDock(handlers());
  });

  const ringAt = (clientX: number, clientY: number): Ring => {
    if (!dual) return 'inner';
    const r = el.current!.getBoundingClientRect();
    const dist = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
    return dist <= (r.width / 2) * (innerSize! / size) ? 'inner' : 'outer';
  };

  // Drag to turn, tap to push or dock -----------------------------------
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const node = el.current!;
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ring = ringAt(e.clientX, e.clientY);
    const startX = e.clientX;
    const startY = e.clientY;
    const startedAt = performance.now();
    let lastAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    let lastY = e.clientY;
    let accDeg = 0;
    let accPx = 0;
    let moved = false;
    let stepped = false;
    let longFired = false;
    setActive(ring);

    const longTimer = window.setTimeout(() => {
      if (moved || stepped) return;
      const p = latest.current;
      if (p.onLongPush) {
        longFired = true;
        p.onLongPush();
      }
    }, LONG_PRESS_MS);

    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TAP_SLOP_PX) moved = true;
      const dx = ev.clientX - cx;
      const dy = ev.clientY - cy;
      const radius = Math.hypot(dx, dy);
      if (radius > rect.width * 0.18) {
        const angle = Math.atan2(dy, dx);
        let d = ((angle - lastAngle) * 180) / Math.PI;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        lastAngle = angle;
        accDeg += d;
        const steps = Math.trunc(accDeg / DETENT_DEG);
        if (steps !== 0) {
          accDeg -= steps * DETENT_DEG;
          stepped = true;
          turn(ring, steps);
        }
      } else {
        // Too close to the center for a stable angle: treat it as a vertical drag.
        lastAngle = Math.atan2(dy, dx);
        accPx += lastY - ev.clientY;
        const steps = Math.trunc(accPx / DRAG_PX_PER_STEP);
        if (steps !== 0) {
          accPx -= steps * DRAG_PX_PER_STEP;
          stepped = true;
          turn(ring, steps);
        }
      }
      lastY = ev.clientY;
    };

    const up = (ev: PointerEvent) => {
      window.clearTimeout(longTimer);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      setActive(null);
      if (ev.type === 'pointercancel' || moved || stepped || longFired) return;
      if (performance.now() - startedAt > 1000) return;
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
        openDock(handlers());
      } else if (ring === 'inner') {
        latest.current.onPush?.();
      }
    };

    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  };

  // Mouse wheel and trackpad ------------------------------------------------
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let acc = 0;
    let lastRing: Ring = 'inner';
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ring = ringAt(e.clientX, e.clientY);
      if (ring !== lastRing) acc = 0;
      lastRing = ring;
      const unit = e.deltaMode === 1 ? 33 : 1;
      acc -= e.deltaY * unit;
      const steps = Math.trunc(acc / WHEEL_PER_STEP);
      if (steps !== 0) {
        acc -= steps * WHEEL_PER_STEP;
        turn(ring, steps);
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [dual]);

  const onKeyDown = (e: KeyboardEvent) => {
    const big = dual ? 'outer' : 'inner';
    const step = e.shiftKey ? 5 : 1;
    switch (e.key) {
      case 'ArrowUp':
        turn(big, step);
        break;
      case 'ArrowDown':
        turn(big, -step);
        break;
      case 'ArrowRight':
        turn('inner', step);
        break;
      case 'ArrowLeft':
        turn('inner', -step);
        break;
      case 'Enter':
      case ' ':
        latest.current.onPush?.();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const innerD = innerSize ?? size;
  const hint = dual ? 'Up and down arrows turn the large knob, left and right the small knob' : 'Arrow keys turn';
  return (
    <div
      ref={el}
      class={`knob knob-${look}${docked ? ' is-docked' : ''}${active ? ` is-turning-${active}` : ''}`}
      style={{ left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` }}
      tabIndex={0}
      role="group"
      aria-label={`${label}. ${hint}${props.onPush ? ', Enter pushes' : ''}.`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="-50 -50 100 100" aria-hidden="true">
        {dual && (
          <g style={{ transform: `rotate(${angles.outer}deg)` }} class="knob-rot">
            <circle r="49" class="knob-outer" />
            <Knurl r={49} inner={(innerD / size) * 50 + 3} count={36} />
          </g>
        )}
        <g style={{ transform: `rotate(${angles.inner}deg)` }} class="knob-rot">
          <circle r={(innerD / size) * 49} class="knob-inner" />
          <Knurl r={(innerD / size) * 49} inner={(innerD / size) * 49 - 5} count={dual ? 24 : 30} />
          <circle r={(innerD / size) * 49 * 0.62} class="knob-cap" />
          <line x1="0" y1={-(innerD / size) * 49 * 0.6} x2="0" y2={-(innerD / size) * 49 * 0.25} class="knob-mark" />
        </g>
      </svg>
    </div>
  );
}

function Knurl({ r, inner, count }: { r: number; inner: number; count: number }) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    lines.push(
      <line
        key={i}
        x1={Math.cos(a) * inner}
        y1={Math.sin(a) * inner}
        x2={Math.cos(a) * (r - 1)}
        y2={Math.sin(a) * (r - 1)}
        class="knob-knurl"
      />,
    );
  }
  return <g>{lines}</g>;
}
