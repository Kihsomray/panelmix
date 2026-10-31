import { AV } from './palette';

/*
 * Horizontal situation indicator (SVG): a compass card turning with heading,
 * lubber line, heading bug, course pointer with deviation bar and dots,
 * TO/FROM arrow and up to two bearing pointers. Used by the G1000, G5 and
 * Aspen styles; colours follow the CDI source (magenta GPS, green VOR).
 */

export interface HsiPointer {
  readonly bearingMag: number | null;
  readonly color?: string;
}

export interface HsiProps {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly headingMag: number;
  readonly headingBugMag?: number | null;
  /** Course pointer; omit to hide (DG mode). */
  readonly course?: {
    readonly courseMag: number;
    /** -1..1, fly toward the needle. */
    readonly needle: number;
    readonly toFrom: 'TO' | 'FROM' | null;
    readonly color: string;
    /** Red flag: no usable signal. */
    readonly flag?: boolean;
  } | null;
  readonly bearing1?: HsiPointer | null;
  readonly bearing2?: HsiPointer | null;
  /** Ground track marker (magenta diamond on Garmin). */
  readonly trackMag?: number | null;
  readonly fontSize?: number;
  /** Paint the card's inside dark (G1000 rose) or leave it see-through. */
  readonly fill?: string;
  /** Turn-rate trend arc in degrees per 6 s, Garmin style. */
  readonly turnRateDps?: number;
  readonly showAircraft?: boolean;
}

const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

export function HsiRose(p: HsiProps) {
  const { cx, cy, r } = p;
  const font = p.fontSize ?? r * 0.13;
  const rot = -p.headingMag;
  const ticks = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    const a = ((d - 90) * Math.PI) / 180;
    const len = major ? r * 0.1 : r * 0.055;
    ticks.push(
      <line
        key={d}
        x1={cx + Math.cos(a) * r}
        y1={cy + Math.sin(a) * r}
        x2={cx + Math.cos(a) * (r - len)}
        y2={cy + Math.sin(a) * (r - len)}
        stroke={AV.white}
        stroke-width={major ? 2 : 1.5}
      />,
    );
    if (d % 30 === 0) {
      const label = CARDINALS[d] ?? String(d / 10);
      const lr = r - len - font * 0.85;
      ticks.push(
        <text
          key={`l${d}`}
          x={cx}
          y={cy - lr + font * 0.35}
          transform={`rotate(${d} ${cx} ${cy})`}
          text-anchor="middle"
          font-size={CARDINALS[d] ? font * 1.1 : font}
          fill={AV.white}
        >
          {label}
        </text>,
      );
    }
  }

  const course = p.course;
  const dotSpacing = r * 0.2;
  const devPx = course ? Math.max(Math.min(course.needle, 1), -1) * dotSpacing * 2 : 0;

  const bearingPointer = (b: HsiPointer | null | undefined, double: boolean) => {
    if (!b || b.bearingMag === null) return null;
    const color = b.color ?? AV.cyan;
    const len = r * 0.92;
    const inner = r * 0.45;
    const lines = double
      ? [
          <path key="h" d={`M${cx - 4} ${cy - inner} V${cy - len + 14} M${cx + 4} ${cy - inner} V${cy - len + 14} M${cx - 10} ${cy - len + 22} L${cx} ${cy - len} L${cx + 10} ${cy - len + 22}`} />,
          <path key="t" d={`M${cx - 4} ${cy + inner} V${cy + len} M${cx + 4} ${cy + inner} V${cy + len} M${cx - 4} ${cy + len - 6} H${cx + 4}`} />,
        ]
      : [
          <path key="h" d={`M${cx} ${cy - inner} V${cy - len} M${cx - 10} ${cy - len + 20} L${cx} ${cy - len} L${cx + 10} ${cy - len + 20}`} />,
          <path key="t" d={`M${cx} ${cy + inner} V${cy + len} M${cx - 8} ${cy + len - 8} L${cx} ${cy + len - 16} L${cx + 8} ${cy + len - 8}`} />,
        ];
    return (
      <g transform={`rotate(${b.bearingMag} ${cx} ${cy})`} stroke={color} stroke-width={2.2} fill="none">
        {lines}
      </g>
    );
  };

  return (
    <g class="hsi">
      {p.fill && <circle cx={cx} cy={cy} r={r} fill={p.fill} />}
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        {ticks}
        {bearingPointer(p.bearing1, false)}
        {bearingPointer(p.bearing2, true)}
        {course && (
          <g transform={`rotate(${course.courseMag} ${cx} ${cy})`}>
            {/* Course arrow head and tail */}
            <path
              d={`M${cx} ${cy - r * 0.86} L${cx - r * 0.075} ${cy - r * 0.72} H${cx - r * 0.025} V${cy - r * 0.48} H${cx + r * 0.025} V${cy - r * 0.72} H${cx + r * 0.075} Z`}
              fill={course.color}
              stroke="#000"
              stroke-width={1}
            />
            <rect x={cx - r * 0.025} y={cy + r * 0.48} width={r * 0.05} height={r * 0.38} fill={course.color} stroke="#000" stroke-width={1} />
            {/* Deviation dots */}
            {[-2, -1, 1, 2].map((i) => (
              <circle key={i} cx={cx + i * dotSpacing} cy={cy} r={r * 0.032} fill="none" stroke={AV.white} stroke-width={2} />
            ))}
            {!course.flag && (
              <rect
                x={cx + devPx - r * 0.025}
                y={cy - r * 0.44}
                width={r * 0.05}
                height={r * 0.88}
                fill={course.color}
                stroke="#000"
                stroke-width={1}
              />
            )}
            {!course.flag && course.toFrom && (
              <path
                d={
                  course.toFrom === 'TO'
                    ? `M${cx + r * 0.2} ${cy - r * 0.3} l${-r * 0.07} ${r * 0.1} h${r * 0.14} Z`
                    : `M${cx + r * 0.2} ${cy + r * 0.3} l${-r * 0.07} ${-r * 0.1} h${r * 0.14} Z`
                }
                fill={course.color}
                stroke="#000"
              />
            )}
          </g>
        )}
        {p.headingBugMag !== undefined && p.headingBugMag !== null && (
          <g transform={`rotate(${p.headingBugMag} ${cx} ${cy})`}>
            <path
              d={`M${cx - r * 0.09} ${cy - r - 1} v${r * 0.1} h${r * 0.05} l${r * 0.04} ${-r * 0.06} l${r * 0.04} ${r * 0.06} h${r * 0.05} v${-r * 0.1} Z`}
              fill={AV.cyan}
              stroke="#000"
              stroke-width={1}
            />
          </g>
        )}
        {p.trackMag !== undefined && p.trackMag !== null && (
          <g transform={`rotate(${p.trackMag} ${cx} ${cy})`}>
            <path d={`M${cx} ${cy - r + 2} l-6 9 6 9 6 -9 Z`} fill={AV.magenta} stroke="#000" />
          </g>
        )}
      </g>

      {course?.flag && (
        <g>
          <rect x={cx + r * 0.22} y={cy - r * 0.16} width={r * 0.38} height={r * 0.16} fill={AV.red} />
          <text x={cx + r * 0.41} y={cy - r * 0.04} text-anchor="middle" font-size={font * 0.8} fill={AV.white}>
            NO SIG
          </text>
        </g>
      )}

      {/* Fixed lubber line and aircraft symbol */}
      <path d={`M${cx} ${cy - r - 2} l-8 -14 h16 Z`} fill={AV.white} stroke="#000" />
      {p.showAircraft !== false && <AircraftSymbol cx={cx} cy={cy} r={r} />}
      {p.turnRateDps !== undefined && Math.abs(p.turnRateDps) > 0.3 && <TurnTrend cx={cx} cy={cy} r={r} dps={p.turnRateDps} />}
    </g>
  );
}

/** A small top-view airplane fixed at the card's center. */
function AircraftSymbol({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const d = `M${cx} ${cy - r * 0.15} V${cy + r * 0.15} M${cx - r * 0.15} ${cy - r * 0.02} H${cx + r * 0.15} M${cx - r * 0.065} ${cy + r * 0.13} H${cx + r * 0.065}`;
  return (
    <g fill="none" stroke-linecap="round">
      <path d={d} stroke="#000" stroke-width={7} />
      <path d={d} stroke={AV.white} stroke-width={4} />
    </g>
  );
}

/** Magenta arc showing the heading 6 seconds ahead; standard rate reaches the 18-degree marks. */
function TurnTrend({ cx, cy, r, dps }: { cx: number; cy: number; r: number; dps: number }) {
  const deg = Math.max(Math.min(dps * 6, 24), -24);
  const rr = r + 6;
  const a0 = -Math.PI / 2;
  const a1 = ((deg - 90) * Math.PI) / 180;
  const sweep = deg > 0 ? 1 : 0;
  return (
    <path
      d={`M${cx + Math.cos(a0) * rr} ${cy + Math.sin(a0) * rr} A${rr} ${rr} 0 0 ${sweep} ${cx + Math.cos(a1) * rr} ${cy + Math.sin(a1) * rr}`}
      fill="none"
      stroke={AV.magenta}
      stroke-width={4}
    />
  );
}
