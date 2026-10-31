import { AV } from './palette';

/*
 * Glass attitude indicator (SVG), Garmin layout by default: sky/ground with
 * a pitch ladder, a fixed bank scale with a sky pointer that tracks the
 * horizon, slip/skid trapezoid, aircraft symbol and optional flight-director
 * command bars. Draws in its own coordinate box (0..w, 0..h).
 */

export interface AttitudeProps {
  /** Unique id for the SVG clip path. */
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** Aircraft reference point; defaults to the box center. */
  readonly cx?: number;
  readonly cy?: number;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  /** -1..1, ball right positive. */
  readonly slip: number;
  readonly pxPerDeg: number;
  /** Radius of the bank scale arc. */
  readonly bankRadius: number;
  /** Half-width of the pitch ladder's 10-degree lines. */
  readonly ladderHalfWidth?: number;
  /** How far the ladder extends either side of the current pitch, degrees. */
  readonly ladderRangeDeg?: number;
  readonly symbol?: 'chevron' | 'bars' | 'none';
  readonly flightDirector?: { readonly bankDeg: number; readonly pitchDeg: number } | null;
  readonly fontSize?: number;
  /** Clip the moving sky/ground to a rounded window (G5) or the full box (G1000, Aspen). */
  readonly clipRadius?: number;
}

const BANK_TICKS = [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60];

export function AttitudeIndicator(p: AttitudeProps) {
  const cx = p.cx ?? p.w / 2;
  const cy = p.cy ?? p.h / 2;
  const ppd = p.pxPerDeg;
  const half = p.ladderHalfWidth ?? p.w * 0.1;
  const range = p.ladderRangeDeg ?? 25;
  const font = p.fontSize ?? 16;
  const clipId = `att-clip-${p.id}`;
  const ladderClipId = `att-ladder-${p.id}`;
  const big = Math.max(p.w, p.h) * 3;

  const ladder = [];
  const start = Math.ceil((p.pitchDeg - range) / 2.5) * 2.5;
  for (let deg = start; deg <= p.pitchDeg + range; deg += 2.5) {
    if (Math.abs(deg) < 0.01 || Math.abs(deg) > 90) continue;
    const y = cy - deg * ppd;
    const major = Math.abs(deg % 10) < 0.01;
    const mid = !major && Math.abs(deg % 5) < 0.01;
    const hw = major ? half : mid ? half * 0.5 : half * 0.25;
    ladder.push(<line key={`l${deg}`} x1={cx - hw} x2={cx + hw} y1={y} y2={y} stroke={AV.white} stroke-width={major ? 2 : 1.5} />);
    if (major) {
      const label = String(Math.abs(deg));
      ladder.push(
        <text key={`a${deg}`} x={cx - hw - 6} y={y + font * 0.35} text-anchor="end" font-size={font} fill={AV.white} class="av-text-shadow">
          {label}
        </text>,
        <text key={`b${deg}`} x={cx + hw + 6} y={y + font * 0.35} text-anchor="start" font-size={font} fill={AV.white} class="av-text-shadow">
          {label}
        </text>,
      );
    }
  }

  const r = p.bankRadius;
  const tick = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    const len = Math.abs(deg) === 30 || Math.abs(deg) === 60 ? 14 : 8;
    if (Math.abs(deg) === 45) {
      // 45-degree marks are small triangles on Garmin displays.
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      return <circle key={deg} cx={x} cy={y} r={2.5} fill={AV.white} />;
    }
    return (
      <line
        key={deg}
        x1={cx + Math.cos(a) * r}
        y1={cy + Math.sin(a) * r}
        x2={cx + Math.cos(a) * (r + len)}
        y2={cy + Math.sin(a) * (r + len)}
        stroke={AV.white}
        stroke-width={2}
      />
    );
  };
  const arcStart = ((-60 - 90) * Math.PI) / 180;
  const arcEnd = ((60 - 90) * Math.PI) / 180;
  const arc = `M${cx + Math.cos(arcStart) * r} ${cy + Math.sin(arcStart) * r} A${r} ${r} 0 0 1 ${cx + Math.cos(arcEnd) * r} ${cy + Math.sin(arcEnd) * r}`;

  const fd = p.flightDirector;
  return (
    <g class="attitude">
      <defs>
        <clipPath id={clipId}>
          {p.clipRadius !== undefined ? (
            <rect x={0} y={0} width={p.w} height={p.h} rx={p.clipRadius} />
          ) : (
            <rect x={0} y={0} width={p.w} height={p.h} />
          )}
        </clipPath>
        <clipPath id={ladderClipId}>
          <rect x={cx - half * 2} y={cy - r + 18} width={half * 4} height={r * 1.55} />
        </clipPath>
        <linearGradient id={`${clipId}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={AV.skyTop} />
          <stop offset="1" stop-color={AV.sky} />
        </linearGradient>
        <linearGradient id={`${clipId}-gnd`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={AV.ground} />
          <stop offset="1" stop-color={AV.groundBottom} />
        </linearGradient>
      </defs>
      <g clip-path={`url(#${clipId})`}>
        <g transform={`rotate(${-p.bankDeg} ${cx} ${cy}) translate(0 ${p.pitchDeg * ppd})`}>
          <rect x={cx - big} y={cy - big} width={big * 2} height={big} fill={`url(#${clipId}-sky)`} />
          <rect x={cx - big} y={cy} width={big * 2} height={big} fill={`url(#${clipId}-gnd)`} />
          <line x1={cx - big} x2={cx + big} y1={cy} y2={cy} stroke={AV.white} stroke-width={2} />
        </g>
        {/* The ladder shows through a window fixed to the display, not to the horizon. */}
        <g clip-path={`url(#${ladderClipId})`}>
          <g transform={`rotate(${-p.bankDeg} ${cx} ${cy}) translate(0 ${p.pitchDeg * ppd})`}>{ladder}</g>
        </g>
      </g>

      {/* Fixed bank scale with the zero index; the sky pointer rotates with the horizon. */}
      <path d={arc} fill="none" stroke={AV.white} stroke-width={2} />
      {BANK_TICKS.map(tick)}
      <path d={`M${cx} ${cy - r - 2} l-9 -14 h18 Z`} fill={AV.white} />
      <g transform={`rotate(${-p.bankDeg} ${cx} ${cy})`}>
        <path d={`M${cx} ${cy - r + 2} l-10 15 h20 Z`} fill={AV.white} />
        <path
          d={`M${cx - 11 + p.slip * 14} ${cy - r + 20} h22 l3 6 h-28 Z`}
          fill={AV.white}
        />
      </g>

      {fd && (
        // Command bars bank toward the commanded roll: a right roll command tilts them right wing down.
        <g transform={`rotate(${fd.bankDeg - p.bankDeg} ${cx} ${cy}) translate(0 ${-(fd.pitchDeg - p.pitchDeg) * ppd})`}>
          <path
            d={`M${cx} ${cy} l${-half * 1.1} ${half * 0.32} l${half * 0.2} ${half * 0.06} Z M${cx} ${cy} l${half * 1.1} ${half * 0.32} l${-half * 0.2} ${half * 0.06} Z`}
            fill={AV.magenta}
            stroke="#000"
            stroke-width={1}
          />
        </g>
      )}

      {p.symbol !== 'none' && (p.symbol === 'bars' ? <BarsSymbol cx={cx} cy={cy} half={half} /> : <Chevron cx={cx} cy={cy} half={half} />)}
    </g>
  );
}

/** Garmin single-cue aircraft symbol: a yellow inverted V. */
function Chevron({ cx, cy, half }: { cx: number; cy: number; half: number }) {
  const w = half * 1.05;
  const h = half * 0.34;
  return (
    <g>
      <path
        d={`M${cx} ${cy} L${cx - w} ${cy + h} L${cx - w * 0.72} ${cy + h} L${cx} ${cy + h * 0.38} L${cx + w * 0.72} ${cy + h} L${cx + w} ${cy + h} Z`}
        fill={AV.yellow}
        stroke="#000"
        stroke-width={1.5}
      />
    </g>
  );
}

/** Wing bars with a center dot (G5, Aspen, steam-gauge style). */
function BarsSymbol({ cx, cy, half }: { cx: number; cy: number; half: number }) {
  const w = half * 0.9;
  return (
    <g fill={AV.yellow} stroke="#000" stroke-width={1.5}>
      <path d={`M${cx - half * 1.6} ${cy - 3} h${w} v6 h${-w} Z`} />
      <path d={`M${cx + half * 1.6} ${cy - 3} h${-w} v6 h${w} Z`} />
      <rect x={cx - 4} y={cy - 4} width={8} height={8} />
    </g>
  );
}
