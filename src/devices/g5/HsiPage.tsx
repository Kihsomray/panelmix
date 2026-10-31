import { useMemo } from 'preact/hooks';
import { norm360 } from '../../core/geo';
import type { BearingSolution } from '../../sim/radionav';
import type { Derived } from '../../sim/simulator';
import type { CdiSource, SimState } from '../../sim/types';
import { formatDistance } from '../../ui/format';
import { headingText } from './format';
import { bearingLabel } from './menu';
import { G5 } from './palette';
import { BugIcon, DataBox } from './parts';

/*
 * The G5 HSI page (Pilot's Guide figure 2-15): a heading-up compass card
 * with upright labels, the heading bug, a course pointer and deviation bar
 * coloured by source (magenta GPS, green VLOC), bearing pointers inside a
 * white ring, the ground track marker, and data boxes in the corners: wind,
 * heading, distance to the waypoint, bearing pointer sources, desired track
 * (or ground speed) and the selected heading.
 */

export interface HsiPageProps {
  readonly state: SimState;
  readonly derived: Derived;
  readonly cdiSources: readonly CdiSource[];
  readonly gpss: boolean;
}

const CX = 160;
const CY = 131;
const R = 100;
const RING = 58;
const DOT = 25;
const LABELS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

const polar = (deg: number, r: number) => {
  const t = ((deg - 90) * Math.PI) / 180;
  return { x: CX + Math.cos(t) * r, y: CY + Math.sin(t) * r };
};

export function HsiPage({ state, derived, cdiSources, gpss }: HsiPageProps) {
  const hdg = derived.headingMag;
  const cdi = derived.cdi;
  const gps = derived.gps;
  const color = cdi.color === 'magenta' ? G5.magenta : G5.green;
  const pointers = state.nav.bearing1 !== 'OFF' || state.nav.bearing2 !== 'OFF';
  const windFromMag = norm360(state.env.windFromTrue - derived.magVar);
  const showDtk = cdi.source === 'GPS' && gps.active && !gps.obsMode;
  const navLabel = cdi.source === 'GPS' ? 'GPS' : cdi.label;
  const waypointArrival = gps.active && !gps.obsMode && gps.eteSec !== null && gps.eteSec < 10;

  return (
    <g class="g5-hsi">
      <rect x={0} y={0} width={320} height={240} fill={G5.black} />
      <Card headingMag={hdg} />
      {/* Fixed 45-degree index marks around the card. */}
      {[45, 90, 135, 225, 270, 315].map((d) => {
        const p = polar(d, R + 4);
        const q = polar(d, R + 13);
        return <line key={d} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={G5.white} stroke-width={2} />;
      })}
      {pointers && <circle cx={CX} cy={CY} r={RING} fill="none" stroke={G5.white} stroke-width={1.1} />}
      <BearingPointer solution={derived.bearing1} headingMag={hdg} double={false} />
      <BearingPointer solution={derived.bearing2} headingMag={hdg} double />
      <CoursePointer
        relDeg={cdi.courseMag - hdg}
        needle={cdi.needle}
        toFrom={cdi.toFrom}
        flag={cdi.flag}
        color={color}
      />
      <g transform={`rotate(${state.bugs.headingMag - hdg} ${CX} ${CY})`}>
        <path
          d={`M${CX - 9} ${CY - R - 7} h6 l3 4 l3 -4 h6 v8 h-18 Z`}
          fill={gpss ? 'none' : G5.cyan}
          stroke={gpss ? G5.cyan : G5.black}
          stroke-width={gpss ? 1.4 : 0.8}
        />
      </g>
      <g transform={`rotate(${derived.trackMag - hdg} ${CX} ${CY})`}>
        <path d={`M${CX} ${CY - R + 13} l-4.5 8 h9 Z`} fill={G5.magenta} stroke={G5.black} stroke-width={0.6} />
      </g>
      <Airplane />

      {/* Source and CDI scale annunciations inside the ring. */}
      <text x={CX - 33} y={CY - 24} text-anchor="middle" font-size={12} fill={color} class="g5-halo">
        {navLabel}
      </text>
      {cdi.source === 'GPS' && gps.active && (
        <text x={CX + 33} y={CY - 24} text-anchor="middle" font-size={12} fill={G5.magenta} class="g5-halo">
          {gps.scale}
        </text>
      )}
      {cdi.source === 'GPS' && gps.obsMode && (
        <text x={CX + 33} y={CY - 11} text-anchor="middle" font-size={12} fill={G5.magenta} class="g5-halo">
          OBS
        </text>
      )}

      {/* Heading readout and lubber line. */}
      <rect x={CX - 19} y={0.5} width={38} height={17} fill={G5.black} stroke={G5.white} stroke-width={1} />
      <text x={CX} y={14} text-anchor="middle" font-size={15} fill={G5.white}>
        {headingText(hdg)}
      </text>
      <path d={`M${CX} ${CY - R + 2} l-4 -8 h8 Z`} fill={G5.white} stroke={G5.black} stroke-width={0.6} />

      <DataBox x={0} y={0} w={70} h={30}>
        <g transform={`rotate(${derived.windRelativeDeg + 180} 14 15)`}>
          <path d="M14 6 V24 M9 18 L14 24 L19 18" stroke={G5.white} stroke-width={2.2} fill="none" />
        </g>
        <text x={66} y={13} text-anchor="end" font-size={10.5} fill={G5.white}>
          {Math.round(state.env.windKt)} KT
        </text>
        <text x={66} y={26} text-anchor="end" font-size={10.5} fill={G5.white}>
          {headingText(windFromMag)}
        </text>
      </DataBox>
      <DataBox x={236} y={0} w={84} h={20}>
        <text x={240} y={14} font-size={9} fill={G5.white}>
          DIST
        </text>
        <text x={308} y={15.5} text-anchor="end" font-size={15} fill={color}>
          {cdi.flag || cdi.distanceNm === null ? '__._' : formatDistance(cdi.distanceNm)}
        </text>
        <g fill={color} font-size={6.5}>
          <text x={309} y={9}>
            n
          </text>
          <text x={309} y={15}>
            m
          </text>
        </g>
      </DataBox>
      {gpss && (
        <text x={316} y={34} text-anchor="end" font-size={11} fill={G5.green}>
          GPSS
        </text>
      )}

      {/* Navigator annunciations: pending message, waypoint arrival. */}
      {derived.unreadMessages > 0 && <Annunciation y={92} text="MSG" />}
      {waypointArrival && <Annunciation y={110} text="WPT" />}

      <PointerInfo side="left" source={state.nav.bearing1} solution={derived.bearing1} cdiSources={cdiSources} />
      <PointerInfo side="right" source={state.nav.bearing2} solution={derived.bearing2} cdiSources={cdiSources} />
      <DataBox x={0} y={219} w={70} h={21}>
        {showDtk ? (
          <>
            <text x={4} y={234} font-size={9} fill={G5.white}>
              DTK
            </text>
            <text x={66} y={235} text-anchor="end" font-size={15} fill={G5.magenta}>
              {headingText(cdi.courseMag)}
            </text>
          </>
        ) : (
          <>
            <text x={4} y={229} font-size={8} fill={G5.white}>
              GS
            </text>
            <text x={4} y={237} font-size={7} fill={G5.white}>
              KT
            </text>
            <text x={66} y={235} text-anchor="end" font-size={15} fill={G5.magenta}>
              {Math.round(state.aircraft.groundSpeedKt)}
            </text>
          </>
        )}
      </DataBox>
      <DataBox x={236} y={219} w={84} h={21} stroke={G5.cyan}>
        <BugIcon x={241} y={223.5} color={G5.cyan} />
        <text x={314} y={235} text-anchor="end" font-size={15} fill={G5.cyan}>
          {headingText(state.bugs.headingMag)}
        </text>
      </DataBox>
    </g>
  );
}

/** Marks every 5 degrees, drawn once in card coordinates; the card turns as a whole. */
function CardMarks() {
  const marks = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    const p = polar(d, R);
    const q = polar(d, R - (major ? 12 : 7));
    marks.push(<line key={d} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={G5.white} stroke-width={major ? 2 : 1.5} />);
  }
  return <g>{marks}</g>;
}

/** The rotating card with its labels kept upright, as the G5 draws them. */
function Card({ headingMag }: { headingMag: number }) {
  const marks = useMemo(() => <CardMarks />, []);
  const labels = [];
  for (let d = 0; d < 360; d += 30) {
    const c = polar(d - headingMag, R - 24);
    labels.push(
      <text key={d} x={c.x} y={c.y + 5.5} text-anchor="middle" font-size={LABELS[d] ? 16 : 15} fill={G5.white}>
        {LABELS[d] ?? String(d / 10)}
      </text>,
    );
  }
  return (
    <g>
      <g transform={`rotate(${-headingMag} ${CX} ${CY})`}>{marks}</g>
      {labels}
    </g>
  );
}

function CoursePointer({
  relDeg,
  needle,
  toFrom,
  flag,
  color,
}: {
  relDeg: number;
  needle: number;
  toFrom: 'TO' | 'FROM' | null;
  flag: boolean;
  color: string;
}) {
  const dev = Math.max(Math.min(needle, 1.2), -1.2) * DOT * 2;
  return (
    <g transform={`rotate(${relDeg} ${CX} ${CY})`}>
      <path
        d={`M${CX} ${CY - R + 9} L${CX + 9} ${CY - R + 28} H${CX + 2} V${CY - RING - 2} H${CX - 2} V${CY - R + 28} H${CX - 9} Z`}
        fill={color}
        stroke={G5.black}
        stroke-width={0.8}
      />
      <rect x={CX - 2} y={CY + RING + 2} width={4} height={R - RING - 11} fill={color} stroke={G5.black} stroke-width={0.8} />
      {[-2, -1, 1, 2].map((i) => (
        <circle key={i} cx={CX + i * DOT} cy={CY} r={3.2} fill="none" stroke={G5.white} stroke-width={1.3} />
      ))}
      {!flag && <rect x={CX + dev - 2} y={CY - RING + 3} width={4} height={(RING - 3) * 2} fill={color} stroke={G5.black} stroke-width={0.8} />}
      {!flag && toFrom === 'TO' && <path d={`M${CX + dev} ${CY - 40} l7 11 h-14 Z`} fill={color} stroke={G5.black} stroke-width={0.8} />}
      {!flag && toFrom === 'FROM' && <path d={`M${CX + dev} ${CY + 40} l7 -11 h-14 Z`} fill={color} stroke={G5.black} stroke-width={0.8} />}
    </g>
  );
}

/** Cyan RMI needles outside the ring: pointer 1 single line, pointer 2 double line. */
function BearingPointer({ solution, headingMag, double }: { solution: BearingSolution; headingMag: number; double: boolean }) {
  if (solution.bearingMag === null) return null;
  const head = R - 6;
  const shaft = double
    ? `M${CX - 3} ${CY - RING - 3} V${CY - head + 13} M${CX + 3} ${CY - RING - 3} V${CY - head + 13} M${CX - 3} ${CY + RING + 3} V${CY + head} M${CX + 3} ${CY + RING + 3} V${CY + head}`
    : `M${CX} ${CY - RING - 3} V${CY - head} M${CX} ${CY + RING + 3} V${CY + head}`;
  return (
    <g transform={`rotate(${solution.bearingMag - headingMag} ${CX} ${CY})`} stroke={G5.cyan} stroke-width={2} fill="none">
      <path d={shaft} />
      <path d={`M${CX - 7} ${CY - head + 12} L${CX} ${CY - head} L${CX + 7} ${CY - head + 12}`} />
      <path d={`M${CX - 6} ${CY + head - 1} L${CX} ${CY + head - 8} L${CX + 6} ${CY + head - 1}`} />
    </g>
  );
}

function PointerInfo({
  side,
  source,
  solution,
  cdiSources,
}: {
  side: 'left' | 'right';
  source: SimState['nav']['bearing1'];
  solution: BearingSolution;
  cdiSources: readonly CdiSource[];
}) {
  if (source === 'OFF') return null;
  const left = side === 'left';
  const x0 = left ? 0 : 250;
  const d = left ? `M0.5 186.5 H56 L69.5 200 V216.5 H0.5 Z` : `M319.5 186.5 H264 L250.5 200 V216.5 H319.5 Z`;
  const label = bearingLabel(source, cdiSources);
  const textX = left ? x0 + 6 : 315;
  return (
    <g>
      <path d={d} fill={G5.black} stroke="rgba(255,255,255,0.6)" stroke-width={1} />
      {left ? (
        <path d="M6 196 H24 M18 191.5 L24 196 L18 200.5" stroke={G5.cyan} stroke-width={1.8} fill="none" />
      ) : (
        <path d="M314 194 H298 M314 198 H298 M303 190 L297 196 L303 202" stroke={G5.cyan} stroke-width={1.5} fill="none" />
      )}
      <text x={textX} y={213} text-anchor={left ? 'start' : 'end'} font-size={11} fill={solution.bearingMag === null ? G5.gray : G5.cyan}>
        {label}
      </text>
    </g>
  );
}

function Annunciation({ y, text }: { y: number; text: string }) {
  return (
    <g>
      <rect x={4} y={y} width={30} height={14} rx={1} fill={G5.black} stroke={G5.white} stroke-width={0.8} />
      <text x={19} y={y + 11} text-anchor="middle" font-size={10.5} fill={G5.white}>
        {text}
      </text>
    </g>
  );
}

/** White airliner silhouette fixed at the center of the card. */
function Airplane() {
  return (
    <path
      transform={`translate(${CX} ${CY})`}
      d="M0 -16 C1.6 -16 2.4 -14 2.4 -11.5 V-4 L15 2.5 V5.5 L2.4 2 V9 L6.5 12.5 V14.5 L0 13 L-6.5 14.5 V12.5 L-2.4 9 V2 L-15 5.5 V2.5 L-2.4 -4 V-11.5 C-2.4 -14 -1.6 -16 0 -16 Z"
      fill={G5.white}
      stroke={G5.black}
      stroke-width={0.8}
    />
  );
}
