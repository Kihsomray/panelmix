import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useDeviceScale } from './DeviceFrame';

/*
 * The display glass of a device. Content inside uses screen coordinates
 * (0,0 at the screen's top-left, in design pixels).
 */

export function Screen({
  x,
  y,
  w,
  h,
  children,
  class: className,
  glare = true,
  radius = 2,
  onPointerDown,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: ComponentChildren;
  class?: string;
  glare?: boolean;
  radius?: number;
  onPointerDown?: (e: PointerEvent) => void;
}) {
  return (
    <div
      class={`screen${className ? ` ${className}` : ''}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${radius}px` }}
      onPointerDown={onPointerDown}
    >
      {children}
      {glare && <div class="screen-glare" aria-hidden="true" />}
    </div>
  );
}

/** An SVG layer filling its parent, with a viewBox in design pixels. */
export function ScreenSvg({ w, h, children, class: className }: { w: number; h: number; children: ComponentChildren; class?: string }) {
  return (
    <svg class={`screen-svg${className ? ` ${className}` : ''}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {children}
    </svg>
  );
}

/**
 * A canvas sized for the device's current scale and the screen's pixel
 * density, so it stays sharp at any zoom. `draw` receives a context already
 * scaled to design pixels and runs after every render.
 */
export function ScreenCanvas({
  x = 0,
  y = 0,
  w,
  h,
  draw,
  label,
}: {
  x?: number;
  y?: number;
  w: number;
  h: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useDeviceScale();
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(scale * (window.devicePixelRatio || 1), 4);
    const pw = Math.max(1, Math.round(w * ratio));
    const ph = Math.max(1, Math.round(h * ratio));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
  });
  return (
    <canvas
      ref={ref}
      class="screen-canvas"
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
