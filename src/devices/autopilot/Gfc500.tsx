import { useSimulator } from '../../sim/hooks';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { useInterval, useUnitState } from '../xpdr/useUnit';
import './autopilot.css';
import {
  gmcLeds,
  initialGmc,
  pressGmc,
  rollWheel,
  syncAltitude,
  syncHeading,
  tickGmc,
  type GmcKey,
  type GmcResult,
  type GmcView,
} from './gfc500Logic';
import { NoseWheel } from './NoseWheel';

/*
 * Garmin GMC 507 mode controller for the GFC 500, 6.25 x 2.06 in: the
 * HDG/TRK knob with APR, NAV, HDG and TRK on the left; AP, LVL, FD and YD in
 * the middle; the NOSE UP/DN wheel, IAS, VNAV, VS, ALT and the ALT SEL knob
 * on the right. A small triangle above each key lights while its function is
 * selected. The mode annunciations themselves appear on the G5 / PFD.
 */

const KEY = { w: 54, h: 37 } as const;

const KEYS: readonly { k: GmcKey; x: number; y: number; aria: string }[] = [
  { k: 'APR', x: 161, y: 49, aria: 'APR: approach mode (tracks the CDI course; no glidepaths in the trainer)' },
  { k: 'NAV', x: 161, y: 110, aria: 'NAV: navigation mode, armed until the needle is within one dot' },
  { k: 'HDG', x: 84, y: 172, aria: 'HDG: heading select mode' },
  { k: 'TRK', x: 161, y: 172, aria: 'TRK: track mode (flies the current ground track)' },
  { k: 'AP', x: 239, y: 79, aria: 'AP: engage or disengage the autopilot' },
  { k: 'LVL', x: 315, y: 79, aria: 'LVL: level mode, engages the autopilot wings level with zero vertical speed' },
  { k: 'FD', x: 239, y: 141, aria: 'FD: flight director on or off' },
  { k: 'YD', x: 315, y: 141, aria: 'YD: yaw damper on or off' },
  { k: 'IAS', x: 464, y: 49, aria: 'IAS: indicated airspeed mode (flight level change)' },
  { k: 'VNAV', x: 464, y: 110, aria: 'VNAV: vertical navigation (arms only; no descent profiles in the trainer)' },
  { k: 'VS', x: 464, y: 172, aria: 'VS: vertical speed mode' },
  { k: 'ALT', x: 542, y: 172, aria: 'ALT: altitude hold mode' },
];

export function Gfc500() {
  const sim = useSimulator();
  const view = (): GmcView => {
    const s = sim.getState();
    const d = sim.getDerived();
    return {
      engaged: s.ap.engaged,
      flightDirector: s.ap.flightDirector,
      lateral: s.ap.lateral,
      vertical: s.ap.vertical,
      lateralArmed: s.ap.lateralArmed,
      altitudeArmed: s.ap.altitudeArmed,
      altitudeRefFt: s.ap.altitudeRefFt,
      headingMag: d.headingMag,
      trackMag: d.trackMag,
      altitudeFt: d.indicatedAltitudeFt,
      cdiFlag: d.cdi.flag,
    };
  };
  const unit = useUnitState(() => initialGmc(view()));
  const run = (r: GmcResult) => {
    unit.set(r.state);
    for (const c of r.commands) sim.dispatch(c);
  };

  useInterval(() => {
    unit.set(tickGmc(unit.get(), view()));
    unit.redraw();
  }, 100);

  const s = sim.getState();
  const leds = gmcLeds(unit.get(), view());

  return (
    <div class="ap-gmc">
      <svg class="ap-gmc-face" viewBox="0 0 625 206" aria-hidden="true">
        <line x1={204.5} y1={12} x2={204.5} y2={194} class="ap-gmc-divider" />
        <line x1={349} y1={12} x2={349} y2={194} class="ap-gmc-divider" />
        <text x={84} y={27} class="ap-gmc-title">
          HDG/TRK
        </text>
        <text x={84} y={124} class="ap-gmc-small">
          PUSH SYNC
        </text>
        <text x={542} y={27} class="ap-gmc-title">
          ALT SEL
        </text>
        <text x={542} y={124} class="ap-gmc-small">
          PUSH SYNC
        </text>
        <text x={367} y={44} class="ap-gmc-small">
          DN
        </text>
        <text x={367} y={166} class="ap-gmc-small">
          UP
        </text>
        <path d="M367 50 V152 M363 56 L367 49 L371 56 M363 146 L367 153 L371 146" class="ap-gmc-arrow" />
        <circle cx={34} cy={102} r={3} class="ap-gmc-screw" />
        <circle cx={591} cy={102} r={3} class="ap-gmc-screw" />
        <circle cx={277} cy={29} r={7.5} class="ap-gmc-photocell" />
        <rect x={378} y={45} width={44} height={114} rx={8} class="ap-gmc-slot" />
        {KEYS.map(({ k, x, y }) => (
          <path key={k} d={`M${x - 5.5} ${y - KEY.h / 2 - 11} h11 l-5.5 7 Z`} class={`ap-gmc-led${leds[k] ? ' is-on' : ''}`} />
        ))}
      </svg>

      <Knob
        id="gfc500.hdg"
        x={84}
        y={71}
        size={68}
        look="garmin"
        label="HDG/TRK knob, push to sync"
        innerLabel="Heading bug"
        pushLabel="Sync"
        onInner={(n) => sim.dispatch({ type: 'bug.heading', mag: sim.getState().bugs.headingMag + n })}
        onPush={() => sim.dispatch(syncHeading(unit.get(), view()))}
      />
      <Knob
        id="gfc500.alt-sel"
        x={542}
        y={71}
        size={66}
        look="garmin"
        label="ALT SEL knob, push to sync to the current altitude"
        innerLabel="Selected altitude, 100 ft"
        pushLabel="Sync"
        onInner={(n) => sim.dispatch({ type: 'bug.altitude', ft: sim.getState().bugs.altitudeFt + n * 100 })}
        onPush={() => sim.dispatch(syncAltitude(view()))}
      />

      {KEYS.map(({ k, x, y, aria }) => (
        <BezelButton
          key={k}
          x={x - KEY.w / 2}
          y={y - KEY.h / 2}
          w={KEY.w}
          h={KEY.h}
          label={k === 'AP' || k === 'LVL' ? <span class="ap-gmc-boxed">{k}</span> : k}
          ariaLabel={`${aria}${leds[k] ? ' (selected)' : ''}`}
          look="garmin"
          class={`ap-gmc-key${k === 'LVL' ? ' ap-gmc-lvl' : ''}`}
          onPress={() => run(pressGmc(unit.get(), k, view()))}
        />
      ))}

      <NoseWheel
        id="gfc500.nose-wheel"
        x={400}
        y={102}
        w={36}
        h={104}
        label={`NOSE UP/DN wheel (${s.ap.vertical === 'VS' ? 'vertical speed' : s.ap.vertical === 'IAS' ? 'airspeed' : s.ap.vertical === 'ALT' ? 'altitude' : 'pitch'} reference)`}
        onRoll={(d) => run(rollWheel(unit.get(), d, view()))}
      />
    </div>
  );
}

export default Gfc500;
