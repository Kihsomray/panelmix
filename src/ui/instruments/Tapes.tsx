import { AV, C172_SPEEDS } from './palette';

/*
 * Garmin-style vertical tapes (SVG): airspeed, altitude and vertical speed.
 * Each draws inside its own box (0..w, 0..h) with the current value at the
 * vertical center. Place them with a <g transform="translate(...)">.
 */

export interface SpeedTapeProps {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly iasKt: number;
  /** Speed expected in 6 seconds at the current acceleration, for the trend vector. */
  readonly trendKt?: number;
  readonly pxPerKt: number;
  readonly bugKt?: number | null;
  readonly speeds?: typeof C172_SPEEDS;
  readonly fontSize?: number;
  /** Background behind the scale: translucent over the horizon (G1000) or solid. */
  readonly background?: string;
}

/**
 * The value a mechanical counter shows: it holds each step, then rolls over
 * in the last quarter of it.
 */
export function drumValue(value: number, step: number): number {
  const base = Math.floor(value / step) * step;
  const frac = Math.min(Math.max(((value - base) / step - 0.75) / 0.25, 0), 1);
  return base + frac * step;
}

/**
 * The leading digits beside a drum: they carry once the drum is more than
 * half way into its roll, so 3,499.9 ft (drum almost showing "00") reads
 * 35 rather than 34, and holding 3,500 ft never flickers to "3400".
 */
export function leadingDigits(value: number, step: number, drumSpan: number): number {
  return Math.floor((Math.round(drumValue(value, step) / step) * step) / drumSpan);
}

/**
 * Digit drum for the last digits of a readout: as the value changes the
 * digits roll past, with only the current one fully inside the window.
 */
function RollingDigits({
  value,
  step,
  digits,
  x,
  cy,
  font,
  pitch,
}: {
  value: number;
  /** Increment between drum positions, e.g. 1 kt or 20 ft. */
  step: number;
  /** How many trailing digits the drum shows. */
  digits: number;
  x: number;
  cy: number;
  font: number;
  pitch: number;
}) {
  const mod = 10 ** digits;
  const shown = drumValue(value, step);
  const base = Math.floor(shown / step) * step;
  const frac = (shown - base) / step;
  const items = [];
  for (let k = -2; k <= 2; k++) {
    const v = base + k * step;
    const shown = ((v % mod) + mod) % mod;
    items.push(
      <text key={k} x={x} y={cy + font * 0.36 - (k - frac) * pitch} text-anchor="end" font-size={font} fill={AV.white}>
        {String(shown).padStart(digits, '0')}
      </text>,
    );
  }
  return <g>{items}</g>;
}

export function SpeedTape(p: SpeedTapeProps) {
  const { w, h, iasKt, pxPerKt } = p;
  const font = p.fontSize ?? 18;
  const sp = p.speeds ?? C172_SPEEDS;
  const cy = h / 2;
  const y = (kt: number) => cy - (kt - iasKt) * pxPerKt;
  const visible = h / 2 / pxPerKt + 10;
  const ticks = [];
  for (let kt = Math.max(Math.floor((iasKt - visible) / 5) * 5, 20); kt <= iasKt + visible; kt += 5) {
    const major = kt % 10 === 0;
    ticks.push(<line key={`t${kt}`} x1={w - (major ? 16 : 9)} x2={w} y1={y(kt)} y2={y(kt)} stroke={AV.white} stroke-width={2} />);
    if (major) {
      ticks.push(
        <text key={`n${kt}`} x={w - 20} y={y(kt) + font * 0.36} text-anchor="end" font-size={font} fill={AV.white}>
          {kt}
        </text>,
      );
    }
  }
  const band = (from: number, to: number, color: string, x: number, width: number) => (
    <rect x={x} y={y(to)} width={width} height={Math.max((to - from) * pxPerKt, 0)} fill={color} />
  );
  const boxH = font * 2;
  const clipId = `spd-${p.id}`;
  const trend = p.trendKt ?? iasKt;
  return (
    <g class="speed-tape">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={w} height={h} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill={p.background ?? AV.tape} />
      <g clip-path={`url(#${clipId})`}>
        {ticks}
        {band(sp.vso, sp.vfe, AV.arcWhite, w - 5, 5)}
        {band(sp.vs1, sp.vno, AV.arcGreen, w - 10, 5)}
        {band(sp.vno, sp.vne, AV.arcYellow, w - 10, 5)}
        {band(sp.vne, sp.vne + 200, AV.arcRed, w - 10, 10)}
        {band(0, sp.vs1, AV.arcRed, w - 10, 5)}
        {p.bugKt !== undefined && p.bugKt !== null && (
          <path d={`M${w} ${y(p.bugKt) - 9} h-9 l-6 9 6 9 h9 Z`} fill={AV.cyan} stroke="#000" />
        )}
        {Math.abs(trend - iasKt) > 1 && (
          <line x1={w - 3} x2={w - 3} y1={cy} y2={y(trend)} stroke={AV.magenta} stroke-width={3} />
        )}
      </g>
      {/* Readout box with a pointer, last digit rolling. */}
      <path
        d={`M2 ${cy - boxH / 2} h${w - 22} l12 ${boxH / 2} -12 ${boxH / 2} h${-(w - 22)} Z`}
        fill={AV.readout}
        stroke={AV.white}
        stroke-width={1.5}
      />
      <clipPath id={`${clipId}-box`}>
        <rect x={2} y={cy - boxH / 2 + 1} width={w - 20} height={boxH - 2} />
      </clipPath>
      <g clip-path={`url(#${clipId}-box)`}>
        {iasKt < 20 ? (
          <text x={w - 22} y={cy + font * 0.45} text-anchor="end" font-size={font * 1.25} fill={AV.white}>
            ---
          </text>
        ) : (
          <>
            <text x={w - 22 - font * 0.66} y={cy + font * 0.45} text-anchor="end" font-size={font * 1.25} fill={AV.white}>
              {leadingDigits(iasKt, 1, 10)}
            </text>
            <RollingDigits value={iasKt} step={1} digits={1} x={w - 22} cy={cy + font * 0.09} font={font * 1.25} pitch={boxH} />
          </>
        )}
      </g>
    </g>
  );
}

export interface AltitudeTapeProps {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly altitudeFt: number;
  readonly trendFt?: number;
  /** Pixels per 100 ft. */
  readonly pxPer100: number;
  readonly bugFt?: number | null;
  readonly fontSize?: number;
  readonly background?: string;
  readonly minimumsFt?: number | null;
}

export function AltitudeTape(p: AltitudeTapeProps) {
  const { w, h, altitudeFt, pxPer100 } = p;
  const font = p.fontSize ?? 18;
  const cy = h / 2;
  const y = (ft: number) => cy - ((ft - altitudeFt) / 100) * pxPer100;
  const visible = (h / 2 / pxPer100) * 100 + 200;
  const ticks = [];
  for (let ft = Math.floor((altitudeFt - visible) / 20) * 20; ft <= altitudeFt + visible; ft += 20) {
    const major = ft % 100 === 0;
    ticks.push(<line key={`t${ft}`} x1={0} x2={major ? 16 : 8} y1={y(ft)} y2={y(ft)} stroke={AV.white} stroke-width={2} />);
    if (major) {
      ticks.push(
        <text key={`n${ft}`} x={w - 6} y={y(ft) + font * 0.36} text-anchor="end" font-size={ft % 500 === 0 ? font : font * 0.82} fill={AV.white}>
          {ft}
        </text>,
      );
    }
  }
  const boxH = font * 2.1;
  const clipId = `alt-${p.id}`;
  const thousands = leadingDigits(Math.abs(altitudeFt), 20, 100);
  const trend = p.trendFt ?? altitudeFt;
  return (
    <g class="altitude-tape">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={w} height={h} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill={p.background ?? AV.tape} />
      <g clip-path={`url(#${clipId})`}>
        {ticks}
        {p.bugFt !== undefined && p.bugFt !== null && (
          <path
            d={`M0 ${y(p.bugFt) - 12} h10 v8 l-6 4 6 4 v8 h-10 Z`}
            fill={AV.cyan}
            stroke="#000"
          />
        )}
        {p.minimumsFt !== undefined && p.minimumsFt !== null && (
          <path d={`M0 ${y(p.minimumsFt)} l12 -8 v16 Z`} fill={AV.cyan} />
        )}
        {Math.abs(trend - altitudeFt) > 10 && (
          <line x1={3} x2={3} y1={cy} y2={y(trend)} stroke={AV.magenta} stroke-width={3} />
        )}
      </g>
      <path
        d={`M${w - 2} ${cy - boxH / 2} h${-(w - 16)} l-12 ${boxH / 2} 12 ${boxH / 2} h${w - 16} Z`}
        fill={AV.readout}
        stroke={AV.white}
        stroke-width={1.5}
      />
      <clipPath id={`${clipId}-box`}>
        <rect x={16} y={cy - boxH / 2 + 1} width={w - 18} height={boxH - 2} />
      </clipPath>
      <g clip-path={`url(#${clipId}-box)`}>
        <text x={w - 6 - font * 1.12} y={cy + font * 0.45} text-anchor="end" font-size={font * 1.2} fill={AV.white}>
          {altitudeFt < 0 ? '-' : ''}
          {thousands}
        </text>
        <RollingDigits value={Math.abs(altitudeFt)} step={20} digits={2} x={w - 6} cy={cy + font * 0.07} font={font} pitch={boxH * 0.62} />
      </g>
    </g>
  );
}

export interface VsiTapeProps {
  readonly w: number;
  readonly h: number;
  readonly vsFpm: number;
  readonly bugFpm?: number | null;
  readonly fontSize?: number;
  readonly background?: string;
}

/** Garmin non-linear VSI: +/-2,000 fpm, with the value shown once beyond 100 fpm. */
export function VsiTape(p: VsiTapeProps) {
  const { w, h } = p;
  const font = p.fontSize ?? 14;
  const cy = h / 2;
  const half = h / 2 - 8;
  const y = (fpm: number) => cy - (Math.max(Math.min(fpm, 2000), -2000) / 2000) * half;
  const ticks = [];
  for (let v = -2000; v <= 2000; v += 500) {
    const major = v % 1000 === 0;
    ticks.push(<line key={v} x1={0} x2={major ? 10 : 6} y1={y(v)} y2={y(v)} stroke={AV.white} stroke-width={2} />);
    if (major && v !== 0) {
      ticks.push(
        <text key={`n${v}`} x={13} y={y(v) + font * 0.36} font-size={font} fill={AV.white}>
          {Math.abs(v / 1000)}
        </text>,
      );
    }
  }
  const vs = p.vsFpm;
  const shown = Math.abs(vs) >= 100 ? Math.round(vs / 10) * 10 : null;
  return (
    <g class="vsi-tape">
      <path d={`M0 0 h${w * 0.55} l${w * 0.45} ${h * 0.12} v${h * 0.76} l${-w * 0.45} ${h * 0.12} h${-w * 0.55} Z`} fill={p.background ?? AV.tape} />
      {ticks}
      {p.bugFpm !== undefined && p.bugFpm !== null && <path d={`M0 ${y(p.bugFpm) - 8} h8 l-5 8 5 8 h-8 Z`} fill={AV.cyan} />}
      <path d={`M2 ${y(vs)} l12 -10 h${w - 16} v20 h${-(w - 16)} Z`} fill={AV.black} stroke={AV.white} stroke-width={1.2} />
      {shown !== null && (
        <text x={w - 3} y={y(vs) + font * 0.36} text-anchor="end" font-size={font * 0.95} fill={AV.white}>
          {shown}
        </text>
      )}
    </g>
  );
}
