import type { EngineState } from '../../../sim/types';
import { AV } from '../../../ui/instruments/palette';
import type { EisPage } from './mfdSoftkeys';

/*
 * Engine Indication System strip along the left of the MFD, Cessna 172S
 * (Pilot's Guide section 3, Figure 3-5): tachometer arc, fuel flow, oil
 * pressure and temperature, EGT, vacuum, fuel quantity left and right,
 * engine hours and the electrical readouts. ENGINE > LEAN shows the
 * leaning display and ENGINE > SYSTEM the numeric system display with the
 * fuel totalizer. Readouts turn yellow or red in the caution and warning
 * ranges, as on the unit.
 *
 * The simulator has one EGT; the four cylinders on the Lean page spread
 * around it so the page reads like a real engine.
 */

const W = 150;
const TOP = 50;
const BAR_X0 = 14;
const BAR_X1 = 136;

type Band = readonly [from: number, to: number, color: string];

interface Gauge {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly bands: readonly Band[];
  readonly ticks?: number;
}

const GREEN = AV.arcGreen;
const YELLOW = AV.arcYellow;
const RED = AV.arcRed;

const FFLOW: Gauge = { label: 'FFLOW GPH', min: 0, max: 20, bands: [[0, 13, GREEN]], ticks: 10 };
const OIL_PRES: Gauge = { label: 'OIL PRES', min: 0, max: 115, bands: [[0, 20, RED], [50, 90, GREEN], [112, 115, RED]] };
const OIL_TEMP: Gauge = { label: 'OIL TEMP', min: 75, max: 250, bands: [[100, 245, GREEN], [245, 250, RED]] };
const EGT: Gauge = { label: 'EGT', min: 1000, max: 1700, bands: [], ticks: 7 };
const VAC: Gauge = { label: 'VAC', min: 3, max: 7, bands: [[4.5, 5.5, GREEN]] };
const FUEL: Gauge = { label: 'FUEL QTY GAL', min: 0, max: 26, bands: [[0, 1.5, RED], [1.5, 5, YELLOW], [5, 24, GREEN]] };

/** Tachometer: 0-3000 rpm, green to 2500 (higher above 5300 ft), white high-rpm range, red from 2700. */
function rpmBands(altitudeFt: number): Band[] {
  const greenTop = altitudeFt > 10300 ? 2700 : altitudeFt > 5300 ? 2600 : 2500;
  return [
    [2100, greenTop, GREEN],
    [greenTop, 2700, '#ffffff'],
    [2700, 3000, RED],
  ];
}

const x = (g: Gauge, v: number) => BAR_X0 + ((Math.min(Math.max(v, g.min), g.max) - g.min) / (g.max - g.min)) * (BAR_X1 - BAR_X0);

/** Readout colour for a value: the band it is in, if that band is a caution or warning. */
function alertColor(bands: readonly Band[], v: number): string {
  const band = bands.find(([a, b]) => v >= a && v <= b);
  return band && (band[2] === RED || band[2] === YELLOW) ? band[2] : AV.white;
}

function Bar({ g, y, value, mark }: { g: Gauge; y: number; value: number; mark?: string }) {
  const ticks = [];
  const n = g.ticks ?? 0;
  for (let i = 0; i <= n; i++) {
    const tx = BAR_X0 + (i / Math.max(n, 1)) * (BAR_X1 - BAR_X0);
    ticks.push(<line key={i} x1={tx} x2={tx} y1={y} y2={y - 6} stroke={AV.white} stroke-width={1.5} />);
  }
  const px = x(g, value);
  const color = alertColor(g.bands, value);
  return (
    <g>
      <text x={W / 2} y={y - 22} text-anchor="middle" font-size={14} fill={AV.white}>
        {g.label}
      </text>
      {g.bands.map(([a, b, c]) => (
        <rect key={`${a}-${b}`} x={x(g, a)} y={y - 5} width={Math.max(x(g, b) - x(g, a), 2)} height={5} fill={c} />
      ))}
      <path d={`M${BAR_X0} ${y - 8} V${y} H${BAR_X1} V${y - 8}`} fill="none" stroke={AV.white} stroke-width={1.5} />
      {ticks}
      <path d={`M${px} ${y - 3} l-7 -12 h14 Z`} fill={color === AV.white ? AV.white : color} stroke="#000" stroke-width={1} />
      {mark && (
        <text x={px} y={y - 8} text-anchor="middle" font-size={9} fill="#000">
          {mark}
        </text>
      )}
    </g>
  );
}

function Tach({ rpm, altitudeFt }: { rpm: number; altitudeFt: number }) {
  const cx = 75;
  const cy = TOP + 80;
  const r = 52;
  const bands = rpmBands(altitudeFt);
  const ang = (v: number) => ((-125 + (Math.min(Math.max(v, 0), 3000) / 3000) * 250 - 90) * Math.PI) / 180;
  const arc = (a: number, b: number, rr: number) => {
    const p0 = { x: cx + Math.cos(ang(a)) * rr, y: cy + Math.sin(ang(a)) * rr };
    const p1 = { x: cx + Math.cos(ang(b)) * rr, y: cy + Math.sin(ang(b)) * rr };
    const large = ((b - a) / 3000) * 250 > 180 ? 1 : 0;
    return `M${p0.x} ${p0.y} A${rr} ${rr} 0 ${large} 1 ${p1.x} ${p1.y}`;
  };
  const a = ang(rpm);
  const color = alertColor(bands.filter((b) => b[2] !== '#ffffff'), rpm);
  return (
    <g>
      <path d={arc(0, 3000, r)} fill="none" stroke={AV.white} stroke-width={2} />
      {bands.map(([from, to, c]) => (
        <path key={from} d={arc(from, to, r - 4)} fill="none" stroke={c} stroke-width={7} />
      ))}
      <line x1={cx} y1={cy} x2={cx + Math.cos(a) * (r - 2)} y2={cy + Math.sin(a) * (r - 2)} stroke={AV.white} stroke-width={3} />
      <text x={cx} y={cy + 4} text-anchor="middle" font-size={11} fill={AV.white}>
        RPM
      </text>
      <text x={cx} y={cy + 34} text-anchor="middle" font-size={30} fill={color}>
        {Math.round(rpm / 10) * 10}
      </text>
      <text x={10} y={cy + 30} font-size={11} fill={AV.white}>
        0
      </text>
      <text x={W - 6} y={cy + 30} text-anchor="end" font-size={11} fill={AV.white}>
        3000
      </text>
    </g>
  );
}

function FuelBar({ y, left, right }: { y: number; left: number; right: number }) {
  const g = FUEL;
  return (
    <g>
      <text x={W / 2} y={y - 24} text-anchor="middle" font-size={14} fill={AV.white}>
        {g.label}
      </text>
      {g.bands.map(([a, b, c]) => (
        <rect key={a} x={x(g, a)} y={y - 3} width={x(g, b) - x(g, a)} height={6} fill={c} />
      ))}
      <path d={`M${BAR_X0} ${y - 7} V${y + 7} M${BAR_X0} ${y} H${BAR_X1} M${x(g, 24)} ${y - 7} V${y + 7}`} stroke={AV.white} stroke-width={1.5} />
      <path d={`M${x(g, left)} ${y - 4} l-8 -13 h16 Z`} fill={alertColor(g.bands, left) === AV.white ? AV.white : alertColor(g.bands, left)} stroke="#000" />
      <text x={x(g, left)} y={y - 9} text-anchor="middle" font-size={9} fill="#000">
        L
      </text>
      <path d={`M${x(g, right)} ${y + 4} l-8 13 h16 Z`} fill={alertColor(g.bands, right) === AV.white ? AV.white : alertColor(g.bands, right)} stroke="#000" />
      <text x={x(g, right)} y={y + 16} text-anchor="middle" font-size={9} fill="#000">
        R
      </text>
      {[0, 10, 20].map((v) => (
        <text key={v} x={x(g, v)} y={y + 30} text-anchor="middle" font-size={11} fill={AV.white}>
          {v}
        </text>
      ))}
      <text x={x(g, 24)} y={y + 30} text-anchor="middle" font-size={11} fill={AV.white}>
        F
      </text>
    </g>
  );
}

function Electrical({ y, e }: { y: number; e: EngineState }) {
  const amps = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(Math.round(v))}`;
  return (
    <g font-size={14} fill={AV.white} text-anchor="middle">
      <path d={`M10 ${y - 5} H36 M114 ${y - 5} H140`} stroke={AV.white} stroke-width={1.2} />
      <text x={W / 2} y={y}>
        ELECTRICAL
      </text>
      <text x={22} y={y + 22}>
        M
      </text>
      <text x={W / 2} y={y + 22}>
        BUS
      </text>
      <text x={W - 22} y={y + 22}>
        E
      </text>
      <text x={24} y={y + 44} font-size={18}>
        {e.volts.toFixed(1)}
      </text>
      <text x={W / 2} y={y + 44} font-size={12}>
        VOLTS
      </text>
      <text x={W - 24} y={y + 44} font-size={18}>
        {(e.volts - 0.1).toFixed(1)}
      </text>
      <text x={22} y={y + 68}>
        M
      </text>
      <text x={W / 2} y={y + 68}>
        BATT
      </text>
      <text x={W - 22} y={y + 68}>
        S
      </text>
      <text x={24} y={y + 90} font-size={18}>
        {amps(e.amps)}
      </text>
      <text x={W / 2} y={y + 90} font-size={12}>
        AMPS
      </text>
      <text x={W - 24} y={y + 90} font-size={18}>
        +0
      </text>
    </g>
  );
}

/** Vacuum from the engine-driven pump: about 5 in Hg above idle. */
export function vacuumInHg(rpm: number): number {
  return Math.min(5.0, (rpm / 1000) * 4.6);
}

/** Cylinder EGT spread around the simulated EGT, cylinder 1 hottest (Lean page). */
export function cylinderEgts(egtF: number): number[] {
  return [egtF, egtF - 18, egtF - 31, egtF - 12];
}

interface EisProps {
  readonly page: EisPage;
  readonly engine: EngineState;
  readonly altitudeFt: number;
  readonly engineHours: number;
  readonly cylinder: number;
  readonly fuelRemGal: number;
  readonly fuelUsedGal: number;
}

function EngineDisplay({ engine: e, altitudeFt, engineHours }: EisProps) {
  return (
    <>
      <Tach rpm={e.rpm} altitudeFt={altitudeFt} />
      <Bar g={FFLOW} y={TOP + 192} value={e.fuelFlowGph} />
      <text x={BAR_X0} y={TOP + 206} font-size={10} fill={AV.white}>
        0
      </text>
      <text x={BAR_X1} y={TOP + 206} font-size={10} text-anchor="end" fill={AV.white}>
        20
      </text>
      <Bar g={OIL_PRES} y={TOP + 248} value={e.oilPressPsi} />
      <Bar g={OIL_TEMP} y={TOP + 298} value={e.oilTempF} />
      <Bar g={EGT} y={TOP + 348} value={e.egtF} mark="1" />
      <Bar g={VAC} y={TOP + 398} value={vacuumInHg(e.rpm)} />
      <FuelBar y={TOP + 458} left={e.fuelGal[0]} right={e.fuelGal[1]} />
      <text x={10} y={TOP + 520} font-size={14} fill={AV.white}>
        ENG HRS
      </text>
      <text x={W - 8} y={TOP + 520} text-anchor="end" font-size={18} fill={AV.white}>
        {engineHours.toFixed(1)}
      </text>
      <Electrical y={TOP + 552} e={e} />
    </>
  );
}

function LeanDisplay({ engine: e, cylinder }: EisProps) {
  const egts = cylinderEgts(e.egtF);
  const peak = Math.max(...egts);
  return (
    <>
      <Bar g={FFLOW} y={TOP + 40} value={e.fuelFlowGph} />
      <text x={W / 2} y={TOP + 76} text-anchor="middle" font-size={18} fill={AV.white}>
        {e.fuelFlowGph.toFixed(1)}
      </text>
      <text x={W / 2} y={TOP + 112} text-anchor="middle" font-size={14} fill={AV.white}>
        EGT °F
      </text>
      {egts.map((t, i) => {
        const h = ((Math.min(Math.max(t, 1000), 1700) - 1000) / 700) * 200;
        const bx = 22 + i * 28;
        const sel = i + 1 === cylinder;
        return (
          <g key={i}>
            <rect x={bx} y={TOP + 330 - h} width={20} height={h} fill={sel ? AV.cyan : '#d0d0d0'} />
            <text x={bx + 10} y={TOP + 348} text-anchor="middle" font-size={13} fill={sel ? AV.cyan : AV.white}>
              {i + 1}
            </text>
          </g>
        );
      })}
      <path d={`M14 ${TOP + 330} H136`} stroke={AV.white} stroke-width={1.5} />
      <text x={10} y={TOP + 384} font-size={14} fill={AV.white}>
        CYL
      </text>
      <text x={W - 10} y={TOP + 384} text-anchor="end" font-size={18} fill={AV.cyan}>
        {cylinder}
      </text>
      <text x={10} y={TOP + 412} font-size={14} fill={AV.white}>
        EGT
      </text>
      <text x={W - 10} y={TOP + 412} text-anchor="end" font-size={18} fill={AV.white}>
        {Math.round(egts[cylinder - 1] ?? e.egtF)}
      </text>
      <text x={10} y={TOP + 440} font-size={14} fill={AV.white}>
        ΔPEAK
      </text>
      <text x={W - 10} y={TOP + 440} text-anchor="end" font-size={18} fill={AV.white}>
        {Math.round((egts[cylinder - 1] ?? peak) - peak)}
      </text>
      <Electrical y={TOP + 552} e={e} />
    </>
  );
}

function Readout({ y, label, value, unit }: { y: number; label: string; value: string; unit: string }) {
  return (
    <g>
      <text x={8} y={y} font-size={13} fill={AV.white}>
        {label}
      </text>
      <text x={8} y={y + 14} font-size={10} fill={AV.white}>
        {unit}
      </text>
      <text x={W - 8} y={y + 8} text-anchor="end" font-size={20} fill={AV.white}>
        {value}
      </text>
    </g>
  );
}

function SystemDisplay({ engine: e, engineHours, fuelRemGal, fuelUsedGal }: EisProps) {
  return (
    <>
      <Readout y={TOP + 26} label="RPM" unit="" value={String(Math.round(e.rpm / 10) * 10)} />
      <Readout y={TOP + 62} label="FFLOW" unit="GPH" value={e.fuelFlowGph.toFixed(1)} />
      <Readout y={TOP + 98} label="OIL PRES" unit="PSI" value={String(Math.round(e.oilPressPsi))} />
      <Readout y={TOP + 134} label="OIL TEMP" unit="°F" value={String(Math.round(e.oilTempF))} />
      <Readout y={TOP + 170} label="EGT" unit="°F" value={String(Math.round(e.egtF))} />
      <Readout y={TOP + 206} label="VAC" unit="IN HG" value={vacuumInHg(e.rpm).toFixed(1)} />
      <FuelBar y={TOP + 270} left={e.fuelGal[0]} right={e.fuelGal[1]} />
      <text x={W / 2} y={TOP + 336} text-anchor="middle" font-size={13} fill={AV.white}>
        FUEL CALC
      </text>
      <Readout y={TOP + 362} label="GAL USED" unit="" value={fuelUsedGal.toFixed(1)} />
      <Readout y={TOP + 392} label="GAL REM" unit="" value={fuelRemGal.toFixed(1)} />
      <Readout y={TOP + 432} label="ENG HRS" unit="" value={engineHours.toFixed(1)} />
      <Electrical y={TOP + 552} e={e} />
    </>
  );
}

export function Eis(p: EisProps) {
  return (
    <svg class="g1000-layer g1000-eis" width={W} height={744} viewBox={`0 0 ${W} 744`} role="img" aria-label="Engine indication">
      <rect x={0} y={TOP} width={W} height={744 - TOP} fill="#0b0d10" />
      <line x1={W - 0.5} x2={W - 0.5} y1={TOP} y2={744} stroke="#8a949e" />
      {p.page === 'engine' && <EngineDisplay {...p} />}
      {p.page === 'lean' && <LeanDisplay {...p} />}
      {p.page === 'system' && <SystemDisplay {...p} />}
    </svg>
  );
}
