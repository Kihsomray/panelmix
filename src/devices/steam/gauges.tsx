import type { ComponentChildren } from 'preact';

/*
 * Round analog instruments for the classic six-pack, drawn in SVG on a
 * 300 x 300 face. Pure drawing: values in, picture out.
 */

const C = 150;
const FACE_R = 132;
const INK = '#f4f4f0';
const FACE = '#141414';

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const pt = (deg: number, r: number) => ({ x: C + Math.cos(rad(deg)) * r, y: C + Math.sin(rad(deg)) * r });

/** Square mounting plate with screws, a round case and glass. Children draw the face. */
export function Gauge({ id, children, label }: { id: string; children: ComponentChildren; label: string }) {
  return (
    <svg viewBox="0 0 300 300" class="gauge-svg" role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${id}-case`} cx="50%" cy="40%" r="60%">
          <stop offset="0" stop-color="#3a3b3e" />
          <stop offset="1" stop-color="#0d0d0e" />
        </radialGradient>
        <radialGradient id={`${id}-glass`} cx="30%" cy="22%" r="80%">
          <stop offset="0" stop-color="rgba(255,255,255,0.16)" />
          <stop offset="0.35" stop-color="rgba(255,255,255,0.03)" />
          <stop offset="1" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
        <clipPath id={`${id}-face`}>
          <circle cx={C} cy={C} r={FACE_R} />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="296" height="296" rx="18" fill="#1a1b1d" stroke="#2c2d30" stroke-width="2" />
      {[
        [22, 22],
        [278, 22],
        [22, 278],
        [278, 278],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <circle cx={x} cy={y} r="7" fill="#2e2f33" stroke="#0b0b0c" />
          <path d={`M${x! - 4.5} ${y! - 1.5} l9 3`} stroke="#0b0b0c" stroke-width="2" />
        </g>
      ))}
      <circle cx={C} cy={C} r="146" fill={`url(#${id}-case)`} />
      <circle cx={C} cy={C} r={FACE_R + 2} fill="#050505" />
      <g clip-path={`url(#${id}-face)`}>
        <circle cx={C} cy={C} r={FACE_R} fill={FACE} />
        {children}
      </g>
      <circle cx={C} cy={C} r={FACE_R} fill={`url(#${id}-glass)`} pointer-events="none" />
    </svg>
  );
}

function Needle({ deg, length, width = 7, tail = 22, color = INK }: { deg: number; length: number; width?: number; tail?: number; color?: string }) {
  return (
    <g transform={`rotate(${deg} ${C} ${C})`}>
      <path d={`M${C - width / 2} ${C + tail} L${C - width / 2} ${C - length + 14} L${C} ${C - length} L${C + width / 2} ${C - length + 14} L${C + width / 2} ${C + tail} Z`} fill={color} />
      <circle cx={C} cy={C} r={width + 3} fill="#222" stroke="#555" />
    </g>
  );
}

function Tick({ deg, r1, r2, w = 2, color = INK }: { deg: number; r1: number; r2: number; w?: number; color?: string }) {
  const a = pt(deg, r1);
  const b = pt(deg, r2);
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} stroke-width={w} />;
}

function Arc({ from, to, r, w, color }: { from: number; to: number; r: number; w: number; color: string }) {
  const a = pt(from, r);
  const b = pt(to, r);
  const large = to - from > 180 ? 1 : 0;
  return <path d={`M${a.x} ${a.y} A${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`} fill="none" stroke={color} stroke-width={w} />;
}

function Label({ deg, r, text, size = 24 }: { deg: number; r: number; text: string; size?: number }) {
  const p = pt(deg, r);
  return (
    <text x={p.x} y={p.y + size * 0.36} text-anchor="middle" font-size={size} fill={INK} class="gauge-text">
      {text}
    </text>
  );
}

// Airspeed ------------------------------------------------------------------

/** 0-40 kt squeezed into the first 30 degrees, then 2.5 degrees per knot. */
const asiAngle = (kt: number) => (kt <= 40 ? (Math.max(kt, 0) / 40) * 30 : 30 + (Math.min(kt, 200) - 40) * 2.5);

export function AirspeedIndicator({ iasKt }: { iasKt: number }) {
  const marks = [];
  for (let kt = 40; kt <= 160; kt += 5) {
    marks.push(<Tick key={kt} deg={asiAngle(kt)} r1={FACE_R - 2} r2={FACE_R - (kt % 10 === 0 ? 20 : 12)} w={kt % 10 === 0 ? 3 : 2} />);
    if (kt % 20 === 0) marks.push(<Label key={`l${kt}`} deg={asiAngle(kt)} r={FACE_R - 40} text={String(kt)} />);
  }
  return (
    <Gauge id="asi" label={`Airspeed ${Math.round(iasKt)} knots`}>
      <Arc from={asiAngle(40)} to={asiAngle(85)} r={FACE_R - 26} w={7} color="#f4f4f0" />
      <Arc from={asiAngle(48)} to={asiAngle(129)} r={FACE_R - 7} w={10} color="#1fae3a" />
      <Arc from={asiAngle(129)} to={asiAngle(163)} r={FACE_R - 7} w={10} color="#e6c619" />
      <Tick deg={asiAngle(163)} r1={FACE_R - 2} r2={FACE_R - 26} w={5} color="#e02424" />
      {marks}
      <text x={C} y={C - 32} text-anchor="middle" font-size="15" fill={INK} class="gauge-text">
        AIRSPEED
      </text>
      <text x={C} y={C + 52} text-anchor="middle" font-size="15" fill={INK} class="gauge-text">
        KNOTS
      </text>
      <Needle deg={asiAngle(iasKt)} length={FACE_R - 8} />
    </Gauge>
  );
}

// Attitude ------------------------------------------------------------------

export function AttitudeGauge({ pitchDeg, bankDeg }: { pitchDeg: number; bankDeg: number }) {
  const ppd = 3.4;
  const pitchMarks = [];
  for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) {
    const w = Math.abs(p) % 10 === 0 ? 46 : 24;
    pitchMarks.push(<line key={p} x1={C - w / 2} x2={C + w / 2} y1={C - p * ppd} y2={C - p * ppd} stroke={INK} stroke-width="2.5" />);
  }
  const bankMarks = [10, 20, 30, 60, 90, -10, -20, -30, -60, -90].map((b) => (
    <Tick key={b} deg={b} r1={FACE_R} r2={FACE_R - (Math.abs(b) >= 30 ? 18 : 11)} w={Math.abs(b) >= 30 ? 4 : 2.5} />
  ));
  return (
    <Gauge id="ai" label={`Attitude: pitch ${Math.round(pitchDeg)}, bank ${Math.round(bankDeg)}`}>
      <g transform={`rotate(${-bankDeg} ${C} ${C})`}>
        <g transform={`translate(0 ${Math.max(Math.min(pitchDeg, 25), -25) * ppd})`}>
          <rect x={-200} y={-300} width={700} height={300 + C} fill="#2f7fd6" />
          <rect x={-200} y={C} width={700} height={500} fill="#7a4a17" />
          <line x1={-200} x2={500} y1={C} y2={C} stroke={INK} stroke-width="3" />
          {pitchMarks}
        </g>
        {/* Sky pointer on the ball's outer ring. */}
        <path d={`M${C} ${C - FACE_R + 24} l-11 18 h22 Z`} fill="#ff7a1a" />
      </g>
      <circle cx={C} cy={C} r={FACE_R - 2} fill="none" stroke="#111" stroke-width="22" opacity="0.55" />
      {bankMarks}
      <path d={`M${C} ${C - FACE_R + 2} l-9 -14 h18 Z`} transform={`rotate(180 ${C} ${C - FACE_R + 2})`} fill={INK} />
      {/* Fixed miniature airplane */}
      <g fill="#ff7a1a" stroke="#000" stroke-width="1.5">
        <path d={`M${C - 78} ${C - 3} h52 l12 12 h-6 l-9 -6 h-49 Z`} />
        <path d={`M${C + 78} ${C - 3} h-52 l-12 12 h6 l9 -6 h49 Z`} />
        <circle cx={C} cy={C} r="6" />
      </g>
      <path d={`M${C - 30} ${C + 112} h60 l-6 -10 h-48 Z`} fill="#333" />
    </Gauge>
  );
}

// Altimeter -----------------------------------------------------------------

export function Altimeter({ altitudeFt, baroInHg }: { altitudeFt: number; baroInHg: number }) {
  const marks = [];
  for (let i = 0; i < 50; i++) {
    const major = i % 5 === 0;
    marks.push(<Tick key={i} deg={i * 7.2} r1={FACE_R - 2} r2={FACE_R - (major ? 20 : 11)} w={major ? 3.5 : 2} />);
  }
  const digits = Array.from({ length: 10 }, (_, d) => <Label key={d} deg={d * 36} r={FACE_R - 38} text={String(d)} size={27} />);
  const hundreds = ((altitudeFt % 1000) + 1000) % 1000;
  const a100 = (hundreds / 1000) * 360;
  const a1000 = ((((altitudeFt % 10000) + 10000) % 10000) / 10000) * 360;
  const a10000 = ((((altitudeFt % 100000) + 100000) % 100000) / 100000) * 360;
  return (
    <Gauge id="alt" label={`Altimeter ${Math.round(altitudeFt)} feet, set to ${baroInHg.toFixed(2)}`}>
      {marks}
      {digits}
      <text x={C} y={C - 46} text-anchor="middle" font-size="13" fill={INK} class="gauge-text">
        ALT
      </text>
      <text x={C - 30} y={C + 42} text-anchor="middle" font-size="11" fill={INK} class="gauge-text">
        100 FEET
      </text>
      {/* Kollsman window */}
      <rect x={C + 48} y={C - 13} width={66} height={26} rx="3" fill="#050505" stroke="#555" />
      <text x={C + 81} y={C + 7} text-anchor="middle" font-size="18" fill={INK} class="gauge-text">
        {baroInHg.toFixed(2)}
      </text>
      {/* 10,000 ft pointer: thin with a triangle at the rim */}
      <g transform={`rotate(${a10000} ${C} ${C})`}>
        <line x1={C} y1={C} x2={C} y2={C - FACE_R + 12} stroke={INK} stroke-width="2" />
        <path d={`M${C} ${C - FACE_R + 4} l-7 14 h14 Z`} fill={INK} />
      </g>
      <Needle deg={a1000} length={68} width={13} tail={10} />
      <Needle deg={a100} length={FACE_R - 10} width={7} tail={24} />
    </Gauge>
  );
}

// Turn coordinator ----------------------------------------------------------

export function TurnCoordinator({ turnRateDps, slip }: { turnRateDps: number; slip: number }) {
  // Standard rate (3 deg/s) lines the wing up with the L/R marks at 20 degrees.
  const tilt = Math.max(Math.min((turnRateDps / 3) * 20, 35), -35);
  const ballX = C + Math.max(Math.min(slip, 1), -1) * 46;
  return (
    <Gauge id="tc" label={`Turn coordinator, ${turnRateDps.toFixed(1)} degrees per second`}>
      {[-20, 20].map((d) => (
        <g key={d}>
          <Tick deg={d - 90} r1={FACE_R - 6} r2={FACE_R - 26} w={5} />
          <Tick deg={d + 90} r1={FACE_R - 6} r2={FACE_R - 26} w={5} />
        </g>
      ))}
      <Tick deg={-90} r1={FACE_R - 6} r2={FACE_R - 26} w={5} />
      <Tick deg={90} r1={FACE_R - 6} r2={FACE_R - 26} w={5} />
      <text x={C - 82} y={C + 50} font-size="22" fill={INK} class="gauge-text">
        L
      </text>
      <text x={C + 70} y={C + 50} font-size="22" fill={INK} class="gauge-text">
        R
      </text>
      <text x={C} y={C - 66} text-anchor="middle" font-size="12" fill={INK} class="gauge-text">
        TURN COORDINATOR
      </text>
      <text x={C} y={C + 96} text-anchor="middle" font-size="11" fill={INK} class="gauge-text">
        2 MIN
      </text>
      <text x={C} y={C + 113} text-anchor="middle" font-size="9" fill={INK} class="gauge-text">
        NO PITCH INFORMATION
      </text>
      {/* Inclinometer */}
      <path d={`M${C - 62} ${C + 52} Q${C} ${C + 80} ${C + 62} ${C + 52}`} fill="none" stroke="#e8e2c8" stroke-width="22" stroke-linecap="round" opacity="0.9" />
      <line x1={C - 13} x2={C - 13} y1={C + 52} y2={C + 76} stroke="#111" stroke-width="2" />
      <line x1={C + 13} x2={C + 13} y1={C + 52} y2={C + 76} stroke="#111" stroke-width="2" />
      <circle cx={ballX} cy={C + 66 - ((ballX - C) / 62) ** 2 * 14} r="10" fill="#111" />
      <g transform={`rotate(${tilt} ${C} ${C})`} fill={INK} stroke="#000" stroke-width="1">
        <path d={`M${C - 92} ${C - 4} h184 v8 h-184 Z`} />
        <circle cx={C} cy={C} r="14" />
        <path d={`M${C - 3} ${C - 34} h6 v24 h-6 Z`} />
        <path d={`M${C - 20} ${C - 30} h40 v5 h-40 Z`} />
      </g>
    </Gauge>
  );
}

// Heading indicator (DG) ---------------------------------------------------

export function HeadingIndicator({ cardHeading, bugMag }: { cardHeading: number; bugMag: number }) {
  const marks = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    marks.push(<Tick key={d} deg={d} r1={FACE_R - 6} r2={FACE_R - (major ? 22 : 14)} w={major ? 3 : 2} />);
    if (d % 30 === 0) {
      const text = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
      const p = pt(d, FACE_R - 42);
      marks.push(
        <text key={`l${d}`} x={p.x} y={p.y + 9} text-anchor="middle" font-size="25" fill={INK} transform={`rotate(${d} ${p.x} ${p.y})`} class="gauge-text">
          {text}
        </text>,
      );
    }
  }
  return (
    <Gauge id="dg" label={`Heading indicator ${Math.round(cardHeading)}, bug ${Math.round(bugMag)}`}>
      <g transform={`rotate(${-cardHeading} ${C} ${C})`}>
        {marks}
        <g transform={`rotate(${bugMag} ${C} ${C})`}>
          <path d={`M${C - 12} ${C - FACE_R + 2} h24 v12 l-6 0 l-6 -7 l-6 7 h-6 Z`} fill="#ff7a1a" />
        </g>
      </g>
      {/* Lubber lines at the 45s and the nose */}
      {[45, 135, 225, 315].map((d) => (
        <Tick key={d} deg={d} r1={FACE_R + 2} r2={FACE_R - 10} w={3} color="#ff7a1a" />
      ))}
      <path d={`M${C} ${C - FACE_R + 18} l-9 -16 h18 Z`} transform={`rotate(180 ${C} ${C - FACE_R + 10})`} fill="#ff7a1a" />
      <g fill={INK} stroke="#000" stroke-width="1.5">
        <path d={`M${C - 3.5} ${C - 44} h7 v80 h-7 Z`} />
        <path d={`M${C - 46} ${C - 8} h92 v9 h-92 Z`} />
        <path d={`M${C - 20} ${C + 28} h40 v7 h-40 Z`} />
      </g>
    </Gauge>
  );
}

// Vertical speed --------------------------------------------------------------

/** 0 at 9 o'clock, +/-2,000 fpm over +/-170 degrees. */
const vsiAngle = (fpm: number) => 270 + (Math.max(Math.min(fpm, 2000), -2000) / 2000) * 170;

export function VerticalSpeedIndicator({ vsFpm }: { vsFpm: number }) {
  const marks = [];
  for (let v = -2000; v <= 2000; v += 100) {
    const major = v % 500 === 0;
    marks.push(<Tick key={v} deg={vsiAngle(v)} r1={FACE_R - 4} r2={FACE_R - (major ? 22 : 12)} w={major ? 3 : 2} />);
    if (v % 500 === 0) {
      const label = v === 0 ? '0' : String(Math.abs(v) / 100 / 10);
      marks.push(<Label key={`l${v}`} deg={vsiAngle(v)} r={FACE_R - 42} text={label === '0.5' ? '.5' : label === '1.5' ? '1.5' : label} size={22} />);
    }
  }
  return (
    <Gauge id="vsi" label={`Vertical speed ${Math.round(vsFpm)} feet per minute`}>
      {marks}
      <text x={C - 12} y={C - 52} text-anchor="middle" font-size="14" fill={INK} class="gauge-text">
        UP
      </text>
      <text x={C - 12} y={C + 62} text-anchor="middle" font-size="14" fill={INK} class="gauge-text">
        DOWN
      </text>
      <text x={C + 30} y={C + 4} text-anchor="middle" font-size="9" fill={INK} class="gauge-text">
        1000 FT/MIN
      </text>
      <Needle deg={vsiAngle(vsFpm)} length={FACE_R - 10} />
    </Gauge>
  );
}

// Course deviation indicator (GI 106A style) -------------------------------

export interface CdiGaugeProps {
  readonly obsCourse: number;
  /** -1..1 */
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  readonly flag: boolean;
  readonly source: 'GPS' | 'VLOC';
}

export function CdiGauge({ obsCourse, needle, toFrom, flag, source }: CdiGaugeProps) {
  const marks = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    marks.push(<Tick key={d} deg={d} r1={FACE_R - 2} r2={FACE_R - (major ? 16 : 10)} w={major ? 2.5 : 1.5} />);
    if (d % 30 === 0) {
      const p = pt(d, FACE_R - 30);
      marks.push(
        <text key={`l${d}`} x={p.x} y={p.y + 7} text-anchor="middle" font-size="18" fill={INK} transform={`rotate(${d} ${p.x} ${p.y})`} class="gauge-text">
          {d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10)}
        </text>,
      );
    }
  }
  const dx = Math.max(Math.min(needle, 1), -1) * 70;
  return (
    <Gauge id="cdi" label={`Course deviation, course ${Math.round(obsCourse)}, ${flag ? 'flagged' : `${toFrom ?? ''}`}`}>
      <g transform={`rotate(${-obsCourse} ${C} ${C})`}>{marks}</g>
      {/* Course index at the top, reciprocal at the bottom */}
      <path d={`M${C} ${C - FACE_R + 24} l-10 -18 h20 Z`} transform={`rotate(180 ${C} ${C - FACE_R + 15})`} fill="#ff7a1a" />
      <path d={`M${C - 8} ${C + FACE_R - 20} h16 v-10 h-16 Z`} fill={INK} />
      {/* Five dots each side and the glideslope scale (flagged: no ILS in the trainer database) */}
      {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={C + i * 14} cy={C} r={i % 5 === 0 ? 4 : 3} fill="none" stroke={INK} stroke-width="2" />
      ))}
      <circle cx={C} cy={C} r="16" fill="none" stroke={INK} stroke-width="2" />
      {/* TO / FROM window */}
      <rect x={C + 30} y={C - 52} width={46} height={22} rx="2" fill="#050505" stroke="#444" />
      {toFrom && !flag && (
        <text x={C + 53} y={C - 36} text-anchor="middle" font-size="15" fill={INK} class="gauge-text">
          {toFrom}
        </text>
      )}
      {flag && (
        <g>
          <rect x={C - 76} y={C - 52} width={42} height={22} fill="#d82020" />
          <text x={C - 55} y={C - 36} text-anchor="middle" font-size="15" fill={INK} class="gauge-text">
            {source === 'GPS' ? 'GPS' : 'NAV'}
          </text>
        </g>
      )}
      <rect x={C - 24} y={C + 30} width={48} height={18} fill="#d82020" />
      <text x={C} y={C + 44} text-anchor="middle" font-size="13" fill={INK} class="gauge-text">
        GS
      </text>
      <line x1={C + dx} x2={C + dx} y1={C - 98} y2={C + 98} stroke={INK} stroke-width="5" stroke-linecap="round" />
    </Gauge>
  );
}

// Magnetic compass ------------------------------------------------------------

export function WhiskeyCompass({ headingMag, wobble }: { headingMag: number; wobble: number }) {
  const h = headingMag + wobble;
  const pxPerDeg = 3.2;
  const items = [];
  for (let d = Math.floor((h - 40) / 5) * 5; d <= h + 40; d += 5) {
    const norm = ((d % 360) + 360) % 360;
    const x = 120 + (d - h) * pxPerDeg;
    const major = norm % 30 === 0;
    items.push(<line key={`t${d}`} x1={x} x2={x} y1={46} y2={major ? 32 : 39} stroke={INK} stroke-width={major ? 2.5 : 1.5} />);
    if (major) {
      const text = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm / 10);
      items.push(
        <text key={`l${d}`} x={x} y={26} text-anchor="middle" font-size="18" fill={INK} class="gauge-text">
          {text}
        </text>,
      );
    }
  }
  return (
    <svg viewBox="0 0 240 64" class="gauge-svg" role="img" aria-label={`Magnetic compass ${Math.round(headingMag)}`}>
      <rect x="1" y="1" width="238" height="62" rx="12" fill="#1b1b1d" stroke="#333" />
      <rect x="18" y="6" width="204" height="48" rx="6" fill="#0e0e0e" />
      <clipPath id="whiskey-clip">
        <rect x="18" y="6" width="204" height="48" rx="6" />
      </clipPath>
      <g clip-path="url(#whiskey-clip)">{items}</g>
      <line x1="120" x2="120" y1="4" y2="58" stroke="#ff7a1a" stroke-width="2.5" />
    </svg>
  );
}

export { asiAngle, vsiAngle };
