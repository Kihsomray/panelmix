import { useMemo } from 'preact/hooks';
import { C172_SPEEDS } from '../../ui/instruments/palette';
import { G5 } from './palette';

/*
 * The G5 PFD tapes, in display pixels: airspeed on the left, altitude and
 * the vertical speed scale on the right, heading along the top. They sit
 * over the horizon with a translucent backing, as on the real unit.
 *
 * Render cost: each scale is drawn around a base value that changes only
 * every 10 kt, 100 ft or 10 degrees, as a memoized element Preact can skip;
 * between those steps a single translate moves it.
 */

/**
 * A digit drum: the last digits of a readout roll past like a mechanical
 * counter, the next value sliding in during the last quarter of each step.
 */
function Drum({
  value,
  step,
  digits,
  x,
  cy,
  size,
  pitch,
  fill = G5.white,
}: {
  value: number;
  step: number;
  digits: number;
  x: number;
  cy: number;
  size: number;
  pitch: number;
  fill?: string;
}) {
  const mod = 10 ** digits;
  const base = Math.floor(value / step) * step;
  const frac = Math.min(Math.max(((value - base) / step - 0.75) / 0.25, 0), 1);
  const rows = [];
  for (let k = -2; k <= 2; k++) {
    const v = base + k * step;
    rows.push(
      <text key={k} x={x} y={cy + size * 0.36 - (k - frac) * pitch} text-anchor="end" font-size={size} fill={fill}>
        {String(((v % mod) + mod) % mod).padStart(digits, '0')}
      </text>,
    );
  }
  return <g>{rows}</g>;
}

// Airspeed ---------------------------------------------------------------------

const SPEED_W = 62;
const PX_PER_KT = 4;

const VSPEEDS: readonly { label: string; kt: number }[] = [
  { label: 'R', kt: C172_SPEEDS.vr },
  { label: 'X', kt: C172_SPEEDS.vx },
  { label: 'G', kt: C172_SPEEDS.vg },
  { label: 'Y', kt: C172_SPEEDS.vy },
];

/** Marks, numbers, colour bands and V-speed tags for airspeeds around `base`, which sits at `cy`. */
function SpeedScale({ base, cy, span }: { base: number; cy: number; span: number }) {
  const sp = C172_SPEEDS;
  const y = (kt: number) => cy - (kt - base) * PX_PER_KT;
  const out = [];
  for (let kt = Math.max(Math.floor((base - span) / 5) * 5, 30); kt <= base + span; kt += 5) {
    const major = kt % 10 === 0;
    out.push(<line key={`t${kt}`} x1={SPEED_W - 13 - (major ? 7 : 4)} x2={SPEED_W - 13} y1={y(kt)} y2={y(kt)} stroke={G5.white} stroke-width={1.6} />);
    if (major) {
      out.push(
        <text key={`n${kt}`} x={SPEED_W - 23} y={y(kt) + 5.6} text-anchor="end" font-size={16} fill={G5.white}>
          {kt}
        </text>,
      );
    }
  }
  const strip = SPEED_W - 12;
  const band = (from: number, to: number, color: string, x: number, width: number) => (
    <rect x={x} y={y(to)} width={width} height={Math.max((to - from) * PX_PER_KT, 0)} fill={color} />
  );
  return (
    <g>
      {out}
      {/* Low-speed red, white flap range beside the green normal range, yellow caution range. */}
      {band(0, sp.vso, G5.red, strip, 5)}
      {band(sp.vso, sp.vfe, G5.white, strip, 2.5)}
      {band(sp.vs1, sp.vno, G5.green, strip + 2.5, 2.5)}
      {band(sp.vfe, sp.vno, G5.green, strip, 2.5)}
      {band(sp.vno, sp.vne, G5.yellow, strip, 5)}
      {/* Barber pole above the never-exceed speed. */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={`bp${i}`} x={strip} y={y(sp.vne + (i + 1) * 4)} width={5} height={2 * PX_PER_KT} fill={i % 2 ? G5.white : G5.red} />
      ))}
      {VSPEEDS.map((v) => (
        <g key={v.label} transform={`translate(${SPEED_W + 1} ${y(v.kt)})`}>
          <path d="M0 0 l4 -5.5 h8 v11 h-8 Z" fill={G5.black} stroke={G5.cyan} stroke-width={0.8} />
          <text x={8} y={3.6} text-anchor="middle" font-size={9} fill={G5.cyan}>
            {v.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function SpeedTape({
  id,
  top,
  bottom,
  cy,
  iasKt,
  trendKt,
  bugKt,
}: {
  id: string;
  top: number;
  bottom: number;
  cy: number;
  iasKt: number;
  /** Airspeed 6 seconds ahead. */
  trendKt: number;
  /** Airspeed reference in IAS mode. */
  bugKt: number | null;
}) {
  const w = SPEED_W;
  const sp = C172_SPEEDS;
  const shown = Math.max(iasKt, 20);
  const y = (kt: number) => cy - (kt - shown) * PX_PER_KT;
  const base = Math.round(shown / 10) * 10;
  const span = Math.ceil((cy - top) / PX_PER_KT) + 20;
  const scale = useMemo(() => <SpeedScale base={base} cy={cy} span={span} />, [base, cy, span]);
  const clip = `${id}-spd`;
  const overVne = iasKt >= sp.vne;
  const digitFill = !overVne && trendKt >= sp.vne ? G5.yellow : G5.white;
  return (
    <g class="g5-speed">
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={top} width={w + 14} height={bottom - top} />
        </clipPath>
      </defs>
      <rect x={0} y={top} width={w} height={bottom - top} fill={G5.tape} />
      <g clip-path={`url(#${clip})`}>
        <g transform={`translate(0 ${(shown - base) * PX_PER_KT})`}>{scale}</g>
        {Math.abs(trendKt - iasKt) > 1 && (
          <line x1={w - 5.5} x2={w - 5.5} y1={cy} y2={y(trendKt)} stroke={G5.magenta} stroke-width={2.4} />
        )}
        {bugKt !== null && (
          <path d={`M${w - 7} ${Math.min(Math.max(y(bugKt), top + 6), bottom - 6) - 6} h7 v12 h-7 v-3 l3 -3 l-3 -3 Z`} fill={G5.cyan} stroke={G5.black} stroke-width={0.8} />
        )}
      </g>
      <text x={2} y={bottom - 13} font-size={7.5} fill={G5.white}>
        K
      </text>
      <text x={2} y={bottom - 5} font-size={7.5} fill={G5.white}>
        T
      </text>
      {/* Readout: black pointer box (red past Vne), the last digit on a drum in a taller window. */}
      <path
        d={`M1 ${cy - 11} H29 V${cy - 18} H43 V${cy - 6} L49 ${cy} L43 ${cy + 6} V${cy + 18} H29 V${cy + 11} H1 Z`}
        fill={overVne ? G5.red : G5.black}
        stroke={G5.white}
        stroke-width={1.2}
      />
      <clipPath id={`${clip}-drum`}>
        <rect x={29.5} y={cy - 17.5} width={13} height={35} />
      </clipPath>
      {iasKt < 20 ? (
        <text x={42} y={cy + 7} text-anchor="end" font-size={21} fill={G5.white}>
          ---
        </text>
      ) : (
        <>
          <text x={29} y={cy + 7.6} text-anchor="end" font-size={22} fill={digitFill}>
            {Math.floor(iasKt / 10)}
          </text>
          <g clip-path={`url(#${clip}-drum)`}>
            <Drum value={iasKt} step={1} digits={1} x={42} cy={cy} size={22} pitch={21} fill={digitFill} />
          </g>
        </>
      )}
    </g>
  );
}

// Altitude and vertical speed ---------------------------------------------------

const ALT_X = 236;
const ALT_W = 62;
const PX_PER_FT = 0.6;

function AltitudeScale({ base, cy, span }: { base: number; cy: number; span: number }) {
  const y = (ft: number) => cy - (ft - base) * PX_PER_FT;
  const out = [];
  for (let ft = base - span; ft <= base + span; ft += 20) {
    const major = ft % 100 === 0;
    out.push(<line key={`t${ft}`} x1={ALT_X} x2={ALT_X + (major ? 9 : 5)} y1={y(ft)} y2={y(ft)} stroke={G5.white} stroke-width={1.5} />);
    if (major) {
      out.push(
        <text key={`n${ft}`} x={ALT_X + 12} y={y(ft) + 5.4} font-size={15} fill={G5.white}>
          {ft}
        </text>,
      );
    }
  }
  return <g>{out}</g>;
}

export function AltitudeTape({
  id,
  top,
  bottom,
  cy,
  altitudeFt,
  trendFt,
  bugFt,
}: {
  id: string;
  top: number;
  bottom: number;
  cy: number;
  altitudeFt: number;
  trendFt: number;
  bugFt: number;
}) {
  const x = ALT_X;
  const y = (ft: number) => cy - (ft - altitudeFt) * PX_PER_FT;
  const base = Math.round(altitudeFt / 100) * 100;
  const span = Math.ceil((cy - top) / PX_PER_FT / 100) * 100 + 200;
  const scale = useMemo(() => <AltitudeScale base={base} cy={cy} span={span} />, [base, cy, span]);
  const clip = `${id}-alt`;
  const by = Math.min(Math.max(y(bugFt), top + 7), bottom - 7);
  return (
    <g class="g5-alt">
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={top} width={ALT_W} height={bottom - top} />
        </clipPath>
      </defs>
      <rect x={x} y={top} width={ALT_W} height={bottom - top} fill={G5.tape} />
      <g clip-path={`url(#${clip})`}>
        <g transform={`translate(0 ${(altitudeFt - base) * PX_PER_FT})`}>{scale}</g>
        {Math.abs(trendFt - altitudeFt) > 10 && (
          <line x1={x + ALT_W - 2} x2={x + ALT_W - 2} y1={cy} y2={y(trendFt)} stroke={G5.magenta} stroke-width={2.6} />
        )}
      </g>
      <path d={`M${x} ${by - 8} h7 v16 h-7 v-5 l4 -3 l-4 -3 Z`} fill={G5.cyan} stroke={G5.black} stroke-width={0.8} />
      <path
        d={`M${x + 1} ${cy} L${x + 8} ${cy - 7} V${cy - 12} H${x + 52} V${cy - 19} H${x + 77} V${cy + 19} H${x + 52} V${cy + 12} H${x + 8} V${cy + 7} Z`}
        fill={G5.black}
        stroke={G5.white}
        stroke-width={1.2}
      />
      <text x={x + 52} y={cy + 7.6} text-anchor="end" font-size={22} fill={G5.white}>
        {altitudeFt < 0 ? '-' : ''}
        {Math.floor(Math.abs(altitudeFt) / 100)}
      </text>
      <clipPath id={`${clip}-drum`}>
        <rect x={x + 52.5} y={cy - 18.5} width={24} height={37} />
      </clipPath>
      <g clip-path={`url(#${clip}-drum)`}>
        <Drum value={Math.abs(altitudeFt)} step={20} digits={2} x={x + 76} cy={cy} size={17} pitch={15} />
      </g>
    </g>
  );
}

const VSI_X = 298;
const VSI_W = 22;
const PX_PER_FPM = 0.07;

/** The fixed vertical speed scale: minor marks every 100 fpm, labels every 500. */
function VsScale({ top, bottom, cy }: { top: number; bottom: number; cy: number }) {
  const max = Math.min(cy - top, bottom - cy) / PX_PER_FPM - 40;
  const y = (fpm: number) => cy - fpm * PX_PER_FPM;
  const marks = [];
  for (let v = -1500; v <= 1500; v += 100) {
    if (Math.abs(v) > max) continue;
    const labelled = v !== 0 && v % 500 === 0;
    marks.push(<line key={v} x1={VSI_X + VSI_W - (labelled ? 6 : 3)} x2={VSI_X + VSI_W} y1={y(v)} y2={y(v)} stroke={G5.white} stroke-width={1} />);
    if (labelled) {
      marks.push(
        <text key={`l${v}`} x={VSI_X + VSI_W - 7} y={y(v) + 3} text-anchor="end" font-size={8} fill={G5.white}>
          {Math.abs(v) / 100}
        </text>,
      );
    }
  }
  return (
    <g>
      <rect x={VSI_X} y={top} width={VSI_W} height={bottom - top} fill="rgba(0,0,0,0.35)" />
      {marks}
      <line x1={VSI_X + VSI_W - 6} x2={VSI_X + VSI_W} y1={cy} y2={cy} stroke={G5.white} stroke-width={1.6} />
    </g>
  );
}

export function VerticalSpeed({
  top,
  bottom,
  cy,
  vsFpm,
  bugFpm,
}: {
  top: number;
  bottom: number;
  cy: number;
  vsFpm: number;
  bugFpm: number | null;
}) {
  const scale = useMemo(() => <VsScale top={top} bottom={bottom} cy={cy} />, [top, bottom, cy]);
  const limit = Math.min(cy - top, bottom - cy) / PX_PER_FPM - 40;
  const y = (fpm: number) => cy - Math.max(Math.min(fpm, limit), -limit) * PX_PER_FPM;
  const right = VSI_X + VSI_W;
  return (
    <g class="g5-vsi">
      {scale}
      {bugFpm !== null && (
        <path d={`M${right} ${y(bugFpm) - 6} h-4 v3 l-3 3 l3 3 v3 h4 Z`} fill={G5.cyan} stroke={G5.black} stroke-width={0.6} />
      )}
      <path d={`M${right - 9} ${y(vsFpm)} l7 -5 h2 v10 h-2 Z`} fill={G5.white} stroke={G5.black} stroke-width={0.8} />
    </g>
  );
}

// Heading -------------------------------------------------------------------------

const TAPE_X = 64;
const TAPE_W = 172;
const TAPE_H = 24;
const PX_PER_DEG = 5.1;

const wrap = (d: number) => ((d % 360) + 360) % 360;
const rel = (deg: number, heading: number) => ((deg - heading + 540) % 360) - 180;

/** Marks every degree and numbers every 10 around `base`, which sits at the tape center. */
function HeadingScale({ base, top }: { base: number; top: number }) {
  const cx = TAPE_X + TAPE_W / 2;
  const bottom = top + TAPE_H;
  const half = TAPE_W / 2 / PX_PER_DEG + 12;
  const out = [];
  for (let d = Math.floor(base - half); d <= base + half; d++) {
    const v = wrap(d);
    const x = cx + (d - base) * PX_PER_DEG;
    const len = v % 10 === 0 ? 6 : v % 5 === 0 ? 4 : 1.6;
    out.push(<line key={`t${d}`} x1={x} x2={x} y1={bottom} y2={bottom - len} stroke={G5.white} stroke-width={v % 5 === 0 ? 1.3 : 1.1} />);
    if (v % 10 === 0) {
      out.push(
        <text key={`n${d}`} x={x} y={top + 13} text-anchor="middle" font-size={10.5} fill={G5.white}>
          {String(v === 0 ? 360 : v).padStart(3, '0')}
        </text>,
      );
    }
  }
  return <g>{out}</g>;
}

export function HeadingTape({
  id,
  top,
  headingMag,
  bugMag,
  bugHollow,
  trackMag,
  course,
}: {
  id: string;
  top: number;
  headingMag: number;
  bugMag: number;
  bugHollow: boolean;
  trackMag: number;
  course: { readonly mag: number; readonly color: string } | null;
}) {
  const cx = TAPE_X + TAPE_W / 2;
  const bottom = top + TAPE_H;
  const px = (deg: number) => cx + rel(deg, headingMag) * PX_PER_DEG;
  const base = Math.round(headingMag / 10) * 10;
  const scale = useMemo(() => <HeadingScale base={base} top={top} />, [base, top]);
  const clip = `${id}-hdg`;
  const bx = Math.min(Math.max(px(bugMag), TAPE_X + 4), TAPE_X + TAPE_W - 4);
  return (
    <g class="g5-heading">
      <defs>
        <clipPath id={clip}>
          <rect x={TAPE_X} y={top} width={TAPE_W} height={TAPE_H} />
        </clipPath>
      </defs>
      <rect x={TAPE_X} y={top} width={TAPE_W} height={TAPE_H} fill="rgba(0,0,30,0.18)" />
      <g clip-path={`url(#${clip})`}>
        <g transform={`translate(${-(headingMag - base) * PX_PER_DEG} 0)`}>{scale}</g>
        {course && <path d={`M${px(course.mag)} ${top + 1} v7 M${px(course.mag) - 3} ${top + 4} l3 -3 l3 3`} stroke={course.color} stroke-width={1.6} fill="none" />}
        <path d={`M${px(trackMag)} ${bottom - 7} l4 7 h-8 Z`} fill={G5.magenta} stroke={G5.black} stroke-width={0.6} />
      </g>
      <path
        d={`M${bx - 6} ${bottom} v-5 h3 l3 3 l3 -3 h3 v5 Z`}
        fill={bugHollow ? 'none' : G5.cyan}
        stroke={bugHollow ? G5.cyan : G5.black}
        stroke-width={bugHollow ? 1.2 : 0.7}
      />
      {/* Current heading box with its pointer. */}
      <path d={`M${cx - 19} ${top} h38 v17 h-15 l-4 5 l-4 -5 h-15 Z`} fill={G5.black} stroke={G5.white} stroke-width={1.1} />
      <text x={cx + 3} y={top + 14.6} text-anchor="middle" font-size={15.5} fill={G5.white}>
        {String(Math.round(wrap(headingMag)) || 360).padStart(3, '0')}
        <tspan font-size={10} dy={-5}>
          °
        </tspan>
      </text>
    </g>
  );
}
