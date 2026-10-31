import { useEffect, useRef, useState } from 'preact/hooks';
import { getDock, onDockChange, openDock, refreshDock, type KnobHandlers } from '../../ui/controls/knobDock';

/*
 * The GMC 507 NOSE UP/DN thumbwheel. A vertical wheel rather than a knob,
 * so it has its own control: drag it up or down, roll the mouse wheel over
 * it, or use the arrow keys. Like a trim wheel, rolling its surface up
 * (toward DN) lowers the nose. On touch screens a tap opens the knob dock.
 */

interface Props {
  readonly id: string;
  /** Center and size, design px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
  /** +1 nose up, -1 nose down, one detent. */
  readonly onRoll: (direction: 1 | -1) => void;
}

const DRAG_PX_PER_DETENT = 12;
const WHEEL_PER_DETENT = 50;
const TAP_SLOP_PX = 6;
const RIDGE_SPACING = 5;

export function NoseWheel({ id, x, y, w, h, label, onRoll }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef(onRoll);
  latest.current = onRoll;
  const [offset, setOffset] = useState(0);
  const [docked, setDocked] = useState(() => getDock()?.id === id);

  const roll = (direction: 1 | -1) => {
    latest.current(direction);
    // Nose up rolls the surface down.
    setOffset((o) => o + direction * 2);
  };

  const dockHandlers = (): KnobHandlers => ({
    id,
    label,
    innerLabel: 'Left: nose down. Right: nose up',
    turnInner: (n: number) => {
      for (let i = 0; i < Math.abs(n); i++) roll(n > 0 ? 1 : -1);
    },
  });

  useEffect(() => onDockChange((k) => setDocked(k?.id === id)), [id]);
  useEffect(() => {
    if (docked) refreshDock(dockHandlers());
  });

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scrolling toward you rolls the surface down: nose up.
      acc += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      while (Math.abs(acc) >= WHEEL_PER_DETENT) {
        const dir = acc > 0 ? 1 : -1;
        acc -= dir * WHEEL_PER_DETENT;
        roll(dir);
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const node = el.current!;
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
    const startY = e.clientY;
    const startX = e.clientX;
    let lastY = e.clientY;
    let acc = 0;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TAP_SLOP_PX) moved = true;
      // Screen px to design px, so the feel is the same at any zoom.
      const scale = node.getBoundingClientRect().height / h;
      acc += (ev.clientY - lastY) / scale;
      lastY = ev.clientY;
      while (Math.abs(acc) >= DRAG_PX_PER_DETENT) {
        const dir = acc > 0 ? 1 : -1;
        acc -= dir * DRAG_PX_PER_DETENT;
        roll(dir);
      }
    };
    const up = (ev: PointerEvent) => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      if (!moved && ev.type === 'pointerup' && (ev.pointerType === 'touch' || ev.pointerType === 'pen')) openDock(dockHandlers());
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') roll(1);
    else if (e.key === 'ArrowDown') roll(-1);
    else return;
    e.preventDefault();
  };

  const shadeId = `${id.replace(/\W/g, '-')}-shade`;
  const ridges = [];
  const shift = ((offset % RIDGE_SPACING) + RIDGE_SPACING) % RIDGE_SPACING;
  for (let ry = shift; ry <= h; ry += RIDGE_SPACING) {
    // Ridges bunch up toward the top and bottom, where the wheel curves away.
    const t = (ry / h) * 2 - 1;
    const yy = h / 2 + (Math.sin((t * Math.PI) / 2) * h) / 2;
    ridges.push(<line key={ry} x1={3} x2={w - 3} y1={yy} y2={yy} class="ap-gmc-ridge" style={{ opacity: 1 - Math.abs(t) * 0.7 }} />);
  }

  return (
    <div
      ref={el}
      class={`ap-gmc-wheel${docked ? ' is-docked' : ''}`}
      style={{ left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` }}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Up arrow: nose up, down arrow: nose down.`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <defs>
          {/* The wheel is a cylinder seen side-on: darker where it curves away. */}
          <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#000" stop-opacity="0.75" />
            <stop offset="0.3" stop-color="#000" stop-opacity="0" />
            <stop offset="0.7" stop-color="#000" stop-opacity="0" />
            <stop offset="1" stop-color="#000" stop-opacity="0.75" />
          </linearGradient>
        </defs>
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={w / 2.6} class="ap-gmc-wheel-body" />
        {ridges}
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={w / 2.6} fill={`url(#${shadeId})`} class="ap-gmc-wheel-shade" />
      </svg>
    </div>
  );
}
