import { useSimulator } from '../../sim/hooks';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import {
  lampLit,
  SELECTOR,
  SELECTOR_ANGLE,
  selectorFor,
  selectorMode,
  TEST_HOLD_S,
  turnCodeDigit,
  turnSelector,
  WARM_UP_S,
  type SelectorPosition,
} from './kt76aLogic';
import { realSeconds, useInterval, useUnitState } from './useUnit';
import './xpdr.css';

/*
 * Bendix/King KT 76A, 6.25 x 1.63 in: the function selector inside the
 * white frame on the left, the reply lamp above the IDENT button, and four
 * mechanical code drums, each turned by the knob below it.
 */

const SELECTOR_AT = { x: 116, y: 104 } as const;
const LINE_Y = 104;
const DRUM_X = [292, 386, 480, 574] as const;
const DIGIT_NAMES = ['first', 'second', 'third', 'fourth'] as const;

interface KtState {
  readonly position: SelectorPosition;
  /** Sim time the warm-up ends. */
  readonly warmUntil: number;
  /** Real time the spring returns the knob from TST. */
  readonly testUntil: number;
}

/** Selector labels around the knob; the lower ones sit just above the white line. */
function SelectorLabels() {
  return (
    <>
      {SELECTOR.map((p) => {
        const a = (SELECTOR_ANGLE[p] * Math.PI) / 180;
        const x = SELECTOR_AT.x + 35 * Math.sin(a);
        const y = SELECTOR_AT.y - 35 * Math.cos(a) + (Math.abs(SELECTOR_ANGLE[p]) >= 90 ? -8 : 3);
        return (
          <text key={p} x={x} y={y} class="xpdr-kt-label" text-anchor="middle">
            {p}
          </text>
        );
      })}
    </>
  );
}

function Drum({ x, digit }: { x: number; digit: number }) {
  const prev = (digit + 7) % 8;
  const next = (digit + 1) % 8;
  return (
    <div class="xpdr-kt-drum" style={{ left: `${x - 19}px` }}>
      <span class="xpdr-kt-drum-edge is-top">{prev}</span>
      <span class="xpdr-kt-drum-digit">{digit}</span>
      <span class="xpdr-kt-drum-edge is-bottom">{next}</span>
    </div>
  );
}

export function Kt76a() {
  const sim = useSimulator();
  const unit = useUnitState<KtState>(() => ({ position: selectorFor(sim.getState().xpdr.mode), warmUntil: 0, testUntil: 0 }));

  useInterval(() => {
    const s = unit.get();
    const mode = sim.getState().xpdr.mode;
    if (s.position === 'TST' && realSeconds() >= s.testUntil) {
      // The spring brings the knob back from TST to ALT.
      unit.set({ ...s, position: 'ALT' });
    } else if (s.position !== 'TST' && selectorMode(s.position) !== mode) {
      // A mode set elsewhere (a restored session): the knob follows.
      unit.set({ ...s, position: selectorFor(mode) });
    }
    unit.redraw();
  }, 100);

  const turnSelectorKnob = (steps: number) => {
    const s = unit.get();
    const position = turnSelector(s.position, steps);
    if (position === s.position) return;
    const state = sim.getState();
    const warmUntil = s.position === 'OFF' ? state.time + WARM_UP_S : s.warmUntil;
    unit.set({ position, warmUntil, testUntil: position === 'TST' ? realSeconds() + TEST_HOLD_S : 0 });
    const mode = selectorMode(position);
    if (mode !== state.xpdr.mode) sim.dispatch({ type: 'xpdr.mode', mode });
  };
  const turnDrum = (index: number, steps: number) => {
    sim.dispatch({ type: 'xpdr.code', code: turnCodeDigit(sim.getState().xpdr.code, index, steps) });
  };

  const state = sim.getState();
  const s = unit.get();
  const code = state.xpdr.code.padStart(4, '0');
  const lit = lampLit({ position: s.position, mode: state.xpdr.mode, simTime: state.time, identUntil: state.xpdr.identUntil, warmUntil: s.warmUntil });
  const pointer = SELECTOR_ANGLE[s.position];

  return (
    <div class="xpdr-kt">
      <svg class="xpdr-kt-face" viewBox="0 0 625 163" aria-hidden="true">
        <path d={`M14 ${LINE_Y} V22 a6 6 0 0 1 6 -6 H200 a6 6 0 0 1 6 6 V${LINE_Y} H614 M14 ${LINE_Y} H206`} class="xpdr-kt-line" />
        <SelectorLabels />
        <text x={180} y={74} class="xpdr-kt-label" text-anchor="middle">
          IDENT
        </text>
        <text x={18} y={127} class="xpdr-kt-model">
          KT76A
        </text>
        <text x={18} y={150} class="xpdr-kt-brand">
          BENDIX/KING
        </text>
      </svg>

      <div class={`xpdr-kt-lamp${lit ? ' is-lit' : ''}`} role="img" aria-label={`Reply lamp ${lit ? 'on' : 'off'}`} />
      <BezelButton
        x={170}
        y={118}
        w={20}
        h={20}
        shape="round"
        look="bendix"
        label=""
        ariaLabel="IDENT button (IDT): ident for 18 seconds"
        class="xpdr-kt-ident"
        onPress={() => sim.dispatch({ type: 'xpdr.ident' })}
      />
      <span class="xpdr-kt-photocell" aria-hidden="true" />

      <div class="xpdr-kt-window" role="img" aria-label={`Code ${code.split('').join(' ')}`}>
        {DRUM_X.map((x, i) => (
          <Drum key={x} x={x - 236} digit={Number(code[i])} />
        ))}
      </div>

      <div class="xpdr-kt-selector">
        <Knob
          id="kt76a.selector"
          x={SELECTOR_AT.x}
          y={SELECTOR_AT.y}
          size={42}
          look="bendix"
          label={`Function selector, ${s.position}. OFF, SBY, ON, ALT, TST`}
          innerLabel="OFF, SBY, ON, ALT, TST"
          onInner={turnSelectorKnob}
        />
        <svg class="xpdr-kt-pointer" viewBox="-21 -21 42 42" style={{ left: `${SELECTOR_AT.x - 21}px`, top: `${SELECTOR_AT.y - 21}px` }} aria-hidden="true">
          <line x1="0" y1="-5" x2="0" y2="-18" transform={`rotate(${pointer})`} />
          <circle r="5" />
        </svg>
      </div>
      {DRUM_X.map((x, i) => (
        <Knob
          key={x}
          id={`kt76a.code${i + 1}`}
          x={x}
          y={LINE_Y}
          size={44}
          look="bendix"
          label={`Code knob ${i + 1}, ${DIGIT_NAMES[i]} digit, now ${code[i]}`}
          innerLabel={`Digit ${i + 1} (0 to 7)`}
          onInner={(n) => turnDrum(i, n)}
        />
      ))}
    </div>
  );
}

export default Kt76a;
