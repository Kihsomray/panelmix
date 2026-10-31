import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useDeviceScale } from '../../../ui/DeviceFrame';
import { Screen } from '../../../ui/Screen';
import { NATIVE_H, NATIVE_SCALE, NATIVE_W, SCREEN } from '../bezel/geometry';

/*
 * The GDU display. Everything inside is laid out on the real 1024 x 768
 * pixel grid (so positions can be taken straight from Garmin screenshots)
 * and scaled onto the glass.
 */

export function NativeScreen({ children, label }: { children: ComponentChildren; label: string }) {
  return (
    <Screen x={SCREEN.x} y={SCREEN.y} w={SCREEN.w} h={SCREEN.h} class="g1000-glass" radius={3}>
      <div
        class="g1000-native"
        role="img"
        aria-label={label}
        style={{ width: `${NATIVE_W}px`, height: `${NATIVE_H}px`, transform: `scale(${NATIVE_SCALE})` }}
      >
        {children}
      </div>
    </Screen>
  );
}

interface LayerProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The canvas repaints only when this changes (maps are expensive; most frames they look the same). */
  readonly drawKey: string;
  readonly draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  readonly label?: string;
}

function Layer({ x, y, w, h, draw, label }: LayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useDeviceScale();
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(scale * NATIVE_SCALE * (window.devicePixelRatio || 1), 3);
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
      class="g1000-canvas"
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}

/** A canvas in native screen pixels that repaints only when `drawKey` changes. */
export const CanvasLayer = memo(
  Layer,
  (a, b) => a.drawKey === b.drawKey && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h,
);
