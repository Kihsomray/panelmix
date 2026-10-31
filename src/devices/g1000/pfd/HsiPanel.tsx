import { formatNav } from '../../../core/frequency';
import { formatBearing, formatDistance } from '../../../ui/format';
import { HsiRose } from '../../../ui/instruments/Hsi';
import { AV } from '../../../ui/instruments/palette';
import type { BearingSolution, CdiSolution } from '../../../sim/radionav';
import type { BearingChoice, WindOption } from './pfdSoftkeys';

/*
 * The lower half of the PFD: the HSI (360 degree rose or the 140 degree
 * arc), the current heading box, selected heading and course boxes,
 * bearing and DME information windows, and the wind window.
 * Positions from Figures 2-1, 2-2 and 2-18 of the Pilot's Guide.
 */

export const HSI = { cx: 457, cy: 585, r: 138 } as const;
const ARC = { cx: 457, cy: 700, r: 230, span: 65 } as const;

export interface BearingInfo {
  readonly choice: BearingChoice;
  readonly solution: BearingSolution;
  /** Frequency for NAV sources. */
  readonly khz: number | null;
}

export interface WindInfo {
  readonly option: WindOption;
  readonly valid: boolean;
  /** Direction the wind blows from, relative to the nose, clockwise. */
  readonly relativeDeg: number;
  readonly speedKt: number;
  readonly fromTrue: number;
  readonly headwindKt: number;
  readonly crosswindKt: number;
}

export interface DmeInfo {
  readonly source: string;
  readonly khz: number | null;
  readonly nm: number | null;
}

export interface HsiPanelProps {
  readonly arc: boolean;
  readonly headingMag: number;
  readonly headingBugMag: number;
  readonly trackMag: number | null;
  readonly turnRateDps: number;
  readonly cdi: CdiSolution;
  /** GPS flight phase (ENR, TERM) and OBS mode for the labels inside the HSI. */
  readonly gpsPhase: string | null;
  readonly obsMode: boolean;
  readonly bearing1: BearingInfo;
  readonly bearing2: BearingInfo;
  readonly dme: DmeInfo | null;
  readonly wind: WindInfo;
  readonly minimumsFt: number | null;
}

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;

/** Annular band between two radii, spanning +/- `span` degrees either side of the top. */
function band(cx: number, cy: number, outer: number, inner: number, span: number): string {
  const p = (deg: number, r: number) => `${cx + Math.cos(rad(deg)) * r} ${cy + Math.sin(rad(deg)) * r}`;
  return `M${p(-span, outer)} A${outer} ${outer} 0 0 1 ${p(span, outer)} L${p(span, inner)} A${inner} ${inner} 0 0 0 ${p(-span, inner)} Z`;
}

function HeadingBox({ heading, y }: { heading: number; y: number }) {
  return (
    <g>
      <rect x={HSI.cx - 38} y={y} width={76} height={32} fill="#000" stroke="#c8c8c8" stroke-width={1.2} />
      <text x={HSI.cx + 2} y={y + 25} text-anchor="middle" font-size={25} fill={AV.white}>
        {formatBearing(heading)}
      </text>
    </g>
  );
}

function DataBox({ x, label, value, color }: { x: number; label: string; value: string; color: string }) {
  return (
    <g>
      <rect x={x} y={432} width={86} height={22} fill="#000" stroke="#c8c8c8" stroke-width={1} />
      <text x={x + 5} y={449} font-size={13} fill={AV.white}>
        {label}
      </text>
      <text x={x + 82} y={450} text-anchor="end" font-size={18} fill={color}>
        {value}
      </text>
    </g>
  );
}

/** Turn-rate ticks: half-standard (9 deg in 6 s) and standard rate (18 deg) either side of the lubber line. */
function TurnRateTicks({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g stroke={AV.white} stroke-width={2}>
      {[-18, -9, 9, 18].map((d) => {
        const a = rad(d);
        const r2 = r + (Math.abs(d) === 18 ? 14 : 9);
        return <line key={d} x1={cx + Math.cos(a) * (r + 3)} y1={cy + Math.sin(a) * (r + 3)} x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2} />;
      })}
    </g>
  );
}

function SourceLabels({ cdi, phase, obs, cx, y }: { cdi: CdiSolution; phase: string | null; obs: boolean; cx: number; y: number }) {
  const color = cdi.color === 'magenta' ? AV.magenta : AV.green;
  return (
    <g font-size={15} fill={color}>
      <text x={cx - 22} y={y} text-anchor="end">
        {cdi.label}
      </text>
      {cdi.source === 'GPS' && phase && (
        <text x={cx + 22} y={y}>
          {phase}
        </text>
      )}
      {cdi.source === 'GPS' && obs && (
        <text x={cx + 22} y={y + 18}>
          OBS
        </text>
      )}
    </g>
  );
}

function ArcHsi(p: HsiPanelProps & { color: string }) {
  const { cx, cy, r, span } = ARC;
  const h = p.headingMag;
  const items = [];
  const start = Math.ceil((h - span) / 5) * 5;
  for (let d = start; d <= h + span; d += 5) {
    const rel = d - h;
    const a = rad(rel);
    const major = d % 10 === 0;
    const len = major ? 14 : 8;
    items.push(
      <line key={`t${d}`} x1={cx + Math.cos(a) * r} y1={cy + Math.sin(a) * r} x2={cx + Math.cos(a) * (r - len)} y2={cy + Math.sin(a) * (r - len)} stroke={AV.white} stroke-width={2} />,
    );
    const norm = ((d % 360) + 360) % 360;
    if (norm % 30 === 0) {
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[norm] ?? String(norm / 10);
      items.push(
        <text key={`l${d}`} x={cx} y={cy - r + 34} transform={`rotate(${rel} ${cx} ${cy})`} text-anchor="middle" font-size={19} fill={AV.white}>
          {label}
        </text>,
      );
    }
  }
  const onArc = (deg: number) => Math.abs(((deg - h + 540) % 360) - 180) <= span;
  const relOf = (deg: number) => ((deg - h + 540) % 360) - 180;
  const dev = Math.max(Math.min(p.cdi.needle, 1), -1) * 80;
  const scaleY = cy - r + 112;
  return (
    <g>
      <path
        d={`M${cx + Math.cos(rad(-span)) * r} ${cy + Math.sin(rad(-span)) * r} A${r} ${r} 0 0 1 ${cx + Math.cos(rad(span)) * r} ${cy + Math.sin(rad(span)) * r}`}
        fill="none"
        stroke={AV.white}
        stroke-width={2}
      />
      <path d={band(cx, cy, r, r - 52, span)} fill="rgba(20,20,24,0.45)" />
      {items}
      {onArc(p.headingBugMag) && (
        <g transform={`rotate(${relOf(p.headingBugMag)} ${cx} ${cy})`}>
          <path d={`M${cx - 12} ${cy - r - 1} v12 h6 l6 -7 l6 7 h6 v-12 Z`} fill={AV.cyan} stroke="#000" />
        </g>
      )}
      {p.trackMag !== null && onArc(p.trackMag) && (
        <g transform={`rotate(${relOf(p.trackMag)} ${cx} ${cy})`}>
          <path d={`M${cx} ${cy - r + 2} l-6 9 6 9 6 -9 Z`} fill={AV.magenta} stroke="#000" />
        </g>
      )}
      {!p.cdi.flag && onArc(p.cdi.courseMag) && (
        <g transform={`rotate(${relOf(p.cdi.courseMag)} ${cx} ${cy})`}>
          <path d={`M${cx} ${cy - r + 4} l-11 20 h7 v40 h8 v-40 h7 Z`} fill={p.color} stroke="#000" />
        </g>
      )}
      {/* Lateral deviation scale with the sliding TO/FROM pointer */}
      <rect x={cx - 100} y={scaleY - 12} width={200} height={24} fill="rgba(0,0,0,0.6)" stroke="#9a9a9a" stroke-width={1} />
      {[-2, -1, 1, 2].map((i) => (
        <circle key={i} cx={cx + i * 40} cy={scaleY} r={4} fill="none" stroke={AV.white} stroke-width={2} />
      ))}
      <line x1={cx} x2={cx} y1={scaleY - 10} y2={scaleY + 10} stroke={AV.white} stroke-width={1.5} />
      {!p.cdi.flag && (
        <path
          d={p.cdi.toFrom === 'FROM' ? `M${cx + dev} ${scaleY + 10} l-9 -16 h18 Z` : `M${cx + dev} ${scaleY - 10} l-9 16 h18 Z`}
          fill={p.color}
          stroke="#000"
        />
      )}
      <path d={`M${cx} ${cy - r - 2} l-8 -14 h16 Z`} fill={AV.white} stroke="#000" />
      <SourceLabels cdi={p.cdi} phase={p.gpsPhase} obs={p.obsMode} cx={cx} y={scaleY - 22} />
    </g>
  );
}

function BearingWindow({ info, side }: { info: BearingInfo; side: 'left' | 'right' }) {
  if (info.choice === 'OFF') return null;
  const s = info.solution;
  const left = side === 'left';
  const x = left ? 238 : 540;
  const anchor = left ? 'start' : 'end';
  const tx = left ? x + 6 : x + 150;
  const ident = info.choice === 'ADF' ? '' : s.ident ?? (info.khz !== null ? formatNav(info.khz) : '');
  const shape = left ? `M${x} 690 h120 l36 54 h-156 Z` : `M${x + 156} 690 h-120 l-36 54 h156 Z`;
  return (
    <g font-size={15}>
      <path d={shape} fill="rgba(0,0,0,0.78)" stroke="#9a9a9a" stroke-width={1} />
      <text x={tx} y={706} text-anchor={anchor} fill={AV.white}>
        {s.distanceNm !== null ? formatDistance(s.distanceNm) : info.choice === 'ADF' ? '' : '-.--'}
        <tspan font-size={11}>{s.distanceNm !== null || info.choice !== 'ADF' ? 'NM' : ''}</tspan>
      </text>
      <text x={tx} y={723} text-anchor={anchor} fill={AV.cyan}>
        {info.choice === 'ADF' ? '----' : ident}
      </text>
      <text x={tx} y={740} text-anchor={anchor} fill={AV.white}>
        {info.choice}
      </text>
      {left ? (
        <path d={`M${x + 56} 735 h44 M${x + 56} 735 l8 -5 M${x + 56} 735 l8 5`} stroke={AV.cyan} stroke-width={2} fill="none" />
      ) : (
        <path d={`M${x + 50} 732 h44 M${x + 50} 738 h44 M${x + 46} 735 l8 -6 v12 Z M${x + 98} 735 l-8 -6 v12 Z`} stroke={AV.cyan} stroke-width={1.6} fill="none" />
      )}
    </g>
  );
}

function DmeWindow({ dme }: { dme: DmeInfo }) {
  return (
    <g font-size={15}>
      <rect x={238} y={600} width={66} height={80} fill="rgba(0,0,0,0.78)" stroke="#9a9a9a" stroke-width={1} />
      <text x={243} y={617} fill={AV.white}>
        DME
      </text>
      <text x={243} y={635} fill={AV.green}>
        {dme.source}
      </text>
      <text x={243} y={653} fill={AV.green}>
        {dme.khz !== null ? formatNav(dme.khz) : '---.--'}
      </text>
      <text x={243} y={672} fill={AV.white}>
        {dme.nm !== null ? formatDistance(dme.nm) : '-.--'}
        <tspan font-size={11}>NM</tspan>
      </text>
    </g>
  );
}

function Arrow({ x, y, deg, len }: { x: number; y: number; deg: number; len: number }) {
  return (
    <g transform={`rotate(${deg} ${x} ${y})`} stroke={AV.white} fill={AV.white} stroke-width={2.5}>
      <line x1={x} y1={y + len / 2} x2={x} y2={y - len / 2 + 6} />
      <path d={`M${x} ${y - len / 2} l-6 9 h12 Z`} stroke="none" />
    </g>
  );
}

function WindWindow({ wind }: { wind: WindInfo }) {
  if (wind.option === 0) return null;
  const x = 255;
  const y = 466;
  if (!wind.valid) {
    return (
      <g font-size={14} fill={AV.white}>
        <rect x={x} y={y} width={62} height={44} fill="#000" stroke="#9a9a9a" />
        <text x={x + 31} y={y + 19} text-anchor="middle">
          NO WIND
        </text>
        <text x={x + 31} y={y + 37} text-anchor="middle">
          DATA
        </text>
      </g>
    );
  }
  if (wind.option === 1) {
    const head = Math.round(wind.headwindKt);
    const cross = Math.round(wind.crosswindKt);
    return (
      <g font-size={17} fill={AV.white}>
        <rect x={x} y={y} width={56} height={50} fill="#000" stroke="#9a9a9a" />
        {/* Headwind arrow points down (toward the tail), tailwind up; crosswind from the right points left. */}
        <Arrow x={x + 12} y={y + 15} deg={head >= 0 ? 180 : 0} len={20} />
        <Arrow x={x + 12} y={y + 15} deg={cross >= 0 ? 270 : 90} len={20} />
        <text x={x + 26} y={y + 21}>
          {Math.abs(head)}
        </text>
        <text x={x + 8} y={y + 44}>
          {Math.abs(cross)}
        </text>
      </g>
    );
  }
  // The arrow points the way the wind blows, relative to the airplane's nose.
  const toward = wind.relativeDeg + 180;
  return (
    <g font-size={17} fill={AV.white}>
      <rect x={x} y={y} width={wind.option === 3 ? 74 : 62} height={wind.option === 3 ? 50 : 30} fill="#000" stroke="#9a9a9a" />
      <Arrow x={x + 15} y={y + (wind.option === 3 ? 25 : 15)} deg={toward} len={22} />
      {wind.option === 2 ? (
        <text x={x + 56} y={y + 22} text-anchor="end">
          {Math.round(wind.speedKt)}
        </text>
      ) : (
        <>
          <text x={x + 70} y={y + 21} text-anchor="end">
            {formatBearing(wind.fromTrue)}
            <tspan font-size={12}>T</tspan>
          </text>
          <text x={x + 70} y={y + 43} text-anchor="end">
            {Math.round(wind.speedKt)}
            <tspan font-size={12}>KT</tspan>
          </text>
        </>
      )}
    </g>
  );
}

export function HsiPanel(p: HsiPanelProps) {
  const color = p.cdi.color === 'magenta' ? AV.magenta : AV.green;
  const gps = p.cdi.source === 'GPS';
  const courseLabel = gps && !p.obsMode ? 'DTK' : 'CRS';
  const courseValue = gps && !p.obsMode && p.cdi.flag ? '___°' : formatBearing(p.cdi.courseMag);
  const pointers = !p.arc;
  const ptr = (b: BearingInfo) => (pointers && b.choice !== 'OFF' && b.choice !== 'ADF' ? { bearingMag: b.solution.bearingMag, color: AV.cyan } : null);

  return (
    <svg class="g1000-layer" width={1024} height={768} viewBox="0 0 1024 768" aria-hidden="true">
      {p.arc ? (
        <>
          <ArcHsi {...p} color={color} />
          <HeadingBox heading={p.headingMag} y={ARC.cy - ARC.r - 50} />
        </>
      ) : (
        <>
          <HsiRose
            cx={HSI.cx}
            cy={HSI.cy}
            r={HSI.r}
            headingMag={p.headingMag}
            headingBugMag={p.headingBugMag}
            course={{ courseMag: p.cdi.courseMag, needle: p.cdi.needle, toFrom: p.cdi.toFrom, color, flag: p.cdi.flag }}
            bearing1={ptr(p.bearing1)}
            bearing2={ptr(p.bearing2)}
            trackMag={p.trackMag}
            turnRateDps={p.turnRateDps}
            fontSize={19}
            fill="rgba(20, 20, 24, 0.45)"
          />
          {(ptr(p.bearing1) || ptr(p.bearing2)) && <circle cx={HSI.cx} cy={HSI.cy} r={HSI.r * 0.4} fill="none" stroke={AV.white} stroke-width={1.5} />}
          <TurnRateTicks cx={HSI.cx} cy={HSI.cy} r={HSI.r} />
          <SourceLabels cdi={p.cdi} phase={p.gpsPhase} obs={p.obsMode} cx={HSI.cx} y={HSI.cy - 52} />
          <HeadingBox heading={p.headingMag} y={HSI.cy - HSI.r - 50} />
          <BearingWindow info={p.bearing1} side="left" />
          <BearingWindow info={p.bearing2} side="right" />
        </>
      )}
      <DataBox x={273} label="HDG" value={formatBearing(p.headingBugMag)} color={AV.cyan} />
      <DataBox x={557} label={courseLabel} value={courseValue} color={color} />
      {p.minimumsFt !== null && (
        <g>
          <rect x={622} y={470} width={74} height={40} fill="#000" stroke="#9a9a9a" />
          <text x={659} y={486} text-anchor="middle" font-size={13} fill={AV.white}>
            BARO MIN
          </text>
          <text x={659} y={505} text-anchor="middle" font-size={17} fill={AV.cyan}>
            {p.minimumsFt}
            <tspan font-size={11}>FT</tspan>
          </text>
        </g>
      )}
      {p.dme && <DmeWindow dme={p.dme} />}
      <WindWindow wind={p.wind} />
    </svg>
  );
}
