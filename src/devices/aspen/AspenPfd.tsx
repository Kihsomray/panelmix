import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { norm360 } from '../../core/geo';
import { useSim, useSimulator } from '../../sim/hooks';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { Screen, ScreenCanvas } from '../../ui/Screen';
import type { DeviceProps, PanelInfo } from '../types';
import { alertFlag, initialAspenAlerter, stepAspenAlerter, type AspenAlerter } from './alerter';
import './aspen.css';
import { Attitude } from './Attitude';
import { drawBasemap, queryBox, type BasemapView } from './basemap';
import { ARC, CX, ROSE } from './Compass';
import {
  autoCourse,
  holdLabels,
  hotkeyLegends,
  initialAspenUi,
  nextDeadline,
  reduce,
  selectedCourse,
  type AspenContext,
  type AspenEvent,
  type AspenUi,
} from './controls';
import { DataBar } from './DataBar';
import { HOTKEY_Y, K, SCREEN, toBezelY } from './layout';
import { NavDisplay } from './NavDisplay';
import { NAV_TOP, SCREEN_H } from './palette';
import { autoRangeFor } from './settings';

/*
 * Aspen Evolution EFD1000 Pro PFD: one 3.5 x 7 in unit that replaces the
 * attitude indicator and HSI. Attitude and tapes on top, the data bar, the
 * HSI or ARC with the map below; REV, range, MENU and five hot keys down the
 * right side; two MODE/SYNC knobs and the three navigation source buttons
 * along the bottom.
 */

function contextFor(s: SimState, d: Derived, panel: PanelInfo): AspenContext {
  const cdi = d.cdi;
  return {
    cdiSources: panel.cdiSources,
    cdiSource: s.nav.cdiSource,
    obsMode: s.fms.obsMode,
    gpsActive: d.gps.active,
    gpss: s.ap.gpss,
    activeWaypointNm: d.gps.distanceNm,
    courseMag: cdi.courseMag,
    courseSyncMag: cdi.source === 'GPS' ? d.gps.bearingMag : d.vor[cdi.source === 'NAV1' ? 0 : 1].bearingToMag,
    headingBugMag: s.bugs.headingMag,
    altitudeBugFt: s.bugs.altitudeFt,
    airspeedBugKt: s.bugs.airspeedKt,
    baroInHg: s.bugs.baroInHg,
    minimumsFt: s.bugs.minimumsFt,
    headingMag: d.headingMag,
    altitudeFt: d.indicatedAltitudeFt,
    iasKt: s.aircraft.iasKt,
    bearing1: s.nav.bearing1,
    bearing2: s.nav.bearing2,
    volts: s.aircraft.engine.volts,
  };
}

/** Inputs without the timestamp the reducer needs. */
type Input =
  | { readonly type: 'leftTurn' | 'rightTurn'; readonly steps: number }
  | { readonly type: 'hotkey'; readonly index: number }
  | { readonly type: 'range' | 'rangeHold'; readonly dir: 1 | -1 }
  | { readonly type: 'navButton'; readonly button: 'left' | 'center' | 'right' }
  | { readonly type: 'leftPush' | 'rightPush' | 'leftHold' | 'rightHold' | 'menu' | 'rev' | 'revHold' | 'timer' };

const NAV_BUTTONS = [
  { button: 'left', x: 96, w: 46, aria: 'Single-line bearing pointer source' },
  { button: 'center', x: 146, w: 58, aria: 'CDI navigation source' },
  { button: 'right', x: 208, w: 46, aria: 'Double-line bearing pointer source' },
] as const;

export function AspenPfd({ panel }: DeviceProps) {
  const sim = useSimulator();
  const { state, derived, db } = useSim();
  const ui = useRef<AspenUi>(initialAspenUi());
  const [, setVersion] = useState(0);

  // Inputs read the live simulator, so two quick clicks within one frame both count.
  const send = (input: Input) => {
    const ev: AspenEvent = { ...input, now: performance.now() };
    const r = reduce(ui.current, ev, contextFor(sim.getState(), sim.getDerived(), panel));
    if (r.ui !== ui.current) {
      ui.current = r.ui;
      setVersion((v) => v + 1);
    }
    for (const c of r.commands) sim.dispatch(c);
  };

  const deadline = nextDeadline(ui.current);
  useEffect(() => {
    if (deadline === null) return;
    const t = window.setTimeout(() => send({ type: 'timer' }), Math.max(deadline - performance.now(), 0) + 5);
    return () => window.clearTimeout(t);
  }, [deadline]);

  // The power-down countdown keeps counting with the simulation paused.
  const counting = ui.current.power.kind === 'shutdown';
  useEffect(() => {
    if (!counting) return;
    const t = window.setInterval(() => setVersion((v) => v + 1), 250);
    return () => window.clearInterval(t);
  }, [counting]);

  const u = ui.current;
  const ctx = contextFor(state, derived, panel);
  const auto = autoCourse(u, ctx);
  const crsMag = selectedCourse(u, ctx);
  const a = state.aircraft;
  const on = u.power.kind !== 'off';
  const splash = u.power.kind === 'boot' && u.power.phase === 'splash';
  const rangeNm = u.autoRangeOn ? autoRangeFor(derived.gps.distanceNm, u.rangeNm) : u.rangeNm;

  const alerter = useRef<AspenAlerter>(initialAspenAlerter(state.bugs.altitudeFt, derived.indicatedAltitudeFt));
  alerter.current = stepAspenAlerter(alerter.current, state.bugs.altitudeFt, derived.indicatedAltitudeFt, a.verticalSpeedFpm);

  // Map symbols are looked up again only after the airplane moves about 6 nm or the range changes.
  const lat10 = Math.round(a.lat * 10);
  const lon10 = Math.round(a.lon * 10);
  const features = useMemo(() => {
    const box = queryBox({ lat: lat10 / 10, lon: lon10 / 10 }, rangeNm);
    return db.inBox(box.south, box.west, box.north, box.east);
  }, [db, lat10, lon10, rangeNm]);

  const arc = u.compass === 'ARC';
  const mapSettings = arc ? u.settings.mapArc : u.settings.map360;
  const view: BasemapView = {
    cx: CX,
    cy: arc ? ARC.cy : ROSE.cy,
    pxPerNm: (arc ? ARC.r : ROSE.r) / rangeNm,
    upTrue: a.headingTrue,
    ownship: { lat: a.lat, lon: a.lon },
    rangeNm,
  };
  const drawMap = (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.save();
    c.scale(K, K);
    c.translate(0, -NAV_TOP);
    drawBasemap(c, view, features, state.fms, mapSettings, { top: NAV_TOP, bottom: SCREEN_H });
    c.restore();
  };

  const brightness = u.brightness.auto ? 1 : 0.25 + (0.75 * u.brightness.level) / 100;
  const legends = hotkeyLegends(u);
  const fd = panel.ap !== 'none' ? derived.flightDirector : null;

  const hold = holdLabels(u, ctx);
  const leftLabel = u.menu ? 'Display brightness' : u.left.fn === 'IAS' ? 'Airspeed bug' : 'Course';
  const rightLabel = u.menu
    ? u.menu.editing === null
      ? 'Select menu page'
      : 'Edit value'
    : { HDG: 'Heading bug', ALT: 'Selected altitude', MIN: 'Minimums', BARO: 'Baro setting' }[u.right.fn];

  return (
    <div class="aspen-pfd">
      <div class="aspen-logo" aria-hidden="true">
        <span>ASPEN</span>
        <svg viewBox="0 0 40 20" width="34" height="17">
          <path d="M2 17 C10 4 22 1 38 3 M8 17 C15 9 24 6 34 7" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <span>AVIONICS</span>
      </div>
      <div class="aspen-evolution" aria-hidden="true">
        EVOLUTION
      </div>

      <Screen x={SCREEN.x} y={SCREEN.y} w={SCREEN.w} h={SCREEN.h} class="aspen-screen" radius={3}>
        {on && (
          <div class="aspen-display" style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}>
            {!splash && (
              <ScreenCanvas y={NAV_TOP * K} w={SCREEN.w} h={(SCREEN_H - NAV_TOP) * K} draw={drawMap} label="Moving map under the compass" />
            )}
            <svg class="screen-svg aspen-svg" width={SCREEN.w} height={SCREEN.h} viewBox="0 0 400 760" role="img" aria-label="Aspen primary flight display">
              {splash ? (
                <Splash />
              ) : (
                <>
                  <Attitude
                    id="aspen"
                    pitchDeg={a.pitchDeg}
                    bankDeg={a.bankDeg}
                    slip={a.slip}
                    iasKt={a.iasKt}
                    altitudeFt={derived.indicatedAltitudeFt}
                    vsFpm={a.verticalSpeedFpm}
                    airspeedBugKt={state.bugs.airspeedKt}
                    altitudeBugFt={state.bugs.altitudeFt}
                    minimumsFt={state.bugs.minimumsFt}
                    fd={fd}
                    fdSolid={state.ap.engaged}
                    tapes={u.settings.tapes}
                    vspeeds={u.settings.vspeeds}
                    iasActive={u.left.active && u.left.fn === 'IAS'}
                    altActive={u.right.active && u.right.fn === 'ALT'}
                    minActive={u.right.active && u.right.fn === 'MIN'}
                    altAlertFlag={alertFlag(alerter.current, state.time)}
                    airDataInvalid={u.power.kind === 'boot'}
                    aligning={u.ahrsUntil !== null}
                  />
                  <DataBar
                    tasKt={a.tasKt}
                    groundSpeedKt={a.groundSpeedKt}
                    oatC={derived.oatC}
                    oatUnits={u.settings.oatUnits}
                    baroInHg={state.bugs.baroStd ? 29.92 : state.bugs.baroInHg}
                    baroUnits={u.settings.baroUnits}
                    baroActive={u.right.fn === 'BARO'}
                    windFromMag={norm360(state.env.windFromTrue - derived.magVar)}
                    windKt={state.env.windKt}
                    windRelativeDeg={derived.windRelativeDeg}
                    onBattery={u.onBattery}
                  />
                  <NavDisplay
                    id="aspen"
                    ui={u}
                    state={state}
                    derived={derived}
                    cdiSources={panel.cdiSources}
                    crsMag={crsMag}
                    autoCrs={auto}
                    rangeNm={rangeNm}
                    gpssAvailable={derived.gps.active}
                    hint={u.hintUntil !== null}
                    shutdownSeconds={u.power.kind === 'shutdown' ? Math.max(Math.ceil((u.power.at - performance.now()) / 1000), 0) : null}
                  />
                </>
              )}
            </svg>
          </div>
        )}
      </Screen>

      {/* Right column: REV, range, MENU and the five hot keys beside their legends. */}
      <BezelButton
        x={314}
        y={92}
        w={28}
        h={34}
        look="aspen"
        class="aspen-key aspen-rev"
        label={<span class="aspen-vertical">REV</span>}
        ariaLabel="REV: reversion and power. Hold to power off or on."
        onPress={() => send({ type: 'rev' })}
        onLongPress={() => send({ type: 'revHold' })}
      />
      <BezelButton
        x={314}
        y={150}
        w={28}
        h={30}
        look="aspen"
        class="aspen-key"
        label="+"
        fontSize={20}
        ariaLabel="Range up (zoom out). Hold for the largest range or Auto Range."
        onPress={() => send({ type: 'range', dir: 1 })}
        onLongPress={() => send({ type: 'rangeHold', dir: 1 })}
      />
      <div class="aspen-rng" aria-hidden="true">
        RNG
      </div>
      <BezelButton
        x={314}
        y={204}
        w={28}
        h={30}
        look="aspen"
        class="aspen-key"
        label="-"
        fontSize={22}
        ariaLabel="Range down (zoom in). Hold for the smallest range or Auto Range."
        onPress={() => send({ type: 'range', dir: -1 })}
        onLongPress={() => send({ type: 'rangeHold', dir: -1 })}
      />
      <BezelButton
        x={314}
        y={266}
        w={28}
        h={44}
        look="aspen"
        class="aspen-key"
        label={<span class="aspen-vertical">MENU</span>}
        ariaLabel="MENU"
        onPress={() => send({ type: 'menu' })}
      />
      {HOTKEY_Y.map((y, i) => (
        <BezelButton
          key={i}
          x={314}
          y={toBezelY(y) - 16}
          w={28}
          h={32}
          look="aspen"
          class="aspen-key"
          label={<span class="aspen-keymark" />}
          ariaLabel={u.menu ? `Menu key ${i + 1}` : `Hot key ${i + 1}: ${legends[i]}`}
          onPress={() => send({ type: 'hotkey', index: i })}
        />
      ))}

      {/* Bottom: photocell, knobs, navigation source buttons, card slot. */}
      <div class="aspen-photocell" aria-hidden="true" />
      <Knob
        id="aspen.left-knob"
        x={46}
        y={652}
        size={68}
        look="aspen"
        label="Left knob (CRS and IAS; brightness in the menu)"
        innerLabel={leftLabel}
        pushLabel={u.menu ? 'Auto / manual' : 'Next function'}
        onInner={(n) => send({ type: 'leftTurn', steps: n })}
        onPush={() => send({ type: 'leftPush' })}
        {...(hold.left !== null && { onLongPush: () => send({ type: 'leftHold' }), longPushLabel: hold.left })}
      />
      <div class="aspen-knob-mark" style={{ left: '46px', top: '652px' }} aria-hidden="true">
        MODE<br />SYNC
      </div>
      {NAV_BUTTONS.map((b) => (
        <BezelButton
          key={b.button}
          x={b.x}
          y={608}
          w={b.w}
          h={26}
          look="aspen"
          class={`aspen-key aspen-nav-${b.button}`}
          label={<span class="aspen-keymark aspen-keymark-v" />}
          ariaLabel={b.aria}
          onPress={() => send({ type: 'navButton', button: b.button })}
        />
      ))}
      <Knob
        id="aspen.right-knob"
        x={304}
        y={652}
        size={68}
        look="aspen"
        label="Right knob (HDG, ALT, MIN and BARO; menu pages and values)"
        innerLabel={rightLabel}
        pushLabel={u.menu ? 'Back to pages' : 'Next function'}
        onInner={(n) => send({ type: 'rightTurn', steps: n })}
        onPush={() => send({ type: 'rightPush' })}
        {...(hold.right !== null && { onLongPush: () => send({ type: 'rightHold' }), longPushLabel: hold.right })}
      />
      <div class="aspen-knob-mark" style={{ left: '304px', top: '652px' }} aria-hidden="true">
        MODE<br />SYNC
      </div>
      <div class="aspen-sd" aria-hidden="true" />
    </div>
  );
}

function Splash() {
  return (
    <g>
      <rect x={0} y={0} width={400} height={760} fill="#000" />
      <text x={200} y={350} text-anchor="middle" font-size={34} letter-spacing={6} fill="#6f9fd8">
        ASPEN
      </text>
      <text x={200} y={386} text-anchor="middle" font-size={20} letter-spacing={6} fill="#6f9fd8">
        AVIONICS
      </text>
      <text x={200} y={430} text-anchor="middle" font-size={18} letter-spacing={3} fill="#c9ccd2">
        EVOLUTION
      </text>
      <text x={200} y={520} text-anchor="middle" font-size={16} fill="#c9ccd2">
        INITIALIZING
      </text>
    </g>
  );
}

export default AspenPfd;
