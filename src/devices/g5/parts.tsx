import type { ComponentChildren } from 'preact';
import { G5 } from './palette';

/* Small pieces both G5 pages draw: framed data boxes, stacked units, the bug icon. */

export function DataBox({
  x,
  y,
  w,
  h,
  stroke = 'rgba(255,255,255,0.7)',
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: string;
  children: ComponentChildren;
}) {
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} fill={G5.black} stroke={stroke} stroke-width={1} />
      {children}
    </g>
  );
}

/** Garmin's stacked unit letters ("kt", "ft", "in", "nm"). */
export function Unit({ x, y, a, b, color = G5.white }: { x: number; y: number; a: string; b: string; color?: string }) {
  return (
    <g fill={color} font-size={6.5}>
      <text x={x} y={y - 5}>
        {a}
      </text>
      <text x={x} y={y}>
        {b}
      </text>
    </g>
  );
}

/** The small bug symbol in front of a selected value. */
export function BugIcon({ x, y, color, flip = false }: { x: number; y: number; color: string; flip?: boolean }) {
  return (
    <path
      d={flip ? `M${x} ${y} h5 v12 h-5 v-4 l2.5 -2 l-2.5 -2 Z` : `M${x} ${y} h5 v4 l-2.5 2 l2.5 2 v4 h-5 Z`}
      fill={color}
    />
  );
}
