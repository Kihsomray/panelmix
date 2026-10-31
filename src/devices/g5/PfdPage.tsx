import { useRef } from 'preact/hooks';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import { afcsBox, CAPTURE_FLASH_S, DISCONNECT_FLASH_S, flashing, initialWatch, watchAfcs, type AfcsBox, type AfcsWatch } from './afcs';
import { alerterVisible, initialAlerter, stepAlerter, type AlerterState } from './alerter';
import { altitudeText, baroText, fahrenheit, signedText, standardRateBankDeg } from './format';
import { G5 } from './palette';
import { BugIcon, DataBox, Unit } from './parts';
import { AltitudeTape, HeadingTape, SpeedTape, VerticalSpeed } from './tapes';
import { filterRate, type RateFilter } from './trend';

/*
 * The G5 PFD page (Pilot's Guide figure 2-1), drawn in display pixels:
 * GFC 500 status box on top, heading tape, attitude with the roll scale in
 * the default ground-pointer arrangement, airspeed and altitude tapes, the
 * vertical speed scale, a CDI, the slip ball and the turn rate indicator
 * along the bottom, and data boxes in the corners.
 */

export interface PfdPageProps {
  readonly id: string;
  readonly state: SimState;
  readonly derived: Derived;
  /** A GFC 500 is installed: status box, command bars, mode references. */
  readonly gfc500: boolean;
  readonly esp: boolean;
  readonly gpss: boolean;
  readonly aligning: boolean;
}

const CX = 160;
const CY = 124;
/** Pitch scale, display px per degree. */
const PPD = 3.7;
const ROLL_R = 84;
const AFCS_H = 14;
/** CDI dot spacing; two dots is full scale. */
const DOT = 21;

export function PfdPage({ id, state, derived, gfc500, esp, gpss, aligning }: PfdPageProps) {
  const a = state.aircraft;
  const ap = state.ap;
  const time = state.time;
  const alt = derived.indicatedAltitudeFt;

  // Per-frame filters live with the page: the airspeed trend, the altitude alerter and the AFCS transitions.
  const speed = useRef<RateFilter | null>(null);
  speed.current = filterRate(speed.current, a.iasKt, time);
  const alerter = useRef<AlerterState>(initialAlerter(state.bugs.altitudeFt, alt));
  alerter.current = stepAlerter(alerter.current, state.bugs.altitudeFt, alt, time);
  const watch = useRef<AfcsWatch>(initialWatch(ap));
  watch.current = watchAfcs(watch.current, ap, time);

  const top = gfc500 ? AFCS_H : 0;
  const box = gfc500 ? afcsBox(ap, derived.cdi, state.bugs) : null;
  const directing = gfc500 && (ap.engaged || ap.flightDirector);
  const fd = gfc500 ? derived.flightDirector : null;
  const cdi = derived.cdi;
  const cdiColor = cdi.color === 'magenta' ? G5.magenta : G5.green;
  const al = alerter.current;
  const selAltColor = al.phase === 'deviation' ? G5.yellow : G5.cyan;
  const baro = state.bugs.baroStd ? 29.92 : state.bugs.baroInHg;

  return (
    <g class="g5-pfd">
      <Attitude
        id={id}
        pitch={a.pitchDeg}
        bank={a.bankDeg}
        fd={fd}
        fdSolid={ap.engaged}
        stdBank={standardRateBankDeg(a.tasKt)}
        espMarks={gfc500 && esp && !ap.engaged}
      />

      <HeadingTape
        id={id}
        top={top}
        headingMag={derived.headingMag}
        bugMag={state.bugs.headingMag}
        bugHollow={gpss}
        trackMag={derived.trackMag}
        course={cdi.flag ? null : { mag: cdi.courseMag, color: cdiColor }}
      />

      <SpeedTape
        id={id}
        top={top + 17}
        bottom={207}
        cy={CY}
        iasKt={a.iasKt}
        trendKt={a.iasKt + speed.current.rate * 6}
        bugKt={directing && ap.vertical === 'IAS' ? state.bugs.airspeedKt : null}
      />
      <AltitudeTape
        id={id}
        top={top + 20}
        bottom={197}
        cy={CY}
        altitudeFt={alt}
        trendFt={alt + (a.verticalSpeedFpm / 60) * 6}
        bugFt={state.bugs.altitudeFt}
      />
      <VerticalSpeed
        top={top + 20}
        bottom={240}
        cy={CY}
        vsFpm={a.verticalSpeedFpm}
        bugFpm={directing && ap.vertical === 'VS' ? state.bugs.verticalSpeedFpm : null}
      />

      {/* Top corners: true airspeed, selected altitude. */}
      <DataBox x={0} y={top + 1} w={62} h={15}>
        <text x={3} y={top + 12} font-size={8.5} fill={G5.white}>
          TAS
        </text>
        <text x={50} y={top + 13} text-anchor="end" font-size={13} fill={G5.white}>
          {Math.round(a.tasKt)}
        </text>
        <Unit x={51} y={top + 12} a="k" b="t" />
      </DataBox>
      {gpss && (
        <DataBox x={0} y={top + 18} w={36} h={13}>
          <text x={18} y={top + 28.5} text-anchor="middle" font-size={10} fill={G5.green}>
            GPSS
          </text>
        </DataBox>
      )}
      <DataBox x={236} y={top + 1} w={84} h={18} stroke={G5.white}>
        {alerterVisible(al, time) && (
          <g>
            <BugIcon x={241} y={top + 4} color={selAltColor} />
            <text x={305} y={top + 16} text-anchor="end" font-size={16} fill={selAltColor}>
              {altitudeText(state.bugs.altitudeFt)}
            </text>
            <Unit x={306} y={top + 15} a="f" b="t" color={selAltColor} />
          </g>
        )}
      </DataBox>

      {/* Bottom corners: ground speed and OAT, selected vertical speed and baro. */}
      <DataBox x={0} y={208} w={62} h={15}>
        <text x={3} y={219.5} font-size={8.5} fill={G5.white}>
          GS
        </text>
        <text x={50} y={220.5} text-anchor="end" font-size={13} fill={G5.magenta}>
          {Math.round(a.groundSpeedKt)}
        </text>
        <Unit x={51} y={219.5} a="k" b="t" color={G5.magenta} />
      </DataBox>
      <DataBox x={0} y={224} w={62} h={15}>
        <text x={3} y={235.5} font-size={8.5} fill={G5.white}>
          OAT
        </text>
        <text x={59} y={235.5} text-anchor="end" font-size={10} fill={G5.white}>
          {fahrenheit(derived.oatC)}°F
        </text>
      </DataBox>
      {directing && ap.vertical === 'VS' && (
        <DataBox x={236} y={199} w={84} h={19} stroke={G5.white}>
          <text x={296} y={214.5} text-anchor="end" font-size={16} fill={G5.cyan}>
            {signedText(state.bugs.verticalSpeedFpm)}
          </text>
          <BugIcon x={305} y={202} color={G5.cyan} flip />
        </DataBox>
      )}
      <DataBox x={236} y={220} w={84} h={19} stroke={G5.cyan}>
        <text x={305} y={235.5} text-anchor="end" font-size={16} fill={G5.cyan}>
          {baroText(baro)}
        </text>
        <Unit x={306} y={234.5} a="i" b="n" color={G5.cyan} />
      </DataBox>

      {!cdi.flag && <Cdi needle={cdi.needle} color={cdiColor} />}
      <SlipBall slip={a.slip} />
      <TurnRate dps={a.turnRateDps} />

      {box && <AfcsBar box={box} watch={watch.current} time={time} />}

      {aligning && (
        <g>
          <rect x={CX - 38} y={58} width={76} height={17} fill={G5.black} />
          <text x={CX} y={71} text-anchor="middle" font-size={13} fill={G5.white}>
            ALIGNING
          </text>
        </g>
      )}
    </g>
  );
}

// Attitude ------------------------------------------------------------------------

function Attitude({
  id,
  pitch,
  bank,
  fd,
  fdSolid,
  stdBank,
  espMarks,
}: {
  id: string;
  pitch: number;
  bank: number;
  fd: { readonly bankDeg: number; readonly pitchDeg: number } | null;
  fdSolid: boolean;
  stdBank: number;
  espMarks: boolean;
}) {
  const big = 700;
  const horizon = `rotate(${-bank} ${CX} ${CY}) translate(0 ${pitch * PPD})`;
  const ladder = [];
  for (let d = Math.ceil((pitch - 22) / 2.5) * 2.5; d <= pitch + 22; d += 2.5) {
    if (Math.abs(d) < 0.01 || Math.abs(d) > 90) continue;
    const y = CY - d * PPD;
    const ten = Math.abs(d % 10) < 0.01;
    const hw = ten ? 23.5 : Math.abs(d % 5) < 0.01 ? 15 : 7.5;
    ladder.push(<line key={`l${d}`} x1={CX - hw} x2={CX + hw} y1={y} y2={y} stroke={G5.white} stroke-width={1.5} />);
    if (ten) {
      for (const side of [-1, 1]) {
        ladder.push(
          <text key={`t${d}${side}`} x={CX + side * 39} y={y + 4.8} text-anchor="middle" font-size={13} fill={G5.white} class="g5-halo">
            {Math.abs(d)}
          </text>,
        );
      }
    }
  }
  const polar = (deg: number, r: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return { x: CX + Math.cos(t) * r, y: CY + Math.sin(t) * r };
  };
  const tick = (deg: number) => {
    const len = Math.abs(deg) === 30 || Math.abs(deg) === 60 ? 11 : 6;
    const p = polar(deg, ROLL_R);
    const q = polar(deg, ROLL_R + len);
    return <line key={deg} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={G5.white} stroke-width={1.6} />;
  };
  const s = polar(-60, ROLL_R);
  const e = polar(60, ROLL_R);
  const rateMark = (deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    const n = { x: Math.cos(t), y: Math.sin(t) };
    const tip = polar(deg, ROLL_R - 1.5);
    const bx = tip.x - n.x * 8;
    const by = tip.y - n.y * 8;
    return (
      <path
        key={`r${deg}`}
        d={`M${tip.x} ${tip.y} L${bx - n.y * 4.5} ${by + n.x * 4.5} L${bx + n.y * 4.5} ${by - n.x * 4.5} Z`}
        fill={G5.green}
        stroke={G5.black}
        stroke-width={0.6}
      />
    );
  };
  const espMark = (deg: number) =>
    [-1.4, 1.4].map((o) => {
      const p = polar(deg + o, ROLL_R - 5);
      const q = polar(deg + o, ROLL_R + 8);
      return <line key={`e${deg}${o}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={G5.green} stroke-width={1.8} />;
    });

  return (
    <g>
      <defs>
        <linearGradient id={`${id}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1={CY - 260} x2="0" y2={CY}>
          <stop offset="0" stop-color={G5.skyTop} />
          <stop offset="1" stop-color={G5.skyHorizon} />
        </linearGradient>
        <linearGradient id={`${id}-gnd`} gradientUnits="userSpaceOnUse" x1="0" y1={CY} x2="0" y2={CY + 260}>
          <stop offset="0" stop-color={G5.groundHorizon} />
          <stop offset="1" stop-color={G5.groundBottom} />
        </linearGradient>
        <clipPath id={`${id}-ladder`}>
          <rect x={CX - 66} y={46} width={132} height={140} />
        </clipPath>
      </defs>
      <g transform={horizon}>
        <rect x={CX - big} y={CY - big} width={big * 2} height={big} fill={`url(#${id}-sky)`} />
        <rect x={CX - big} y={CY} width={big * 2} height={big} fill={`url(#${id}-gnd)`} />
        <line x1={CX - big} x2={CX + big} y1={CY} y2={CY} stroke={G5.white} stroke-width={1.6} />
      </g>
      <g clip-path={`url(#${id}-ladder)`}>
        <g transform={horizon}>{ladder}</g>
      </g>

      {/* Ground-pointer roll scale (the G5 default): the arc turns with the horizon, the pointer stays put. */}
      <g transform={`rotate(${-bank} ${CX} ${CY})`}>
        <path d={`M${s.x} ${s.y} A${ROLL_R} ${ROLL_R} 0 0 1 ${e.x} ${e.y}`} fill="none" stroke={G5.white} stroke-width={1.6} />
        {[-60, -45, -30, -20, -10, 10, 20, 30, 45, 60].map(tick)}
        <path d={`M${CX} ${CY - ROLL_R - 1} l-6 -9 h12 Z`} fill={G5.white} stroke={G5.black} stroke-width={0.6} />
        {rateMark(-stdBank)}
        {rateMark(stdBank)}
        {espMarks && [...espMark(-45), ...espMark(45)]}
      </g>
      <path d={`M${CX} ${CY - ROLL_R + 1.5} l-6.5 10 h13 Z`} fill={G5.white} stroke={G5.black} stroke-width={0.6} />

      {fd && <CommandBars error={{ bank: fd.bankDeg - bank, pitch: fd.pitchDeg - pitch }} solid={fdSolid} />}
      <AircraftSymbol />
    </g>
  );
}

/** Yellow delta with darker lower faces, and the two yellow level bars (figure 2-4). */
function AircraftSymbol() {
  const wing = (sx: number) => (
    <g>
      <path d={`M${CX} ${CY} L${CX + sx * 45.7} ${CY + 24} L${CX + sx * 32} ${CY + 24} Z`} fill={G5.yellow} stroke={G5.black} stroke-width={0.9} />
      <path d={`M${CX} ${CY} L${CX + sx * 32} ${CY + 24} L${CX + sx * 18.3} ${CY + 24} Z`} fill={G5.olive} stroke={G5.black} stroke-width={0.9} />
    </g>
  );
  const bar = (sx: number) => (
    <path
      d={`M${CX + sx * 80} ${CY - 2.6} H${CX + sx * 59} a2.6 2.6 0 0 ${sx > 0 ? 0 : 1} 0 5.2 H${CX + sx * 80} Z`}
      fill={G5.yellow}
      stroke={G5.black}
      stroke-width={0.9}
    />
  );
  return (
    <g>
      {wing(-1)}
      {wing(1)}
      {bar(1)}
      {bar(-1)}
    </g>
  );
}

/** Single-cue command bars: solid with the autopilot flying, hollow when hand flown. */
function CommandBars({ error, solid }: { error: { bank: number; pitch: number }; solid: boolean }) {
  const wedge = (sx: number) =>
    `M${CX} ${CY} L${CX + sx * 59.4} ${CY + 12.6} L${CX + sx * 59.4} ${CY + 24} L${CX + sx * 45.7} ${CY + 24} Z`;
  const dy = Math.max(Math.min(-error.pitch * PPD, 70), -70);
  return (
    <g transform={`rotate(${Math.max(Math.min(error.bank, 40), -40)} ${CX} ${CY}) translate(0 ${dy})`}>
      {[-1, 1].map((sx) => (
        <path
          key={sx}
          d={wedge(sx)}
          fill={solid ? G5.magenta : 'none'}
          stroke={solid ? G5.black : G5.magenta}
          stroke-width={solid ? 0.9 : 1.6}
        />
      ))}
    </g>
  );
}

// Bottom instruments ----------------------------------------------------------------

function Cdi({ needle, color }: { needle: number; color: string }) {
  const y = 192;
  const px = CX + Math.max(Math.min(needle, 1.15), -1.15) * DOT * 2;
  return (
    <g>
      <rect x={CX - 56} y={y - 7} width={112} height={14} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.35)" stroke-width={0.6} />
      {[-2, -1, 1, 2].map((i) => (
        <circle key={i} cx={CX + i * DOT} cy={y} r={2.6} fill="none" stroke={G5.white} stroke-width={1.1} />
      ))}
      <path d={`M${px} ${y - 6} l5.5 11 h-11 Z`} fill={color} stroke={G5.black} stroke-width={0.7} />
    </g>
  );
}

function SlipBall({ slip }: { slip: number }) {
  const y = 214;
  const bx = CX + Math.max(Math.min(slip, 1.3), -1.3) * 14;
  return (
    <g>
      <circle cx={bx} cy={y} r={7.4} fill="url(#g5-ball)" stroke={G5.black} stroke-width={0.8} />
      {[-1, 1].map((s) => (
        <rect key={s} x={CX + s * 10.5 - 1.2} y={y - 9.5} width={2.4} height={19} fill={G5.white} stroke={G5.black} stroke-width={0.6} />
      ))}
    </g>
  );
}

/** Standard rate (3 degrees per second) reaches the outer tick marks. */
function TurnRate({ dps }: { dps: number }) {
  const y = 236;
  const len = Math.max(Math.min((dps / 3) * 42, 52), -52);
  return (
    <g>
      <line x1={CX - 54} x2={CX + 54} y1={y} y2={y} stroke={G5.white} stroke-width={0.9} />
      {[-42, 0, 42].map((dx) => (
        <line key={dx} x1={CX + dx} x2={CX + dx} y1={y - (dx === 0 ? 4 : 6)} y2={y + 2} stroke={G5.white} stroke-width={1.3} />
      ))}
      {Math.abs(len) > 0.8 && <rect x={Math.min(CX, CX + len)} y={y - 4.5} width={Math.abs(len)} height={4} fill={G5.magenta} />}
    </g>
  );
}

// Status box and small parts ---------------------------------------------------------

function AfcsBar({ box, watch, time }: { box: AfcsBox; watch: AfcsWatch; time: number }) {
  const blink = Math.floor(time * 3) % 2 === 0;
  const disconnected = flashing(watch.disconnectedAt, DISCONNECT_FLASH_S, time);
  const captured = box.verticalActive === 'ALT' && flashing(watch.capturedAt, CAPTURE_FLASH_S, time);
  const navCaptured = flashing(watch.navCapturedAt, CAPTURE_FLASH_S, time);
  const label = (x: number, text: string | null, color: string) =>
    text && (
      <text x={x} y={11.5} text-anchor="middle" font-size={12} fill={color}>
        {text}
      </text>
    );
  return (
    <g class="g5-afcs">
      <rect x={0} y={0} width={320} height={AFCS_H} fill={G5.black} />
      {box.status && <path d="M104 2 V12 M164 2 V12" stroke={G5.white} stroke-width={1} />}
      {label(24, box.lateralArmed, G5.white)}
      {(!navCaptured || blink) && label(66, box.lateralActive, G5.green)}
      {box.status === 'AP' && label(134, 'AP', G5.green)}
      {box.status === 'FD' && !disconnected && label(134, 'FD', G5.white)}
      {disconnected && blink && label(134, 'AP', G5.yellow)}
      {(!captured || blink) && label(194, box.verticalActive, G5.green)}
      {box.verticalRef && (
        <text x={250} y={11.5} text-anchor="end" font-size={12} fill={G5.green}>
          {box.verticalRef.value}
          <tspan font-size={7}> {box.verticalRef.unit}</tspan>
        </text>
      )}
      {label(290, box.verticalArmed, G5.white)}
    </g>
  );
}
