import { useMemo } from 'preact/hooks';
import type { BearingSolution } from '../../sim/radionav';
import { ASP } from './palette';

/*
 * The Aspen direction indicator in its two formats (Pilot's Guide 4.4.1):
 * the 360-degree HSI with bearing pointers and a VSI tape beside it, and
 * the 100-degree ARC with the ownship near the bottom, either as an HSI or
 * with a fixed CDI along the bottom. Upright labels every 30 degrees, a blue
 * ground track diamond, the heading bug, and the rate of turn tape along
 * the outside of the scale.
 */

export const CX = 200;
export const ROSE = { cy: 566, r: 152 } as const;
export const ARC = { cy: 676, r: 258, halfSpan: 55 } as const;

const LABELS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

export interface CourseView {
  readonly crsMag: number;
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  /** No usable signal: no deviation or TO/FROM. */
  readonly flag: boolean;
}

export interface CompassProps {
  readonly headingMag: number;
  readonly bugMag: number;
  readonly bugActive: boolean;
  /** GPS steering in charge: the bug shows hollow. */
  readonly bugHollow: boolean;
  readonly trackMag: number;
  readonly turnRateDps: number;
  readonly course: CourseView;
}

const polar = (cy: number, deg: number, r: number) => {
  const t = ((deg - 90) * Math.PI) / 180;
  return { x: CX + Math.cos(t) * r, y: cy + Math.sin(t) * r };
};

/** Two dots either side is full scale; past 2.5 dots the indicator pegs, hollow. */
const DOT = 32;
const pegged = (needle: number) => Math.abs(needle) > 1.25;
const deviationPx = (needle: number) => Math.max(Math.min(needle, 1.25), -1.25) * DOT * 2;

/** Marks every 5 degrees in card coordinates, drawn once: the card turns as a whole. */
function CardMarks({ cy, r }: { cy: number; r: number }) {
  const out = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    const a = polar(cy, d, r);
    const b = polar(cy, d, r - (major ? 16 : 9));
    out.push(<line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ASP.white} stroke-width={major ? 3 : 2} />);
  }
  return <g>{out}</g>;
}

/** The turning card with upright labels every 30 degrees, limited to `within` either side of the lubber. */
function Card({ cy, r, headingMag, within }: { cy: number; r: number; headingMag: number; within: number }) {
  const marks = useMemo(() => <CardMarks cy={cy} r={r} />, [cy, r]);
  const labels = [];
  for (let d = 0; d < 360; d += 30) {
    const rel = ((d - headingMag + 540) % 360) - 180;
    if (Math.abs(rel) > within) continue;
    const c = polar(cy, rel, r - 36);
    labels.push(
      <text key={d} x={c.x} y={c.y + 8} text-anchor="middle" font-size={LABELS[d] ? 24 : 21} fill={ASP.white} class="aspen-halo">
        {LABELS[d] ?? d / 10}
      </text>,
    );
  }
  return (
    <g>
      <g transform={`rotate(${-headingMag} ${CX} ${cy})`}>{marks}</g>
      {labels}
    </g>
  );
}

function HeadingBug({ cy, r, rel, active, hollow }: { cy: number; r: number; rel: number; active: boolean; hollow: boolean }) {
  const color = active ? ASP.magenta : ASP.cyan;
  return (
    <g transform={`rotate(${rel} ${CX} ${cy})`}>
      {active && <line x1={CX} x2={CX} y1={cy} y2={cy - r} stroke={ASP.magenta} stroke-width={2} stroke-dasharray="7 6" />}
      <path
        d={`M${CX - 15} ${cy - r - 11} h10 l5 7 l5 -7 h10 v13 h-30 Z`}
        fill={hollow ? 'none' : color}
        stroke={hollow ? color : ASP.black}
        stroke-width={hollow ? 2 : 1}
      />
    </g>
  );
}

function TrackDiamond({ cy, r, rel }: { cy: number; r: number; rel: number }) {
  return (
    <g transform={`rotate(${rel} ${CX} ${cy})`}>
      <path d={`M${CX} ${cy - r + 1} l7 9 l-7 9 l-7 -9 Z`} fill={ASP.blue} stroke={ASP.black} stroke-width={1} />
    </g>
  );
}

/** White tape from the lubber line along the scale: 3 degrees per second reaches the thick standard-rate mark. */
function TurnRate({ cy, r, dps }: { cy: number; r: number; dps: number }) {
  const rr = r + 7;
  const deg = Math.max(Math.min(dps * 6, 36), -36);
  const marks = [-18, -9, 9, 18].map((d) => {
    const a = polar(cy, d, r + 2);
    const b = polar(cy, d, r + 13);
    return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ASP.white} stroke-width={Math.abs(d) === 18 ? 4 : 1.6} />;
  });
  const start = polar(cy, 0, rr);
  const end = polar(cy, deg, rr);
  const tip = Math.abs(dps * 6) > 36;
  return (
    <g>
      {marks}
      {Math.abs(deg) > 0.6 && (
        <path d={`M${start.x} ${start.y} A${rr} ${rr} 0 0 ${deg > 0 ? 1 : 0} ${end.x} ${end.y}`} fill="none" stroke={ASP.white} stroke-width={5} />
      )}
      {tip && (
        <g transform={`rotate(${deg} ${CX} ${cy})`}>
          <path d={deg > 0 ? `M${CX} ${cy - rr - 7} l12 7 l-12 7 Z` : `M${CX} ${cy - rr - 7} l-12 7 l12 7 Z`} fill={ASP.white} />
        </g>
      )}
    </g>
  );
}

function Ownship({ cy }: { cy: number }) {
  return (
    <path
      transform={`translate(${CX} ${cy})`}
      d="M0 -17 V17 M-17 -3 H17 M-7 14 H7"
      stroke={ASP.white}
      stroke-width={4}
      stroke-linecap="round"
      fill="none"
    />
  );
}

/** The HSI course pointer turning around the ownship, with deviation bar and TO/FROM arrowheads on its halves. */
function CoursePointer({ cy, r, rel, course }: { cy: number; r: number; rel: number; course: CourseView }) {
  const dev = deviationPx(course.needle);
  const peg = pegged(course.needle);
  return (
    <g transform={`rotate(${rel} ${CX} ${cy})`}>
      <path
        d={`M${CX} ${cy - r + 12} L${CX + 13} ${cy - r + 44} H${CX + 3} V${cy - 74} H${CX - 3} V${cy - r + 44} H${CX - 13} Z`}
        fill={ASP.green}
        stroke={ASP.black}
        stroke-width={1}
      />
      <rect x={CX - 3} y={cy + 74} width={6} height={r - 86} fill={ASP.green} stroke={ASP.black} stroke-width={1} />
      {[-2, -1, 1, 2].map((i) => (
        <circle key={i} cx={CX + i * DOT} cy={cy} r={5} fill="none" stroke={ASP.green} stroke-width={2} />
      ))}
      {!course.flag && (
        <rect
          x={CX + dev - 3}
          y={cy - 68}
          width={6}
          height={136}
          fill={peg ? 'none' : ASP.green}
          stroke={peg ? '#2b8f24' : ASP.black}
          stroke-width={peg ? 2 : 1}
        />
      )}
      {!course.flag && course.toFrom === 'TO' && <path d={`M${CX} ${cy - 104} l11 16 h-22 Z`} fill={ASP.green} stroke={ASP.black} />}
      {!course.flag && course.toFrom === 'FROM' && <path d={`M${CX} ${cy + 104} l11 -16 h-22 Z`} fill={ASP.green} stroke={ASP.black} />}
    </g>
  );
}

function BearingPointer({ cy, r, headingMag, solution, double }: { cy: number; r: number; headingMag: number; solution: BearingSolution; double: boolean }) {
  if (solution.bearingMag === null) return null;
  const head = r - 10;
  const lines = double
    ? `M${CX - 4} ${cy - 46} V${cy - head + 18} M${CX + 4} ${cy - 46} V${cy - head + 18} M${CX - 4} ${cy + 46} V${cy + head} M${CX + 4} ${cy + 46} V${cy + head}`
    : `M${CX} ${cy - 46} V${cy - head} M${CX} ${cy + 46} V${cy + head}`;
  return (
    <g transform={`rotate(${solution.bearingMag - headingMag} ${CX} ${cy})`} stroke={ASP.cyan} stroke-width={2.6} fill="none">
      <path d={lines} />
      <path d={`M${CX - 11} ${cy - head + 18} L${CX} ${cy - head} L${CX + 11} ${cy - head + 18}`} />
      <path d={`M${CX - 9} ${cy + head} L${CX} ${cy + head - 12} L${CX + 9} ${cy + head}`} />
    </g>
  );
}

const rel = (deg: number, headingMag: number) => ((deg - headingMag + 540) % 360) - 180;

export function Compass360(p: CompassProps & { readonly bearing1: BearingSolution; readonly bearing2: BearingSolution }) {
  const { cy, r } = ROSE;
  const fixed = [45, 90, 135, 180, 225, 270, 315].map((d) => (
    <path key={d} d={`M${CX} ${cy - r - 5} l-6 -11 h12 Z`} transform={`rotate(${d} ${CX} ${cy})`} fill={ASP.gray} />
  ));
  return (
    <g class="aspen-360">
      <Card cy={cy} r={r} headingMag={p.headingMag} within={180} />
      {fixed}
      <TurnRate cy={cy} r={r} dps={p.turnRateDps} />
      <BearingPointer cy={cy} r={r} headingMag={p.headingMag} solution={p.bearing1} double={false} />
      <BearingPointer cy={cy} r={r} headingMag={p.headingMag} solution={p.bearing2} double />
      <CoursePointer cy={cy} r={r} rel={p.course.crsMag - p.headingMag} course={p.course} />
      <TrackDiamond cy={cy} r={r} rel={p.trackMag - p.headingMag} />
      <HeadingBug cy={cy} r={r} rel={p.bugMag - p.headingMag} active={p.bugActive} hollow={p.bugHollow} />
      <Ownship cy={cy} />
    </g>
  );
}

export function CompassArc(p: CompassProps & { readonly style: 'HSI' | 'CDI'; readonly clipId: string }) {
  const { cy, r, halfSpan } = ARC;
  const a = polar(cy, -halfSpan, r);
  const b = polar(cy, halfSpan, r);
  const wedgeL = polar(cy, -halfSpan - 1, r + 30);
  const wedgeR = polar(cy, halfSpan + 1, r + 30);
  const bugRel = Math.max(Math.min(rel(p.bugMag, p.headingMag), halfSpan + 2), -halfSpan - 2);
  const crsRel = rel(p.course.crsMag, p.headingMag);
  return (
    <g class="aspen-arc">
      <defs>
        <clipPath id={p.clipId}>
          <rect x={0} y={412} width={386} height={316} />
        </clipPath>
        {/* The scale shows 100 degrees: a wedge from the ownship hides the rest of the card. */}
        <clipPath id={`${p.clipId}-scale`}>
          <path d={`M${CX} ${cy} L${wedgeL.x} ${wedgeL.y} A${r + 30} ${r + 30} 0 0 1 ${wedgeR.x} ${wedgeR.y} Z`} />
        </clipPath>
      </defs>
      <path d={`M${a.x} ${a.y} A${r} ${r} 0 0 1 ${b.x} ${b.y}`} fill="none" stroke={ASP.white} stroke-width={2.5} />
      <g clip-path={`url(#${p.clipId}-scale)`}>
        <Card cy={cy} r={r} headingMag={p.headingMag} within={halfSpan} />
      </g>
      <TurnRate cy={cy} r={r} dps={p.turnRateDps} />
      <g clip-path={`url(#${p.clipId})`}>
        {p.style === 'HSI' ? (
          <CoursePointer cy={cy} r={r} rel={crsRel} course={p.course} />
        ) : (
          <CourseStubs cy={cy} r={r} rel={crsRel} />
        )}
      </g>
      {Math.abs(rel(p.trackMag, p.headingMag)) <= halfSpan && <TrackDiamond cy={cy} r={r} rel={rel(p.trackMag, p.headingMag)} />}
      <HeadingBug cy={cy} r={r} rel={bugRel} active={p.bugActive} hollow={p.bugHollow} />
      <Ownship cy={cy} />
      {p.style === 'CDI' && <FixedCdi course={p.course} />}
    </g>
  );
}

/** ARC CDI format: a short arrowhead at the course and a tail stub at its reciprocal, when on the scale. */
function CourseStubs({ cy, r, rel: crs }: { cy: number; r: number; rel: number }) {
  const tail = ((crs + 360) % 360) - 180;
  return (
    <g fill={ASP.green} stroke={ASP.black} stroke-width={1}>
      {Math.abs(crs) <= ARC.halfSpan && (
        <path transform={`rotate(${crs} ${CX} ${cy})`} d={`M${CX} ${cy - r + 10} l12 30 h-8 v14 h-8 v-14 h-8 Z`} />
      )}
      {Math.abs(tail) <= ARC.halfSpan && <rect transform={`rotate(${tail} ${CX} ${cy})`} x={CX - 4} y={cy - r + 12} width={8} height={30} />}
    </g>
  );
}

/** The CDI across the bottom in ARC CDI format: green diamond, TO on the left, FROM on the right. */
function FixedCdi({ course }: { course: CourseView }) {
  const y = 712;
  const peg = pegged(course.needle);
  const x = CX + deviationPx(course.needle);
  return (
    <g>
      {[-2, -1, 1, 2].map((i) => (
        <circle key={i} cx={CX + i * DOT} cy={y} r={5} fill="none" stroke={ASP.white} stroke-width={2} />
      ))}
      <line x1={CX} x2={CX} y1={y - 11} y2={y + 11} stroke={ASP.white} stroke-width={2.5} />
      {!course.flag && (
        <path d={`M${x} ${y - 11} l10 11 l-10 11 l-10 -11 Z`} fill={peg ? 'none' : ASP.green} stroke={peg ? '#2b8f24' : ASP.black} stroke-width={peg ? 2 : 1} />
      )}
      {!course.flag && course.toFrom === 'TO' && (
        <text x={CX - 2 * DOT - 18} y={y + 7} text-anchor="end" font-size={18} fill={ASP.green}>
          TO
        </text>
      )}
      {!course.flag && course.toFrom === 'FROM' && (
        <text x={CX + 2 * DOT + 18} y={y + 7} font-size={18} fill={ASP.green}>
          FROM
        </text>
      )}
    </g>
  );
}

/** VSI tape right of the 360 compass: piecewise scale to 2,000 fpm, shown beyond 100 fpm. */
export function VsiTape({ vsFpm }: { vsFpm: number }) {
  const cy = ROSE.cy;
  const x = 362;
  const px = (fpm: number) => {
    const v = Math.min(Math.abs(fpm), 2000);
    const mag = v <= 500 ? v * 0.114 : v <= 1000 ? 57 + (v - 500) * 0.128 : 121 + (v - 1000) * 0.045;
    return Math.sign(fpm) * mag;
  };
  const scale = [500, 1000, 2000].flatMap((v) =>
    [1, -1].map((s) => (
      <g key={`${v}${s}`}>
        <line x1={x} x2={x + 7} y1={cy - px(v * s)} y2={cy - px(v * s)} stroke={ASP.white} stroke-width={2} />
        <text x={x + 9} y={cy - px(v * s) + 5} font-size={13} fill={ASP.white}>
          {v === 500 ? '.5' : v / 1000}
        </text>
      </g>
    )),
  );
  const show = Math.abs(vsFpm) > 100;
  const top = cy - px(vsFpm);
  return (
    <g class="aspen-vsi">
      {scale}
      <line x1={x} x2={x + 12} y1={cy} y2={cy} stroke={ASP.white} stroke-width={2} />
      {show && <rect x={x + 1} y={Math.min(top, cy)} width={6} height={Math.abs(top - cy)} fill={ASP.white} />}
      {show && Math.abs(vsFpm) > 2000 && (
        <path d={vsFpm > 0 ? `M${x - 2} ${top} l6 -9 l6 9 Z` : `M${x - 2} ${top} l6 9 l6 -9 Z`} fill={ASP.white} />
      )}
    </g>
  );
}
