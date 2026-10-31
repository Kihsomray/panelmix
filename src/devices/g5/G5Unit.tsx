import { useEffect, useRef, useState } from 'preact/hooks';
import { useSimulator } from '../../sim/hooks';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { Screen } from '../../ui/Screen';
import type { PanelInfo } from '../types';
import { HsiPage } from './HsiPage';
import { holdLabel, initialUi, menuItems, nextDeadline, reduce, type G5Context, type G5Event, type G5Page, type G5Shared, type G5Ui } from './menu';
import { BacklightPage, EditPopup, MenuTiles, PickList, PowerOffPrompt, SetupList, Splash } from './Overlays';
import { PfdPage } from './PfdPage';

/*
 * One G5: the bezel with its power button, light sensor, card slot and
 * selection knob, and the display showing the PFD or HSI page. Each unit
 * keeps its own page, menu and backlight state, and both read the same
 * simulator, so a baro or heading bug set on one shows on the other (the
 * real pair cross-fills them).
 */

export const UNIT_H = 360;
const SCREEN = { x: 26, y: 46, w: 288, h: 216 } as const;

/** What the menu logic needs, read from the live simulator when the input happens. */
function contextFor(s: SimState, d: Derived, panel: PanelInfo, shared: G5Shared): G5Context {
  const cdi = d.cdi;
  const courseSyncMag = cdi.source === 'GPS' ? d.gps.bearingMag : d.vor[cdi.source === 'NAV1' ? 0 : 1].bearingToMag;
  return {
    shared,
    ap: panel.ap,
    gpss: s.ap.gpss,
    cdiSources: panel.cdiSources,
    cdiSource: s.nav.cdiSource,
    obsMode: s.fms.obsMode,
    headingBugMag: s.bugs.headingMag,
    altitudeBugFt: s.bugs.altitudeFt,
    baroInHg: s.bugs.baroInHg,
    courseMag: cdi.courseMag,
    headingMag: d.headingMag,
    altitudeFt: d.indicatedAltitudeFt,
    courseSyncMag,
    bearing1: s.nav.bearing1,
    bearing2: s.nav.bearing2,
  };
}

type Input = G5Event['type'];

export function G5Unit({
  id,
  y,
  initialPage,
  label,
  state,
  derived,
  panel,
  shared,
  onShared,
}: {
  id: string;
  y: number;
  initialPage: G5Page;
  label: string;
  state: SimState;
  derived: Derived;
  panel: PanelInfo;
  shared: G5Shared;
  onShared: (next: G5Shared) => void;
}) {
  const sim = useSimulator();
  const ui = useRef<G5Ui>(initialUi(initialPage));
  const [, setVersion] = useState(0);

  const send = (type: Input, steps = 0) => {
    const now = performance.now();
    const ev: G5Event = type === 'turn' ? { type, steps, now } : { type, now };
    const r = reduce(ui.current, ev, contextFor(sim.getState(), sim.getDerived(), panel, shared));
    if (r.ui !== ui.current) {
      ui.current = r.ui;
      setVersion((v) => v + 1);
    }
    if (r.shared) onShared(r.shared);
    for (const c of r.commands) sim.dispatch(c);
  };

  // One timer for whatever is pending: a menu closing, the power-off countdown, the boot phases.
  const deadline = nextDeadline(ui.current);
  useEffect(() => {
    if (deadline === null) return;
    const t = window.setTimeout(() => send('timer'), Math.max(deadline - performance.now(), 0) + 5);
    return () => window.clearTimeout(t);
  }, [deadline]);

  // Keep the countdown ticking even with the simulation paused (no frames then).
  const counting = ui.current.mode.kind === 'powerOff';
  useEffect(() => {
    if (!counting) return;
    const t = window.setInterval(() => setVersion((v) => v + 1), 250);
    return () => window.clearInterval(t);
  }, [counting]);

  const u = ui.current;
  const mode = u.mode;
  const ctx = contextFor(state, derived, panel, shared);
  const gpss = state.ap.gpss;
  const hold = holdLabel(u, ctx);
  const items = menuItems(u.page, ctx);
  const on = mode.kind !== 'off';
  const brightness = u.backlight.auto ? 1 : 0.3 + (0.7 * u.backlight.level) / 100;
  const localizer = derived.cdi.label.startsWith('LOC');

  let knob = { inner: u.page === 'pfd' ? 'Baro setting' : 'Heading bug', push: 'Menu' };
  if (mode.kind === 'menu' || mode.kind === 'setup' || mode.kind === 'pick') knob = { inner: 'Move cursor', push: 'Select' };
  else if (mode.kind === 'edit') knob = { inner: 'Change value', push: 'Accept' };
  else if (mode.kind === 'backlight') knob = { inner: 'Backlight level', push: 'Close' };

  return (
    <div class="g5-unit" style={{ top: `${y}px` }} role="group" aria-label={label}>
      <div class="g5-logo" aria-hidden="true">
        GARMIN
      </div>
      <div class="g5-glass" aria-hidden="true" />
      <Screen x={SCREEN.x} y={SCREEN.y} w={SCREEN.w} h={SCREEN.h} class="g5-screen">
        {on && (
          <svg
            class="screen-svg g5-svg"
            width={SCREEN.w}
            height={SCREEN.h}
            viewBox="0 0 320 240"
            style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}
            role="img"
            aria-label={`${label}: ${u.page === 'pfd' ? 'PFD page' : 'HSI page'}`}
          >
            {mode.kind === 'boot' && mode.phase === 'splash' ? (
              <Splash />
            ) : (
              <>
                {u.page === 'pfd' ? (
                  <PfdPage
                    id={id}
                    state={state}
                    derived={derived}
                    gfc500={panel.ap === 'gfc500'}
                    esp={shared.esp}
                    gpss={gpss}
                    aligning={mode.kind === 'boot'}
                  />
                ) : (
                  <HsiPage state={state} derived={derived} cdiSources={panel.cdiSources} gpss={gpss} />
                )}
                {mode.kind === 'menu' && <MenuTiles items={items} cursor={mode.cursor} ctx={ctx} />}
                {mode.kind === 'edit' && <EditPopup target={mode.target} ctx={ctx} localizer={localizer} />}
                {mode.kind === 'setup' && <SetupList cursor={mode.cursor} ctx={ctx} cdiSources={panel.cdiSources} />}
                {mode.kind === 'pick' && <PickList pointer={mode.pointer} cursor={mode.cursor} cdiSources={panel.cdiSources} />}
                {mode.kind === 'backlight' && <BacklightPage auto={u.backlight.auto} level={u.backlight.level} />}
                {mode.kind === 'powerOff' && <PowerOffPrompt seconds={Math.max(Math.ceil((mode.at - performance.now()) / 1000), 0)} />}
              </>
            )}
          </svg>
        )}
      </Screen>

      <BezelButton
        x={22}
        y={301}
        w={34}
        h={34}
        shape="round"
        look="garmin"
        class="g5-power"
        label={<PowerIcon />}
        ariaLabel={`${label} power and backlight. Press for the backlight page, hold to turn off or on.`}
        onPress={() => send('power')}
        onLongPress={() => send('powerHold')}
      />
      <div class="g5-sensor" style={{ left: '92px', top: '311px' }} aria-hidden="true" />
      <div class="g5-sensor" style={{ left: '163px', top: '311px' }} aria-hidden="true" />
      <div class="g5-sd" style={{ left: '145px', top: '281px', width: '50px' }} aria-hidden="true" />
      <Knob
        id={`${id}.knob`}
        x={286}
        y={318}
        size={58}
        label={`${label} selection knob`}
        innerLabel={knob.inner}
        pushLabel={knob.push}
        onInner={(n) => send('turn', n)}
        onPush={() => send('push')}
        {...(hold !== null && { onLongPush: () => send('hold'), longPushLabel: hold })}
      />
    </div>
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M6.2 5.2a6.5 6.5 0 1 0 7.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <path d="M10 2.5v7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
    </svg>
  );
}
