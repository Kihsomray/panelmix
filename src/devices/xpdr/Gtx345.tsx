import { useSimulator } from '../../sim/hooks';
import { BezelButton } from '../../ui/controls/BezelButton';
import { ScreenCanvas } from '../../ui/Screen';
import { drawGtxScreen, GTX_SCREEN_H, GTX_SCREEN_W } from './gtxDisplay';
import { gtxScreen, initialGtx, pressGtx, tickGtx, type GtxKey, type GtxResult, type GtxScreen, type GtxView } from './gtx345Logic';
import { realSeconds, useInterval, useUnitState } from './useUnit';
import './xpdr.css';

/*
 * Garmin GTX 345 panel-mount transponder, 6.25 x 1.65 in. Mode keys in a
 * ring around IDNT on the left, the display in the middle, FUNC/CRSR/CLR/ENT
 * on the right and the 0-7, 8 and 9 keys along the bottom, as on the unit.
 */

/** Ring of mode keys around IDNT: angle of each key from the ring center, degrees. */
const RING = { cx: 65, cy: 64, r: 37 } as const;
const RING_KEYS: readonly { key: GtxKey; label: string; aria: string; angle: number }[] = [
  { key: 'ON', label: 'ON', aria: 'ON: transponder on, no altitude reporting', angle: -90 },
  { key: 'ALT', label: 'ALT', aria: 'ALT: transponder on with altitude reporting', angle: -18 },
  { key: 'VFR', label: 'VFR', aria: 'VFR: squawk 1200, press again for the previous code', angle: 54 },
  { key: 'OFF', label: 'OFF', aria: 'OFF: transponder off', angle: 126 },
  { key: 'SBY', label: 'SBY', aria: 'SBY: standby, no replies', angle: 198 },
];

const DIGIT_X = [34, 94, 155, 215, 275, 336, 396, 456] as const;
const KEY_W = 36;
const KEY_H = 24;
const SCREEN = { x: 138, y: 22 } as const;

function screenSummary(s: GtxScreen): string {
  if (s.kind === 'off') return 'Display off';
  if (s.kind === 'boot') return 'Starting up';
  const page = s.page.kind === 'titled' ? `${s.page.title} ${s.page.value}` : s.page.rows.map((r) => `${r.label} ${r.value}`).join(', ');
  return `${s.mode} ${s.code.replace(/_/g, ' blank')}${s.ident ? ', IDENT' : ''}${s.special ? `, ${s.special}` : ''}. ${page}`;
}

export function Gtx345() {
  const sim = useSimulator();
  const unit = useUnitState(initialGtx);

  const view = (): GtxView => {
    const s = sim.getState();
    const d = sim.getDerived();
    return {
      simTime: s.time,
      realTime: realSeconds(),
      code: s.xpdr.code,
      mode: s.xpdr.mode,
      identUntil: s.xpdr.identUntil,
      pressureAltFt: d.pressureAltitudeFt,
      densityAltFt: d.densityAltitudeFt,
      oatC: d.oatC,
      verticalSpeedFpm: s.aircraft.verticalSpeedFpm,
      airborne: s.aircraft.iasKt >= 40,
    };
  };
  const run = (r: GtxResult) => {
    unit.set(r.state);
    for (const c of r.commands) sim.dispatch(c);
  };
  const press = (key: GtxKey) => run(pressGtx(unit.get(), key, view()));

  useInterval(() => {
    unit.set(tickGtx(unit.get(), view()));
    unit.redraw();
  }, 100);

  const v = view();
  const screen = gtxScreen(unit.get(), v);
  const blinkOn = Math.floor(v.realTime * 2.5) % 2 === 0;

  const key = (k: GtxKey, x: number, y: number, label: string, aria: string, extra: { onLongPress?: () => void } = {}) => (
    <BezelButton
      key={k}
      x={x - KEY_W / 2}
      y={y - KEY_H / 2}
      w={KEY_W}
      h={KEY_H}
      label={label}
      ariaLabel={aria}
      look="garmin"
      class="xpdr-gtx-key"
      onPress={() => press(k)}
      {...extra}
    />
  );

  return (
    <div class="xpdr-gtx">
      {RING_KEYS.map((k) => {
        const rad = (k.angle * Math.PI) / 180;
        const cx = RING.cx + RING.r * Math.cos(rad);
        const cy = RING.cy + RING.r * Math.sin(rad);
        return (
          <BezelButton
            key={k.key}
            x={cx - 19}
            y={cy - 9.5}
            w={38}
            h={19}
            label={k.label}
            ariaLabel={k.aria}
            look="garmin"
            class={`xpdr-gtx-key xpdr-gtx-ring xpdr-gtx-ring-${k.key.toLowerCase()}`}
            onPress={() => press(k.key)}
          />
        );
      })}
      <BezelButton
        x={RING.cx - 18}
        y={RING.cy - 18}
        w={36}
        h={36}
        shape="round"
        label="IDNT"
        ariaLabel="IDNT: ident for 18 seconds"
        look="garmin"
        class="xpdr-gtx-key xpdr-gtx-idnt"
        onPress={() => press('IDNT')}
      />

      <div class="xpdr-gtx-glass" aria-hidden="true" />
      <ScreenCanvas
        x={SCREEN.x}
        y={SCREEN.y}
        w={GTX_SCREEN_W}
        h={GTX_SCREEN_H}
        label={`GTX 345 display: ${screenSummary(screen)}`}
        draw={(ctx) => drawGtxScreen(ctx, screen, blinkOn)}
      />

      <span class="xpdr-gtx-brand" aria-hidden="true">
        GARMIN
      </span>
      <span class="xpdr-gtx-sensor" aria-hidden="true" />
      {key('FUNC', 530, 43, 'FUNC', 'FUNC: next function group')}
      {key('CRSR', 588, 43, 'CRSR', 'CRSR: cursor on or off, cancels code entry')}
      {key('CLR', 530, 87, 'CLR', 'CLR: back one digit or reset, hold for the first digit', { onLongPress: () => press('CLR_HOLD') })}
      {key('ENT', 588, 87, 'ENT', 'ENT: enter, start or stop a timer')}

      {DIGIT_X.map((x, d) => key(String(d) as GtxKey, x, 135, String(d), `Code digit ${d}`))}
      <span class="xpdr-gtx-photocell" aria-hidden="true" />
      {key('8', 530, 135, '8▲', '8, up: previous page, or digit 8 in a time')}
      {key('9', 588, 135, '9▼', '9, down: next page, or digit 9 in a time')}
    </div>
  );
}

export default Gtx345;
