import { useMemo } from 'preact/hooks';
import { C172_SPEEDS } from '../../ui/instruments/palette';
import type { VSpeeds } from './settings';
import { ASP, ATT_BOTTOM } from './palette';

/*
 * The Aspen attitude display (Pilot's Guide 2.3.2): sky over brown ground,
 * a roll scale of tick marks with hollow 45-degree triangles, the sky
 * pointer with the slip rectangle under it, the yellow delta aircraft
 * reference, single-cue command bars, and the airspeed and altitude tapes
 * with their selected-value fields. Drawn in display pixels.
 */

const CX = 200;
const CY = 188;
/** Pixels per degree of pitch: the Aspen spreads its ladder wider than most. */
const PPD = 7.1;
const ROLL_R = 150;
const SPEED_W = 64;
const ALT_X = 304;
const KT_PX = 4;
const FT_PX = 0.7;

export interface AttitudeProps {
  readonly id: string;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  readonly slip: number;
  readonly iasKt: number;
  readonly altitudeFt: number;
  readonly vsFpm: number;
  readonly airspeedBugKt: number;
  readonly altitudeBugFt: number;
  readonly minimumsFt: number | null;
  readonly fd: { readonly bankDeg: number; readonly pitchDeg: number } | null;
  readonly fdSolid: boolean;
  readonly tapes: boolean;
  readonly vspeeds: VSpeeds;
  /** Knob states that turn their fields magenta. */
  readonly iasActive: boolean;
  readonly altActive: boolean;
  readonly minActive: boolean;
  readonly altAlertFlag: boolean;
  /** Air data still warming up after power-on: red X over the tapes. */
  readonly airDataInvalid: boolean;
  readonly aligning: boolean;
}

export function Attitude(p: AttitudeProps) {
  const horizon = `rotate(${-p.bankDeg} ${CX} ${CY}) translate(0 ${p.pitchDeg * PPD})`;
  const big = 900;
  const ladder = [];
  for (let d = Math.ceil((p.pitchDeg - 25) / 2.5) * 2.5; d <= p.pitchDeg + 25; d += 2.5) {
    if (Math.abs(d) < 0.01 || Math.abs(d) > 90) continue;
    // Minor marks only up to 20 degrees; major marks every 10 all the way.
    const ten = Math.abs(d % 10) < 0.01;
    if (!ten && Math.abs(d) > 20) continue;
    const y = CY - d * PPD;
    const hw = ten ? 38 : Math.abs(d % 5) < 0.01 ? 20 : 10;
    ladder.push(<line key={`l${d}`} x1={CX - hw} x2={CX + hw} y1={y} y2={y} stroke={ASP.white} stroke-width={2.2} />);
    if (ten) {
      for (const side of [-1, 1]) {
        ladder.push(
          <text key={`t${d}${side}`} x={CX + side * 54} y={y + 7} text-anchor="middle" font-size={19} fill={ASP.white} class="aspen-halo">
            {Math.abs(d)}
          </text>,
        );
      }
    }
  }
  const unusual = p.pitchDeg > 30 ? 'down' : p.pitchDeg < -25 ? 'up' : null;
  const fd = p.fd;

  return (
    <g class="aspen-attitude">
      <defs>
        <clipPath id={`${p.id}-att`}>
          <path d={`M0 0 H400 V${ATT_BOTTOM - 4} H300 L288 338 H112 L100 ${ATT_BOTTOM - 4} H0 Z`} />
        </clipPath>
        <clipPath id={`${p.id}-ladder`}>
          <rect x={CX - 80} y={34} width={160} height={262} />
        </clipPath>
        <linearGradient id={`${p.id}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1={CY - 400} x2="0" y2={CY}>
          <stop offset="0" stop-color={ASP.skyTop} />
          <stop offset="1" stop-color={ASP.skyHorizon} />
        </linearGradient>
        <linearGradient id={`${p.id}-gnd`} gradientUnits="userSpaceOnUse" x1="0" y1={CY} x2="0" y2={CY + 400}>
          <stop offset="0" stop-color={ASP.groundHorizon} />
          <stop offset="1" stop-color={ASP.groundBottom} />
        </linearGradient>
      </defs>
      <g clip-path={`url(#${p.id}-att)`}>
        <g transform={horizon}>
          <rect x={CX - big} y={CY - big} width={big * 2} height={big} fill={`url(#${p.id}-sky)`} />
          <rect x={CX - big} y={CY} width={big * 2} height={big} fill={`url(#${p.id}-gnd)`} />
          <line x1={CX - big} x2={CX + big} y1={CY} y2={CY} stroke={ASP.white} stroke-width={2.4} />
        </g>
        <g clip-path={`url(#${p.id}-ladder)`}>
          <g transform={horizon}>{ladder}</g>
        </g>
        {unusual && <RecoveryChevrons pointing={unusual} />}
        <RollScale bank={p.bankDeg} slip={p.slip} />
        {fd && <CommandBars bank={fd.bankDeg - p.bankDeg} pitch={fd.pitchDeg - p.pitchDeg} solid={p.fdSolid} />}
        <ReferenceSymbol />
        {p.tapes && (
          <>
            <SpeedTape {...p} />
            <AltitudeTape {...p} />
          </>
        )}
      </g>
      {p.tapes && (
        <>
          <ValueField x={0} w={64} value={String(Math.round(p.airspeedBugKt))} unit="kt" active={p.iasActive} />
          <ValueField x={330} w={70} value={String(Math.round(p.altitudeBugFt))} unit="" active={p.altActive} />
          {p.altAlertFlag && <path d="M312 4 h14 v18 h-14 l5 -9 Z" fill={ASP.yellow} />}
        </>
      )}
      {p.minimumsFt !== null && <MinimumsField ft={p.minimumsFt} active={p.minActive} below={p.altitudeFt <= p.minimumsFt} />}
      {p.airDataInvalid && p.tapes && (
        <g stroke={ASP.red} stroke-width={3}>
          <path d={`M4 34 L${SPEED_W - 4} ${ATT_BOTTOM - 8} M${SPEED_W - 4} 34 L4 ${ATT_BOTTOM - 8}`} />
          <path d={`M${ALT_X + 4} 34 L396 ${ATT_BOTTOM - 8} M396 34 L${ALT_X + 4} ${ATT_BOTTOM - 8}`} />
        </g>
      )}
      {p.aligning && (
        <g>
          <rect x={CX - 92} y={92} width={184} height={50} fill="rgba(0,0,0,0.75)" stroke={ASP.yellow} stroke-width={1.5} />
          <text x={CX} y={114} text-anchor="middle" font-size={18} fill={ASP.yellow}>
            AHRS RESET
          </text>
          <text x={CX} y={134} text-anchor="middle" font-size={15} fill={ASP.yellow}>
            ALIGNING - WINGS LEVEL
          </text>
        </g>
      )}
    </g>
  );
}

/** Tick marks at 10, 20, 30 and 60 with hollow triangles at 45; sky pointer and slip rectangle below the zero mark. */
function RollScale({ bank, slip }: { bank: number; slip: number }) {
  const polar = (deg: number, r: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return { x: CX + Math.cos(t) * r, y: CY + Math.sin(t) * r };
  };
  const marks = [-60, -30, -20, -10, 10, 20, 30, 60].map((deg) => {
    const a = polar(deg, ROLL_R);
    const b = polar(deg, ROLL_R + (Math.abs(deg) === 30 || Math.abs(deg) === 60 ? 18 : 11));
    return <line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ASP.white} stroke-width={3} />;
  });
  const hollow = [-45, 45].map((deg) => (
    <path key={deg} d={`M${CX} ${CY - ROLL_R} l-6 -12 h12 Z`} transform={`rotate(${deg} ${CX} ${CY})`} fill="none" stroke={ASP.white} stroke-width={2} />
  ));
  const ball = Math.max(Math.min(slip, 1.5), -1.5) * 20;
  return (
    <g>
      {marks}
      {hollow}
      <path d={`M${CX} ${CY - ROLL_R} l-10 -16 h20 Z`} fill={ASP.white} />
      <g transform={`rotate(${-bank} ${CX} ${CY})`}>
        <path d={`M${CX} ${CY - ROLL_R + 2} l-11 17 h22 Z`} fill={ASP.white} stroke={ASP.black} stroke-width={1} />
        <rect x={CX - 10 + ball} y={CY - ROLL_R + 22} width={20} height={7} fill={ASP.white} stroke={ASP.black} stroke-width={1} />
      </g>
    </g>
  );
}

/** Yellow delta with darker lower faces, and the two wing-level bars. */
function ReferenceSymbol() {
  return (
    <g stroke={ASP.black} stroke-width={1.4}>
      <path d={`M${CX} ${CY} L${CX - 64} ${CY + 21} L${CX} ${CY + 12} Z`} fill={ASP.yellow} />
      <path d={`M${CX} ${CY} L${CX + 64} ${CY + 21} L${CX} ${CY + 12} Z`} fill={ASP.yellow} />
      <path d={`M${CX - 64} ${CY + 21} L${CX} ${CY + 12} L${CX} ${CY + 17} Z`} fill="#a88b00" />
      <path d={`M${CX + 64} ${CY + 21} L${CX} ${CY + 12} L${CX} ${CY + 17} Z`} fill="#a88b00" />
      <path d={`M${CX - 124} ${CY - 4} H${CX - 78} V${CY + 4} H${CX - 124} Z`} fill={ASP.yellow} />
      <path d={`M${CX + 124} ${CY - 4} H${CX + 78} V${CY + 4} H${CX + 124} Z`} fill={ASP.yellow} />
    </g>
  );
}

function CommandBars({ bank, pitch, solid }: { bank: number; pitch: number; solid: boolean }) {
  const dy = Math.max(Math.min(-pitch * PPD, 120), -120);
  const wedge = (s: number) => `M${CX} ${CY - 1} L${CX + s * 86} ${CY + 13} L${CX + s * 86} ${CY + 24} L${CX + s * 66} ${CY + 20} Z`;
  return (
    <g transform={`rotate(${Math.max(Math.min(bank, 40), -40)} ${CX} ${CY}) translate(0 ${dy})`}>
      {[-1, 1].map((s) => (
        <path key={s} d={wedge(s)} fill={solid ? ASP.magenta : 'none'} stroke={solid ? ASP.black : ASP.magenta} stroke-width={solid ? 1.2 : 2} />
      ))}
    </g>
  );
}

/** Red chevrons pointing back to the horizon at extreme pitch attitudes. */
function RecoveryChevrons({ pointing }: { pointing: 'up' | 'down' }) {
  const dir = pointing === 'down' ? 1 : -1;
  const y0 = pointing === 'down' ? 70 : 290;
  return (
    <g fill="none" stroke={ASP.red} stroke-width={5}>
      {[0, 1].map((i) => (
        <path key={i} d={`M${CX - 40} ${y0 + i * 22 * dir} L${CX} ${y0 + (i * 22 + 26) * dir} L${CX + 40} ${y0 + i * 22 * dir}`} />
      ))}
    </g>
  );
}

// Tapes ------------------------------------------------------------------------------

function Drum({ value, step, digits, x, size, pitch }: { value: number; step: number; digits: number; x: number; size: number; pitch: number }) {
  const mod = 10 ** digits;
  const base = Math.floor(value / step) * step;
  const frac = Math.min(Math.max(((value - base) / step - 0.75) / 0.25, 0), 1);
  const rows = [];
  for (let k = -2; k <= 2; k++) {
    const v = base + k * step;
    rows.push(
      <text key={k} x={x} y={CY + size * 0.36 - (k - frac) * pitch} text-anchor="end" font-size={size} fill={ASP.white}>
        {String(((v % mod) + mod) % mod).padStart(digits, '0')}
      </text>,
    );
  }
  return <g>{rows}</g>;
}

/** Airspeed marks, numbers, colour bands and V-speed tags around `base`, which sits at the pointer. */
function SpeedScale({ base, vspeeds }: { base: number; vspeeds: VSpeeds }) {
  const y = (kt: number) => CY - (kt - base) * KT_PX;
  const marks = [];
  for (let kt = Math.max(base - 60, 20); kt <= base + 60; kt += 10) {
    marks.push(<line key={`t${kt}`} x1={SPEED_W - 16} x2={SPEED_W - 6} y1={y(kt)} y2={y(kt)} stroke={ASP.white} stroke-width={2.2} />);
    marks.push(
      <text key={`n${kt}`} x={SPEED_W - 19} y={y(kt) + 7} text-anchor="end" font-size={19} fill={ASP.white}>
        {kt}
      </text>,
    );
  }
  const sp = C172_SPEEDS;
  const band = (from: number, to: number, color: string, x: number, w: number) => (
    <rect x={x} y={y(to)} width={w} height={Math.max((to - from) * KT_PX, 0)} fill={color} />
  );
  const v = vspeeds;
  const markers = v.enabled
    ? [
        { label: 'R', kt: v.vr },
        { label: 'X', kt: v.vx },
        { label: 'Y', kt: v.vy },
        { label: 'G', kt: v.vbg },
        { label: 'A', kt: v.va },
      ].filter((m) => m.kt > 0)
    : [];
  return (
    <g>
      {marks}
      {band(sp.vso, sp.vfe, ASP.white, SPEED_W - 5, 5)}
      {band(sp.vs1, sp.vno, ASP.green, SPEED_W - 10, 5)}
      {band(sp.vno, sp.vne, ASP.yellow, SPEED_W - 10, 5)}
      {band(sp.vne, sp.vne + 150, ASP.red, SPEED_W - 10, 10)}
      {markers.map((m) => (
        <text key={m.label} x={SPEED_W - 2} y={y(m.kt) + 4} text-anchor="end" font-size={11} fill={ASP.white} class="aspen-halo">
          {m.label}
        </text>
      ))}
    </g>
  );
}

function SpeedTape(p: AttitudeProps) {
  const ias = Math.max(p.iasKt, 20);
  const y = (kt: number) => CY - (kt - ias) * KT_PX;
  // The scale is redrawn only every 10 kt; in between one translate moves it.
  const base = Math.round(ias / 10) * 10;
  const scale = useMemo(() => <SpeedScale base={base} vspeeds={p.vspeeds} />, [base, p.vspeeds]);
  const bugColor = p.iasActive ? ASP.magenta : ASP.cyan;
  const bugY = Math.min(Math.max(y(p.airspeedBugKt), 40), ATT_BOTTOM - 10);
  return (
    <g class="aspen-speed">
      <clipPath id={`${p.id}-spd-tape`}>
        <rect x={0} y={28} width={SPEED_W} height={ATT_BOTTOM - 28} />
      </clipPath>
      <rect x={0} y={28} width={SPEED_W} height={ATT_BOTTOM - 28} fill={ASP.tape} />
      <g clip-path={`url(#${p.id}-spd-tape)`}>
        <g transform={`translate(0 ${(ias - base) * KT_PX})`}>{scale}</g>
      </g>
      <path d={`M${SPEED_W} ${bugY - 9} h-8 v5 l-4 4 l4 4 v5 h8 Z`} fill={bugColor} stroke={ASP.black} stroke-width={1} />
      <path
        d={`M0 ${CY - 18} H32 V${CY - 26} H50 V${CY - 7} L58 ${CY} L50 ${CY + 7} V${CY + 26} H32 V${CY + 18} H0 Z`}
        fill={ASP.black}
        stroke={ASP.white}
        stroke-width={1.6}
      />
      <clipPath id={`${p.id}-spd`}>
        <rect x={32.5} y={CY - 25} width={17} height={50} />
      </clipPath>
      {p.iasKt < 20 ? (
        <text x={50} y={CY + 10} text-anchor="end" font-size={28} fill={ASP.white}>
          ---
        </text>
      ) : (
        <>
          <text x={32} y={CY + 10.5} text-anchor="end" font-size={29} fill={ASP.white}>
            {Math.floor(p.iasKt / 10)}
          </text>
          <g clip-path={`url(#${p.id}-spd)`}>
            <Drum value={p.iasKt} step={1} digits={1} x={50} size={29} pitch={27} />
          </g>
        </>
      )}
    </g>
  );
}

/** Altitude marks every 20 ft and numbers every 100 (thousands larger) around `base`. */
function AltitudeScale({ base }: { base: number }) {
  const y = (ft: number) => CY - (ft - base) * FT_PX;
  const marks = [];
  for (let ft = base - 300; ft <= base + 300; ft += 20) {
    const major = ft % 100 === 0;
    marks.push(<line key={`t${ft}`} x1={ALT_X} x2={ALT_X + (major ? 14 : 7)} y1={y(ft)} y2={y(ft)} stroke={ASP.white} stroke-width={2} />);
    if (major) {
      const thousands = Math.trunc(ft / 1000);
      const rest = String(Math.abs(ft % 1000)).padStart(3, '0');
      marks.push(
        <text key={`n${ft}`} x={396} y={y(ft) + 7} text-anchor="end" fill={ASP.white}>
          <tspan font-size={21}>{thousands !== 0 ? thousands : ft < 0 ? '-' : ''}</tspan>
          <tspan font-size={16}>{rest}</tspan>
        </text>,
      );
    }
  }
  return <g>{marks}</g>;
}

function AltitudeTape(p: AttitudeProps) {
  const alt = p.altitudeFt;
  const y = (ft: number) => CY - (ft - alt) * FT_PX;
  const base = Math.round(alt / 100) * 100;
  const scale = useMemo(() => <AltitudeScale base={base} />, [base]);
  const color = p.altActive ? ASP.magenta : ASP.cyan;
  const by = Math.min(Math.max(y(p.altitudeBugFt), 40), ATT_BOTTOM - 12);
  const trend = alt + (p.vsFpm / 60) * 6;
  const hundreds = Math.floor(Math.abs(alt) / 100);
  return (
    <g class="aspen-alt">
      <clipPath id={`${p.id}-alt-tape`}>
        <rect x={ALT_X} y={28} width={400 - ALT_X} height={ATT_BOTTOM - 28} />
      </clipPath>
      <rect x={ALT_X} y={28} width={400 - ALT_X} height={ATT_BOTTOM - 28} fill={ASP.tape} />
      <g clip-path={`url(#${p.id}-alt-tape)`}>
        <g transform={`translate(0 ${(alt - base) * FT_PX})`}>{scale}</g>
      </g>
      {p.minimumsFt !== null && <MinimumsMarkers y={y} minimumsFt={p.minimumsFt} />}
      {Math.abs(trend - alt) > 10 && <line x1={ALT_X + 3} x2={ALT_X + 3} y1={CY} y2={y(trend)} stroke={ASP.magenta} stroke-width={4} />}
      <path d={`M${ALT_X} ${by - 11} h10 v22 h-10 v-7 l5 -4 l-5 -4 Z`} fill={color} stroke={ASP.black} stroke-width={1} />
      <path
        d={`M${ALT_X + 2} ${CY} L${ALT_X + 12} ${CY - 9} V${CY - 18} H362 V${CY - 26} H400 V${CY + 26} H362 V${CY + 18} H${ALT_X + 12} V${CY + 9} Z`}
        fill={ASP.black}
        stroke={ASP.white}
        stroke-width={1.6}
      />
      <text x={362} y={CY + 10.5} text-anchor="end" font-size={29} fill={ASP.white}>
        {alt < 0 ? '-' : ''}
        {hundreds}
      </text>
      <clipPath id={`${p.id}-alt`}>
        <rect x={362.5} y={CY - 25} width={37} height={50} />
      </clipPath>
      <g clip-path={`url(#${p.id}-alt)`}>
        <Drum value={Math.abs(alt)} step={20} digits={2} x={398} size={22} pitch={21} />
      </g>
    </g>
  );
}

/** Approach minimums cues: green 500 ft above, hollow yellow 100 to 200 ft above, striped at minimums. */
function MinimumsMarkers({ y, minimumsFt }: { y: (ft: number) => number; minimumsFt: number }) {
  const x = ALT_X + 1;
  return (
    <g>
      <path d={`M${x} ${y(minimumsFt + 500)} l12 -8 v16 Z`} fill={ASP.green} />
      <path d={`M${x} ${y(minimumsFt + 100)} L${x + 12} ${y(minimumsFt + 200)} V${y(minimumsFt + 100)} Z`} fill="none" stroke={ASP.yellow} stroke-width={2} />
      <path d={`M${x} ${y(minimumsFt)} l14 -10 v20 Z`} fill={ASP.yellow} stroke={ASP.red} stroke-width={3} stroke-dasharray="4 3" />
    </g>
  );
}

function ValueField({ x, w, value, unit, active }: { x: number; w: number; value: string; unit: string; active: boolean }) {
  const color = active ? ASP.magenta : ASP.cyan;
  return (
    <g>
      <rect x={x + 1} y={2} width={w - 2} height={24} fill={ASP.black} stroke="rgba(255,255,255,0.55)" stroke-width={1.2} />
      <text x={x + w - (unit ? 24 : 6)} y={22} text-anchor="end" font-size={21} fill={color}>
        {value}
      </text>
      {unit && (
        <text x={x + w - 5} y={22} text-anchor="end" font-size={13} fill={color}>
          {unit}
        </text>
      )}
    </g>
  );
}

function MinimumsField({ ft, active, below }: { ft: number; active: boolean; below: boolean }) {
  return (
    <g>
      <rect x={236} y={244} width={64} height={44} rx={3} fill="rgba(0,0,0,0.78)" stroke={ASP.white} stroke-width={1} />
      <text x={268} y={262} text-anchor="middle" font-size={14} fill={ASP.white}>
        MIN
      </text>
      <text x={268} y={283} text-anchor="middle" font-size={19} fill={active ? ASP.magenta : ASP.cyan}>
        {Math.round(ft)}
      </text>
      {below && (
        <g>
          <rect x={CX - 66} y={226} width={132} height={26} fill={ASP.black} stroke={ASP.yellow} stroke-width={1.5} />
          <text x={CX} y={246} text-anchor="middle" font-size={20} fill={ASP.yellow}>
            MINIMUMS
          </text>
        </g>
      )}
    </g>
  );
}

