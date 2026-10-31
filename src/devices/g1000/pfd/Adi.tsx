import { AttitudeIndicator } from '../../../ui/instruments/Attitude';
import { AV } from '../../../ui/instruments/palette';
import { AltitudeTape, SpeedTape, VsiTape } from '../../../ui/instruments/Tapes';
import type { VSpeed } from './timerRef';

/*
 * The upper half of the PFD on the 1024 x 768 grid: the full-width attitude
 * background with pitch ladder and bank scale, the yellow single-cue
 * aircraft symbol and level marks, the magenta flight director cue, the
 * airspeed tape (TAS and GS below, V-speed flags beside it), and the altitude tape
 * with the selected altitude box above it, baro box below and the VSI on
 * its right. Positions measured from Figure 2-1 of the Pilot's Guide.
 */

const ADI = { cx: 457, cy: 284, top: 50, bottom: 744, pxPerDeg: 7.3, bankRadius: 188 } as const;
const SPD = { x: 153, y: 114, w: 86, h: 342, pxPerKt: 5.6 } as const;
const ALT = { x: 700, y: 118, w: 106, h: 340, pxPer100: 57 } as const;
const VSI = { x: 806, y: 149, w: 51, h: 270 } as const;

export interface AdiProps {
  readonly pitchDeg: number;
  readonly bankDeg: number;
  readonly slip: number;
  readonly iasKt: number;
  /** Airspeed expected in 6 s (magenta trend vector). */
  readonly iasTrendKt: number;
  readonly tasKt: number;
  readonly gsKt: number;
  readonly altitudeFt: number;
  readonly vsFpm: number;
  readonly selectedAltFt: number;
  readonly baroText: string;
  readonly baroStd: boolean;
  /** FLC airspeed reference (cyan box and bug) when FLC is active. */
  readonly flcKt: number | null;
  /** Selected vertical speed bug in VS mode. */
  readonly vsBugFpm: number | null;
  readonly minimumsFt: number | null;
  readonly flightDirector: { readonly bankDeg: number; readonly pitchDeg: number } | null;
  readonly vspeeds: readonly VSpeed[];
  readonly metric: boolean;
}

const M_PER_FT = 0.3048;

/** Garmin single-cue aircraft symbol: a yellow inverted V with level reference marks either side. */
function AircraftSymbol({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g stroke="#000" stroke-width={1.5} stroke-linejoin="round">
      <path d={`M${cx} ${cy} L${cx - 118} ${cy + 30} L${cx - 92} ${cy + 30} L${cx} ${cy + 12} L${cx + 92} ${cy + 30} L${cx + 118} ${cy + 30} Z`} fill="#f6d40a" />
      <path d={`M${cx} ${cy + 12} L${cx - 92} ${cy + 30} L${cx - 60} ${cy + 30} Z M${cx} ${cy + 12} L${cx + 92} ${cy + 30} L${cx + 60} ${cy + 30} Z`} fill="#a88a00" />
      <rect x={cx - 160} y={cy - 3.5} width={42} height={7} fill="#f6d40a" />
      <rect x={cx + 118} y={cy - 3.5} width={42} height={7} fill="#f6d40a" />
    </g>
  );
}

/**
 * Single magenta command cue. It banks the way the airplane should roll and
 * sits above or below the symbol for a pitch command; when the director is
 * satisfied the yellow symbol nests just under it, with the magenta edge
 * still showing above.
 */
function CommandBars({ cx, cy, bankErr, pitchErr }: { cx: number; cy: number; bankErr: number; pitchErr: number }) {
  const dy = Math.max(Math.min(-pitchErr * ADI.pxPerDeg, 120), -120);
  return (
    <g transform={`translate(0 ${dy}) rotate(${Math.max(Math.min(bankErr, 45), -45)} ${cx} ${cy})`}>
      <path
        d={`M${cx} ${cy - 10} L${cx - 134} ${cy + 22} L${cx - 110} ${cy + 22} L${cx} ${cy - 1} L${cx + 110} ${cy + 22} L${cx + 134} ${cy + 22} Z`}
        fill={AV.magenta}
        stroke="#000"
        stroke-width={1.2}
      />
    </g>
  );
}

/** TAS and GS readouts under the airspeed tape. */
function SpeedBox({ y, label, kt }: { y: number; label: string; kt: number }) {
  return (
    <g>
      <rect x={SPD.x - 2} y={y} width={SPD.w + 2} height={22} fill="#000" stroke="#c8c8c8" stroke-width={1} />
      <text x={SPD.x + 4} y={y + 17} font-size={14} fill={AV.white}>
        {label}
      </text>
      <text x={SPD.x + SPD.w - 5} y={y + 17} text-anchor="end" font-size={18} fill={AV.white}>
        {Math.round(kt)}
        <tspan font-size={12}>KT</tspan>
      </text>
    </g>
  );
}

/** Cyan Glide / Vr / Vx / Vy flags just right of the airspeed scale. */
function VSpeedFlags({ vspeeds, iasKt }: { vspeeds: readonly VSpeed[]; iasKt: number }) {
  const cy = SPD.y + SPD.h / 2;
  return (
    <g>
      {vspeeds
        .filter((v) => v.on)
        .map((v) => {
          const y = cy - (v.kt - iasKt) * SPD.pxPerKt;
          if (y < SPD.y + 8 || y > SPD.y + SPD.h - 8) return null;
          return (
            <g key={v.id}>
              <rect x={SPD.x + SPD.w + 2} y={y - 9} width={16} height={18} fill="#000" stroke={AV.cyan} stroke-width={1} />
              <text x={SPD.x + SPD.w + 10} y={y + 6} text-anchor="middle" font-size={15} fill={AV.cyan}>
                {v.flag}
              </text>
            </g>
          );
        })}
    </g>
  );
}

export function Adi(p: AdiProps) {
  const fd = p.flightDirector;
  const cy = ADI.cy - ADI.top;
  return (
    <svg class="g1000-layer" width={1024} height={ADI.bottom} viewBox={`0 0 1024 ${ADI.bottom}`} aria-hidden="true">
      <g transform={`translate(0 ${ADI.top})`}>
        <AttitudeIndicator
          id="g1000-pfd"
          w={1024}
          h={ADI.bottom - ADI.top}
          cx={ADI.cx}
          cy={cy}
          pitchDeg={p.pitchDeg}
          bankDeg={p.bankDeg}
          slip={p.slip}
          pxPerDeg={ADI.pxPerDeg}
          bankRadius={ADI.bankRadius}
          ladderHalfWidth={50}
          ladderRangeDeg={22}
          fontSize={17}
          symbol="none"
          flightDirector={null}
        />
        {fd && <CommandBars cx={ADI.cx} cy={cy} bankErr={fd.bankDeg - p.bankDeg} pitchErr={fd.pitchDeg - p.pitchDeg} />}
        <AircraftSymbol cx={ADI.cx} cy={cy} />
      </g>

      <g transform={`translate(${SPD.x} ${SPD.y})`}>
        <SpeedTape
          id="g1000-spd"
          w={SPD.w}
          h={SPD.h}
          iasKt={p.iasKt}
          trendKt={p.iasTrendKt}
          pxPerKt={SPD.pxPerKt}
          bugKt={p.flcKt}
          fontSize={19}
          background="rgba(40, 40, 46, 0.55)"
        />
      </g>
      <VSpeedFlags vspeeds={p.vspeeds} iasKt={p.iasKt} />
      {p.flcKt !== null && (
        <g>
          <rect x={SPD.x} y={85} width={SPD.w} height={28} fill="#000" stroke="#c8c8c8" stroke-width={1} />
          <text x={SPD.x + SPD.w - 6} y={106} text-anchor="end" font-size={20} fill={AV.cyan}>
            {p.flcKt}
            <tspan font-size={13}>KT</tspan>
          </text>
        </g>
      )}
      <SpeedBox y={459} label="TAS" kt={p.tasKt} />
      <SpeedBox y={482} label="GS" kt={p.gsKt} />

      <g transform={`translate(${VSI.x} ${VSI.y})`}>
        <VsiTape w={VSI.w} h={VSI.h} vsFpm={p.vsFpm} bugFpm={p.vsBugFpm} fontSize={15} background="rgba(40, 40, 46, 0.55)" />
      </g>
      <g transform={`translate(${ALT.x} ${ALT.y})`}>
        <AltitudeTape
          id="g1000-alt"
          w={ALT.w}
          h={ALT.h}
          altitudeFt={p.altitudeFt}
          trendFt={p.altitudeFt + p.vsFpm / 10}
          pxPer100={ALT.pxPer100}
          bugFt={p.selectedAltFt}
          minimumsFt={p.minimumsFt}
          fontSize={19}
          background="rgba(40, 40, 46, 0.55)"
        />
      </g>
      <rect x={ALT.x} y={85} width={ALT.w} height={29} fill="#000" stroke="#c8c8c8" stroke-width={1} />
      <path d={`M${ALT.x + 7} 91 h7 v4 l-4 4 4 4 v4 h-7 Z`} fill={AV.cyan} />
      <text x={ALT.x + ALT.w - 6} y={107} text-anchor="end" font-size={21} fill={AV.cyan}>
        {Math.round(p.selectedAltFt)}
      </text>
      <rect x={ALT.x} y={460} width={ALT.w} height={22} fill="#000" stroke="#c8c8c8" stroke-width={1} />
      <text x={ALT.x + ALT.w / 2} y={477} text-anchor="middle" font-size={p.baroStd ? 16 : 18} fill={AV.cyan}>
        {p.baroText}
      </text>
      {p.metric && (
        <g font-size={15} fill={AV.white}>
          <rect x={ALT.x + 12} y={62} width={ALT.w - 12} height={22} fill="#000" stroke="#c8c8c8" stroke-width={1} />
          <text x={ALT.x + ALT.w - 6} y={79} text-anchor="end" fill={AV.cyan}>
            {Math.round(p.selectedAltFt * M_PER_FT)}
            <tspan font-size={11}>M</tspan>
          </text>
          <rect x={ALT.x + ALT.w + 52} y={ALT.y + ALT.h / 2 - 11} width={64} height={22} fill="#000" stroke="#c8c8c8" stroke-width={1} />
          <text x={ALT.x + ALT.w + 112} y={ALT.y + ALT.h / 2 + 6} text-anchor="end">
            {Math.round(p.altitudeFt * M_PER_FT)}
            <tspan font-size={11}>M</tspan>
          </text>
        </g>
      )}
    </svg>
  );
}
