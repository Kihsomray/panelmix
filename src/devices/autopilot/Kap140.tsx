import { useRef } from 'preact/hooks';
import { useSimulator } from '../../sim/hooks';
import { BezelButton, type BezelButtonProps } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { realSeconds, useInterval, useUnitState } from '../xpdr/useUnit';
import './autopilot.css';
import { KapLcd } from './KapDisplay';
import {
  initialKap,
  kapDisplay,
  pressKap,
  releaseUpDown,
  tickKap,
  turnKapKnob,
  type KapButton,
  type KapDisplay,
  type KapResult,
  type KapView,
} from './kap140Logic';

/*
 * Bendix/King KAP 140 two-axis autopilot with altitude preselect (KC 140
 * computer, 6.3 x 1.67 in): the mode buttons along the bottom, ARM and BARO
 * top right, UP/DN in their frame and the concentric altitude select knobs.
 */

const LCD = { x: 89, y: 13 } as const;
const KEY = { w: 37, h: 22 } as const;
const BOTTOM_Y = 140;
const MODE_KEYS: readonly { b: KapButton; x: number; aria: string }[] = [
  { b: 'HDG', x: 150, aria: 'HDG: heading mode, press again for ROL' },
  { b: 'NAV', x: 222, aria: 'NAV: arm or couple the CDI course' },
  { b: 'APR', x: 296, aria: 'APR: approach mode (tracks the CDI course in the trainer)' },
  { b: 'REV', x: 369, aria: 'REV: back course mode (tracks the CDI course in the trainer)' },
  { b: 'ALT', x: 432, aria: 'ALT: altitude hold, press again for VS' },
];

function displaySummary(d: KapDisplay): string {
  if (d.test !== null) return 'Preflight test';
  const right =
    d.right.kind === 'ALT' ? `selected altitude ${d.right.ft} feet` : d.right.kind === 'VS' ? `vertical speed ${d.right.fpm} feet per minute` : `baro ${d.right.value}`;
  const modes = d.lateral ? `${d.lateral} ${d.vertical}` : 'autopilot off';
  const armed = [d.lateralArmed, d.verticalArmed].filter(Boolean).map((m) => `${m} armed`).join(', ');
  return `${modes}${armed ? `, ${armed}` : ''}, ${right}${d.alert !== 'off' ? ', ALERT' : ''}`;
}

export function Kap140() {
  const sim = useSimulator();
  const view = (): KapView => {
    const s = sim.getState();
    const d = sim.getDerived();
    return {
      now: realSeconds(),
      engaged: s.ap.engaged,
      flightDirector: s.ap.flightDirector,
      lateral: s.ap.lateral,
      vertical: s.ap.vertical,
      lateralArmed: s.ap.lateralArmed,
      altitudeArmed: s.ap.altitudeArmed,
      selectedAltitudeFt: s.bugs.altitudeFt,
      vsBugFpm: s.bugs.verticalSpeedFpm,
      baroInHg: s.bugs.baroInHg,
      altitudeFt: d.indicatedAltitudeFt,
    };
  };
  const unit = useUnitState(() => initialKap(view()));
  const run = (r: KapResult) => {
    unit.set(r.state);
    for (const c of r.commands) sim.dispatch(c);
  };
  const press = (b: KapButton, held = false) => run(pressKap(unit.get(), b, view(), held));

  useInterval(() => {
    run(tickKap(unit.get(), view()));
    unit.redraw();
  }, 100);

  // A click reaches onPress just after onRelease; a held key repeats onPress
  // every 120 ms before its release. Keys pressed from the keyboard have no
  // release, so a short timeout ends a held keyboard repeat.
  const keyTiming = useRef({ pressAt: 0, releaseAt: 0, holdTimer: 0 });
  const isClick = () => performance.now() - keyTiming.current.releaseAt < 60;
  const endHold = () => {
    window.clearTimeout(keyTiming.current.holdTimer);
    run(releaseUpDown(unit.get(), view()));
  };
  const upDnPress = (b: 'UP' | 'DN') => {
    const t = keyTiming.current;
    const now = performance.now();
    const held = !isClick() && now - t.pressAt < 250;
    t.pressAt = now;
    press(b, held);
    window.clearTimeout(t.holdTimer);
    if (held) t.holdTimer = window.setTimeout(endHold, 300);
  };
  const keyReleased = () => {
    keyTiming.current.releaseAt = performance.now();
  };

  const v = view();
  const display = kapDisplay(unit.get(), v);
  const blinkOn = Math.floor(v.now * 2.5) % 2 === 0;
  // After BARO the same knobs set the baro; their touch-dock labels follow.
  const baroUnit = display.right.kind === 'BARO' ? display.right.unit : null;
  const knobSteps: readonly [string, string] = baroUnit === 'HPA' ? ['10 hPa', '1 hPa'] : baroUnit === 'INHG' ? ['0.10 inHg', '0.01 inHg'] : ['1000 ft', '100 ft'];

  const key = (b: KapButton, x: number, y: number, aria: string, extra: Partial<Pick<BezelButtonProps, 'onLongPress' | 'holdMs' | 'onRelease'>> = {}) => (
    <BezelButton
      key={b}
      x={x - KEY.w / 2}
      y={y - KEY.h / 2}
      w={KEY.w}
      h={KEY.h}
      label={b}
      ariaLabel={aria}
      look="bendix"
      class="ap-kap-key"
      onPress={() => press(b)}
      {...extra}
    />
  );
  // From software 03/01 AP engages only when held a quarter second; any press disengages.
  // A keyboard press has no hold, so it engages as if held.
  const apKey = (
    <BezelButton
      x={38 - KEY.w / 2}
      y={BOTTOM_Y - KEY.h / 2}
      w={KEY.w}
      h={KEY.h}
      label="AP"
      ariaLabel="AP: hold a quarter second to engage, press to disengage"
      look="bendix"
      class="ap-kap-key"
      holdMs={250}
      onLongPress={() => press('AP')}
      onRelease={keyReleased}
      onPress={() => {
        if (view().engaged || !isClick()) press('AP');
      }}
    />
  );

  return (
    <div class="ap-kap">
      <div class="ap-kap-border" aria-hidden="true" />
      <span class="ap-kap-brand" aria-hidden="true">
        BENDIX/KING
      </span>
      <span class="ap-kap-model" aria-hidden="true">
        KAP 140
      </span>
      <span class="ap-kap-photocell" aria-hidden="true" />
      <span class="ap-kap-fail" style={{ left: '23px' }} aria-hidden="true">
        P
      </span>
      <span class="ap-kap-fail" style={{ left: '43px' }} aria-hidden="true">
        R
      </span>

      <div class="ap-kap-lcd" style={{ left: `${LCD.x}px`, top: `${LCD.y}px` }} role="img" aria-label={`KAP 140 display: ${displaySummary(display)}`}>
        <KapLcd model={display} blinkOn={blinkOn} />
      </div>

      {apKey}
      {MODE_KEYS.map((k) => key(k.b, k.x, BOTTOM_Y, k.aria))}
      <span class="ap-kap-dot" aria-hidden="true" />

      <span class="ap-kap-screw" aria-hidden="true" />
      {key('ARM', 528, 28, 'ARM: arm or disarm capture of the selected altitude')}
      {key('BARO', 590, 28, 'BARO: show the baro setting, hold 2 seconds for inches or hectopascals', {
        onLongPress: () => press('BARO_HOLD'),
        holdMs: 2000,
      })}
      <div class="ap-kap-updn-frame" aria-hidden="true" />
      <BezelButton
          x={490 - 18}
          y={82 - 11}
          w={36}
          h={22}
          label="UP"
          ariaLabel="UP: vertical speed up 100 fpm, or altitude hold up 20 ft; hold to keep going"
          look="bendix"
          class="ap-kap-key"
          repeat
          onPress={() => upDnPress('UP')}
          onRelease={() => {
            keyReleased();
            endHold();
          }}
        />
        <BezelButton
          x={490 - 18}
          y={132 - 11}
          w={36}
          h={22}
          label="DN"
          ariaLabel="DN: vertical speed down 100 fpm, or altitude hold down 20 ft; hold to keep going"
          look="bendix"
          class="ap-kap-key"
          repeat
          onPress={() => upDnPress('DN')}
          onRelease={() => {
            keyReleased();
            endHold();
          }}
        />

      <Knob
        id="kap140.alt-select"
        x={573}
        y={110}
        size={72}
        innerSize={46}
        look="bendix"
        label={baroUnit ? 'Baro setting knobs' : 'Altitude select knobs'}
        outerLabel={knobSteps[0]}
        innerLabel={knobSteps[1]}
        onOuter={(n) => run(turnKapKnob(unit.get(), 'outer', n, view()))}
        onInner={(n) => run(turnKapKnob(unit.get(), 'inner', n, view()))}
      />
    </div>
  );
}

export default Kap140;
