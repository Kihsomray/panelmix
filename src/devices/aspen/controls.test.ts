import { describe, expect, it } from 'vitest';
import { alertFlag, initialAspenAlerter, stepAspenAlerter } from './alerter';
import {
  autoCourse,
  bearingCycle,
  holdLabels,
  hotkeyLegends,
  initialAspenUi,
  KNOB_IDLE_MS,
  nextDeadline,
  reduce,
  selectedCourse,
  SHUTDOWN_MS,
  type AspenContext,
  type AspenEvent,
  type AspenUi,
} from './controls';
import { editRow, MENU_PAGES, menuRows } from './menuPages';
import { autoRangeFor, DEFAULT_SETTINGS, stepRange } from './settings';

const ctx: AspenContext = {
  cdiSources: ['GPS', 'NAV1'],
  cdiSource: 'GPS',
  obsMode: false,
  gpsActive: true,
  gpss: false,
  activeWaypointNm: 21.4,
  courseMag: 334,
  courseSyncMag: 336.4,
  headingBugMag: 310,
  altitudeBugFt: 3500,
  airspeedBugKt: 90,
  baroInHg: 30.12,
  minimumsFt: null,
  headingMag: 309.6,
  altitudeFt: 3492,
  iasKt: 104.6,
  bearing1: 'OFF',
  bearing2: 'OFF',
  volts: 28.1,
};

type Input =
  | { type: 'leftTurn' | 'rightTurn'; steps: number; now?: number }
  | { type: 'hotkey'; index: number; now?: number }
  | { type: 'range' | 'rangeHold'; dir: 1 | -1; now?: number }
  | { type: 'navButton'; button: 'left' | 'center' | 'right'; now?: number }
  | { type: 'leftPush' | 'rightPush' | 'leftHold' | 'rightHold' | 'menu' | 'rev' | 'revHold' | 'timer'; now?: number };

/** Feeds inputs 100 ms apart (unless timed) and collects the simulator commands. */
function run(ui: AspenUi, inputs: readonly Input[], c: AspenContext = ctx) {
  const commands = [];
  let t = 1000;
  for (const i of inputs) {
    t = i.now ?? t + 100;
    const ev: AspenEvent = { ...i, now: t };
    const r = reduce(ui, ev, c);
    ui = r.ui;
    commands.push(...r.commands);
  }
  return { ui, commands };
}

const vloc: AspenContext = { ...ctx, cdiSource: 'NAV1', courseMag: 310, courseSyncMag: 340.4 };

describe('Aspen knobs', () => {
  it('swallows the first click to wake the right knob, then moves the heading bug', () => {
    const r = run(initialAspenUi(), [{ type: 'rightTurn', steps: 1 }]);
    expect(r.commands).toEqual([]);
    expect(r.ui.right).toEqual({ fn: 'HDG', active: true });
    expect(run(r.ui, [{ type: 'rightTurn', steps: 5 }]).commands).toEqual([{ type: 'bug.heading', mag: 315 }]);
  });

  it('cycles the right knob HDG, ALT and back, adding MIN only when minimums are shown', () => {
    const order = (c: AspenContext) => {
      const fns = [];
      let ui = initialAspenUi();
      for (let i = 0; i < 4; i++) {
        ui = run(ui, [{ type: 'rightPush' }], c).ui;
        fns.push(ui.right.fn);
      }
      return fns;
    };
    expect(order(ctx)).toEqual(['HDG', 'ALT', 'HDG', 'ALT']);
    expect(order({ ...ctx, minimumsFt: 1200 })).toEqual(['HDG', 'ALT', 'MIN', 'HDG']);
  });

  it('sets the selected altitude in hundreds and syncs it to the current altitude', () => {
    const alt = run(initialAspenUi(), [{ type: 'rightPush' }, { type: 'rightPush' }]).ui;
    expect(run(alt, [{ type: 'rightTurn', steps: 3 }]).commands).toEqual([{ type: 'bug.altitude', ft: 3800 }]);
    expect(run(alt, [{ type: 'rightHold' }]).commands).toEqual([{ type: 'bug.altitude', ft: 3490 }]);
  });

  it('returns both knobs home after 10 s without input', () => {
    const awake = run(initialAspenUi(), [{ type: 'rightPush', now: 5000 }, { type: 'leftPush', now: 5000 }]).ui;
    expect(nextDeadline(awake)).toBe(5000 + KNOB_IDLE_MS);
    const home = run(awake, [{ type: 'timer', now: 5000 + KNOB_IDLE_MS }]).ui;
    expect(home.right).toEqual({ fn: 'HDG', active: false });
    expect(home.left).toEqual({ fn: 'CRS', active: false });
  });

  it('leaves an Auto Course CRS alone and goes straight to the airspeed bug', () => {
    const ui = initialAspenUi();
    expect(autoCourse(ui, ctx)).toBe(true);
    expect(run(ui, [{ type: 'leftTurn', steps: 3 }]).ui.left.active).toBe(false);
    const ias = run(ui, [{ type: 'leftPush' }]);
    expect(ias.ui.left).toEqual({ fn: 'IAS', active: true });
    expect(run(ias.ui, [{ type: 'leftTurn', steps: -5 }]).commands).toEqual([{ type: 'bug.airspeed', kt: 85 }]);
    expect(run(ias.ui, [{ type: 'leftHold' }]).commands).toEqual([{ type: 'bug.airspeed', kt: 105 }]);
  });

  it('sets a VOR course with course.set and syncs it to the station', () => {
    const crs = run(initialAspenUi(), [{ type: 'leftTurn', steps: 1 }], vloc).ui;
    expect(run(crs, [{ type: 'leftTurn', steps: -4 }], vloc).commands).toEqual([{ type: 'course.set', mag: 306 }]);
    expect(run(crs, [{ type: 'leftHold' }], vloc).commands).toEqual([{ type: 'course.set', mag: 340 }]);
  });

  it('keeps a hand-set GPS course when Auto Course is off, starting from the desired track', () => {
    let ui = run(initialAspenUi(), [{ type: 'menu' }, { type: 'hotkey', index: 2 }, { type: 'rightTurn', steps: 1 }, { type: 'menu' }]).ui;
    expect(ui.settings.autoCrs).toBe(false);
    expect(selectedCourse(ui, ctx)).toBe(334);
    ui = run(ui, [{ type: 'leftPush' }, { type: 'leftTurn', steps: 6 }]).ui;
    expect(selectedCourse(ui, ctx)).toBe(340);
  });

  it('adjusts the baro after the BARO hot key, in inches or millibars, and syncs to standard', () => {
    const baro = run(initialAspenUi(), [{ type: 'hotkey', index: 4 }]).ui;
    expect(baro.right).toEqual({ fn: 'BARO', active: true });
    expect(run(baro, [{ type: 'rightTurn', steps: -2 }]).commands).toEqual([{ type: 'baro.set', inHg: 30.1 }]);
    expect(run(baro, [{ type: 'rightHold' }]).commands).toEqual([{ type: 'baro.set', inHg: 29.92 }]);
    expect(run(baro, [{ type: 'hotkey', index: 4 }]).ui.right).toEqual({ fn: 'HDG', active: false });
    const mb = { ...baro, settings: { ...baro.settings, baroUnits: 'MB' as const } };
    const r = run(mb, [{ type: 'rightTurn', steps: 1 }]);
    const set = r.commands[0];
    expect(set?.type).toBe('baro.set');
    expect(set && set.type === 'baro.set' ? Math.round(set.inHg * 33.8639) : 0).toBe(1021);
  });
});

describe('Aspen hot keys and buttons', () => {
  it('shows minimums ready to edit, and hides them again', () => {
    const on = run(initialAspenUi(), [{ type: 'hotkey', index: 1 }]);
    expect(on.commands).toEqual([{ type: 'minimums.set', ft: 2500 }]);
    expect(on.ui.right).toEqual({ fn: 'MIN', active: true });
    const off = run(on.ui, [{ type: 'hotkey', index: 1 }], { ...ctx, minimumsFt: 2500 });
    expect(off.commands).toEqual([{ type: 'minimums.set', ft: null }]);
    expect(off.ui.right.fn).toBe('HDG');
    expect(run(off.ui, [{ type: 'hotkey', index: 1 }]).commands).toEqual([{ type: 'minimums.set', ft: 2500 }]);
  });

  it('toggles 360 and ARC and the hot key page', () => {
    const ui = run(initialAspenUi(), [{ type: 'hotkey', index: 2 }]).ui;
    expect(ui.compass).toBe('ARC');
    expect(hotkeyLegends(ui)).toEqual(['1/2', 'MIN', 'ARC', 'GPSS', 'BARO']);
    expect(hotkeyLegends(run(ui, [{ type: 'hotkey', index: 0 }]).ui)[0]).toBe('2/2');
  });

  it('switches GPS steering in the shared autopilot state, only with a steering signal to turn it on', () => {
    expect(run(initialAspenUi(), [{ type: 'hotkey', index: 3 }]).commands).toEqual([{ type: 'ap.gpss', on: true }]);
    expect(run(initialAspenUi(), [{ type: 'hotkey', index: 3 }], { ...ctx, gpss: true }).commands).toEqual([{ type: 'ap.gpss', on: false }]);
    expect(run(initialAspenUi(), [{ type: 'hotkey', index: 3 }], { ...ctx, gpsActive: false }).commands).toEqual([]);
    expect(run(initialAspenUi(), [{ type: 'hotkey', index: 3 }], { ...ctx, gpsActive: false, gpss: true }).commands).toEqual([
      { type: 'ap.gpss', on: false },
    ]);
  });

  it('labels the knob holds (SYNC) only where they do something', () => {
    const ui = initialAspenUi();
    expect(holdLabels(ui, ctx)).toEqual({ left: null, right: 'Sync heading' });
    expect(holdLabels(ui, vloc).left).toBe('Sync course');
    expect(holdLabels(run(ui, [{ type: 'leftPush' }]).ui, ctx).left).toBe('Sync airspeed');
    expect(holdLabels(run(ui, [{ type: 'hotkey', index: 4 }]).ui, ctx).right).toBe('Set 29.92');
    expect(holdLabels(run(ui, [{ type: 'menu' }]).ui, ctx)).toEqual({ left: null, right: null });
  });

  it('cycles the CDI source and the bearing pointers', () => {
    expect(run(initialAspenUi(), [{ type: 'navButton', button: 'center' }]).commands).toEqual([{ type: 'cdi.cycle', sources: ['GPS', 'NAV1'] }]);
    expect(bearingCycle(['GPS', 'NAV1'])).toEqual(['OFF', 'GPS', 'NAV1']);
    expect(run(initialAspenUi(), [{ type: 'navButton', button: 'left' }]).commands).toEqual([{ type: 'bearing.set', pointer: 1, source: 'GPS' }]);
    expect(run(initialAspenUi(), [{ type: 'navButton', button: 'right' }], { ...ctx, bearing2: 'NAV1' }).commands).toEqual([
      { type: 'bearing.set', pointer: 2, source: 'OFF' },
    ]);
  });

  it('steps the map range and runs Auto Range from the end of the scale', () => {
    expect(stepRange(15, 1)).toBe(20);
    expect(stepRange(2, -1)).toBe(2);
    expect(autoRangeFor(21.4, 15)).toBe(30);
    let ui = run(initialAspenUi(), [{ type: 'range', dir: -1 }]).ui;
    expect(ui.rangeNm).toBe(10);
    ui = { ...ui, settings: { ...ui.settings, autoRange: true } };
    ui = run(ui, [{ type: 'rangeHold', dir: 1 }]).ui;
    expect(ui.rangeNm).toBe(200);
    ui = run(ui, [{ type: 'rangeHold', dir: 1 }]).ui;
    expect(ui.autoRangeOn).toBe(true);
    ui = run(ui, [{ type: 'range', dir: 1 }]).ui;
    expect(ui).toMatchObject({ autoRangeOn: false, rangeNm: 30 });
  });

  it('powers down 5 s after REV is held unless a control is touched, and back up with another hold', () => {
    const going = run(initialAspenUi(), [{ type: 'revHold', now: 1000 }]).ui;
    expect(going.power).toEqual({ kind: 'shutdown', at: 1000 + SHUTDOWN_MS });
    const aborted = run(going, [{ type: 'hotkey', index: 2, now: 2000 }]);
    expect(aborted.ui.power.kind).toBe('on');
    expect(aborted.ui.compass).toBe('360');
    const off = run(going, [{ type: 'timer', now: 1000 + SHUTDOWN_MS }]).ui;
    expect(off.power.kind).toBe('off');
    expect(run(off, [{ type: 'rev' }, { type: 'rightTurn', steps: 2 }]).ui.power.kind).toBe('off');
    let boot = run(off, [{ type: 'revHold', now: 9000 }]).ui;
    boot = run(boot, [{ type: 'timer', now: nextDeadline(boot)! }]).ui;
    expect(boot.power).toMatchObject({ kind: 'boot', phase: 'init' });
    expect(run(boot, [{ type: 'timer', now: nextDeadline(boot)! }]).ui.power.kind).toBe('on');
  });
});

describe('Aspen menu', () => {
  it('opens on GENERAL SETTINGS A and pages with the right knob without wrapping', () => {
    let ui = run(initialAspenUi(), [{ type: 'menu' }]).ui;
    expect(ui.menu).toEqual({ page: 0, editing: null });
    ui = run(ui, [{ type: 'rightTurn', steps: 20 }]).ui;
    expect(ui.menu?.page).toBe(MENU_PAGES.length - 1);
    expect(run(ui, [{ type: 'menu' }]).ui.menu).toBeNull();
  });

  it('edits an option with its menu key and the right knob, then returns to page selection', () => {
    let ui = run(initialAspenUi(), [{ type: 'menu' }, { type: 'hotkey', index: 3 }]).ui;
    expect(ui.menu).toEqual({ page: 0, editing: 3 });
    ui = run(ui, [{ type: 'rightTurn', steps: 1 }]).ui;
    expect(ui.settings.arcMode).toBe('CDI');
    ui = run(ui, [{ type: 'rightPush' }]).ui;
    expect(ui.menu).toEqual({ page: 0, editing: null });
  });

  it('ignores status and unavailable rows, and adjusts brightness with the left knob', () => {
    let ui = run(initialAspenUi(), [{ type: 'menu' }, { type: 'hotkey', index: 1 }]).ui;
    expect(ui.menu?.editing).toBeNull();
    ui = run(ui, [{ type: 'leftTurn', steps: 5 }]).ui;
    expect(ui.brightness).toEqual({ auto: true, level: 70 });
    ui = run(ui, [{ type: 'leftPush' }, { type: 'leftTurn', steps: -5 }]).ui;
    expect(ui.brightness).toEqual({ auto: false, level: 60 });
  });

  it('lays out the real pages and edits values within their ranges', () => {
    const rows = menuRows(0, DEFAULT_SETTINGS, { volts: 28, onBattery: false });
    expect(rows.map((r) => r?.label)).toEqual(['TPS:', 'RAD ALT:', 'AUTOCRS:', 'ARC MODE:', 'AHRS:']);
    expect(editRow(DEFAULT_SETTINGS, 'map360.declutter', 3).map360.declutter).toBe(4);
    expect(editRow(DEFAULT_SETTINGS, 'map360.declutter', -9).map360.declutter).toBe(0);
    expect(editRow(DEFAULT_SETTINGS, 'vs.vy', -100).vspeeds.vy).toBe(0);
    expect(editRow(DEFAULT_SETTINGS, 'mapArc.ndb', 1).mapArc.show.ndb).toBe(false);
  });
});

describe('Aspen altitude alerter', () => {
  it('raises the flag 200 ft or 15 s out, drops it at the altitude and flashes on a deviation', () => {
    // 300 ft to go at 1,000 fpm is 18 s away: not yet. 240 ft is 14.4 s: flag on.
    let s = stepAspenAlerter(initialAspenAlerter(5000, 4000), 5000, 4700, 1000);
    expect(s.phase).toBe('idle');
    s = stepAspenAlerter(s, 5000, 4760, 1000);
    expect(alertFlag(s, 0)).toBe(true);
    s = stepAspenAlerter(s, 5000, 4990, 200);
    expect(s.phase).toBe('captured');
    expect(alertFlag(s, 0)).toBe(false);
    s = stepAspenAlerter(s, 5000, 5210, 300);
    expect(s.phase).toBe('deviation');
    expect([alertFlag(s, 0), alertFlag(s, 0.5)]).toEqual([true, false]);
  });
});
