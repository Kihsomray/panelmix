import { describe, expect, it } from 'vitest';
import { stepAltitude, standardRateBankDeg, headingText } from './format';
import {
  bearingLabel,
  bearingOptions,
  holdLabel,
  initialUi,
  INITIAL_SHARED,
  MENU_IDLE_MS,
  menuItems,
  nextDeadline,
  POWER_OFF_MS,
  reduce,
  type G5Context,
  type G5Event,
  type G5Ui,
} from './menu';

const ctx: G5Context = {
  shared: INITIAL_SHARED,
  ap: 'gfc500',
  gpss: false,
  cdiSources: ['GPS', 'NAV1'],
  cdiSource: 'GPS',
  obsMode: false,
  headingBugMag: 310,
  altitudeBugFt: 3500,
  baroInHg: 29.92,
  courseMag: 300,
  headingMag: 297.4,
  altitudeFt: 3488,
  courseSyncMag: 305.6,
  bearing1: 'OFF',
  bearing2: 'OFF',
};

type Input = { type: 'turn'; steps: number; now?: number } | { type: Exclude<G5Event['type'], 'turn'>; now?: number };

/** Feeds a list of inputs 100 ms apart (unless timed), collecting every simulator command. */
function run(ui: G5Ui, events: readonly Input[], c: G5Context = ctx) {
  const commands = [];
  let t = 1000;
  for (const e of events) {
    t = e.now ?? t + 100;
    const ev: G5Event = e.type === 'turn' ? { type: 'turn', steps: e.steps, now: t } : { type: e.type, now: t };
    const r = reduce(ui, ev, c);
    ui = r.ui;
    commands.push(...r.commands);
  }
  return { ui, commands };
}

describe('G5 knob default functions', () => {
  it('sets the baro on the PFD page and the heading bug on the HSI page', () => {
    expect(run(initialUi('pfd'), [{ type: 'turn', steps: 3 }]).commands).toEqual([{ type: 'baro.set', inHg: 29.95 }]);
    expect(run(initialUi('hsi'), [{ type: 'turn', steps: -12 }]).commands).toEqual([{ type: 'bug.heading', mag: 298 }]);
  });

  it('wraps the heading bug through north', () => {
    const r = run(initialUi('hsi'), [{ type: 'turn', steps: 55 }], { ...ctx, headingBugMag: 350 });
    expect(r.commands).toEqual([{ type: 'bug.heading', mag: 45 }]);
  });

  it('syncs the heading bug when the knob is held on the HSI page only', () => {
    expect(run(initialUi('hsi'), [{ type: 'hold' }]).commands).toEqual([{ type: 'bug.heading', mag: 297 }]);
    expect(run(initialUi('pfd'), [{ type: 'hold' }]).commands).toEqual([]);
  });
});

describe('G5 menu', () => {
  it('lists the real tiles for each page and installation', () => {
    expect(menuItems('pfd', ctx)).toEqual(['back', 'heading', 'altitude', 'hsi', 'esp']);
    expect(menuItems('hsi', ctx)).toEqual(['back', 'heading', 'altitude', 'pfd', 'setup']);
    expect(menuItems('hsi', { ...ctx, cdiSource: 'NAV1' })).toEqual(['back', 'heading', 'altitude', 'course', 'pfd', 'setup']);
    expect(menuItems('hsi', { ...ctx, obsMode: true })).toEqual(['back', 'heading', 'altitude', 'obs', 'pfd', 'setup']);
    expect(menuItems('pfd', { ...ctx, ap: 'kap140' })).toEqual(['back', 'heading', 'altitude', 'hsi', 'gpss']);
    expect(menuItems('hsi', { ...ctx, ap: 'none' })).toEqual(['back', 'heading', 'altitude', 'pfd', 'gpss', 'setup']);
  });

  it('opens on Back, which closes it again', () => {
    const open = run(initialUi('pfd'), [{ type: 'push' }]);
    expect(open.ui.mode).toEqual({ kind: 'menu', cursor: 0 });
    expect(run(open.ui, [{ type: 'push' }]).ui.mode).toEqual({ kind: 'page' });
  });

  it('sets the selected altitude in hundreds from the Altitude pop-up and returns to the page', () => {
    const r = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 2 }, { type: 'push' }]);
    expect(r.ui.mode).toEqual({ kind: 'edit', target: 'altitude' });
    const turned = run(r.ui, [{ type: 'turn', steps: 5 }]);
    expect(turned.commands).toEqual([{ type: 'bug.altitude', ft: 4000 }]);
    expect(run(turned.ui, [{ type: 'push' }]).ui.mode).toEqual({ kind: 'page' });
  });

  it('syncs heading and altitude with a press and hold, in the menu or in the pop-up', () => {
    const menu = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 2 }]).ui;
    expect(run(menu, [{ type: 'hold' }]).commands).toEqual([{ type: 'bug.altitude', ft: 3490 }]);
    const edit = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 1 }, { type: 'push' }]).ui;
    expect(run(edit, [{ type: 'hold' }]).commands).toEqual([{ type: 'bug.heading', mag: 297 }]);
  });

  it('sets the VOR course with course.set and syncs it straight to the station', () => {
    const vlo = { ...ctx, cdiSource: 'NAV1' as const };
    const edit = run(initialUi('hsi'), [{ type: 'push' }, { type: 'turn', steps: 3 }, { type: 'push' }], vlo).ui;
    expect(edit.mode).toEqual({ kind: 'edit', target: 'course' });
    expect(run(edit, [{ type: 'turn', steps: -4 }], vlo).commands).toEqual([{ type: 'course.set', mag: 296 }]);
    expect(run(edit, [{ type: 'hold' }], vlo).commands).toEqual([{ type: 'course.set', mag: 306 }]);
  });

  it('closes the course pop-up when the CDI switches back to GPS', () => {
    const vlo = { ...ctx, cdiSource: 'NAV1' as const };
    const edit = run(initialUi('hsi'), [{ type: 'push' }, { type: 'turn', steps: 3 }, { type: 'push' }], vlo).ui;
    const r = run(edit, [{ type: 'turn', steps: 1 }], ctx);
    expect(r.ui.mode).toEqual({ kind: 'page' });
    expect(r.commands).toEqual([]);
  });

  it('switches pages from the HSI and PFD tiles', () => {
    const r = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 3 }, { type: 'push' }]);
    expect(r.ui.page).toBe('hsi');
    expect(r.ui.mode).toEqual({ kind: 'page' });
  });

  it('keeps the cursor on the tile list ends instead of wrapping', () => {
    const r = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: -3 }]);
    expect(r.ui.mode).toEqual({ kind: 'menu', cursor: 0 });
    expect(run(r.ui, [{ type: 'turn', steps: 40 }]).ui.mode).toEqual({ kind: 'menu', cursor: 4 });
  });

  it('toggles ESP for both units and stays in the menu', () => {
    const open = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 4 }]).ui;
    const r = reduce(open, { type: 'push', now: 2000 }, ctx);
    expect(r.shared).toEqual({ esp: false });
    expect(r.ui.mode.kind).toBe('menu');
  });

  it('closes after a quiet spell', () => {
    const open = run(initialUi('pfd'), [{ type: 'push', now: 5000 }]).ui;
    expect(nextDeadline(open)).toBe(5000 + MENU_IDLE_MS);
    expect(run(open, [{ type: 'timer', now: 5000 + MENU_IDLE_MS - 1 }]).ui.mode.kind).toBe('menu');
    expect(run(open, [{ type: 'timer', now: 5000 + MENU_IDLE_MS }]).ui.mode.kind).toBe('page');
  });
});

describe('G5 GPSS and hold actions', () => {
  it('switches GPS steering in the shared autopilot state', () => {
    const kap = { ...ctx, ap: 'kap140' };
    const r = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 4 }, { type: 'push' }], kap);
    expect(r.commands).toEqual([{ type: 'ap.gpss', on: true }]);
    expect(run(r.ui, [{ type: 'push' }], { ...kap, gpss: true }).commands).toEqual([{ type: 'ap.gpss', on: false }]);
  });

  it('labels press-and-hold only where it syncs something', () => {
    expect(holdLabel(initialUi('hsi'), ctx)).toBe('Sync heading');
    expect(holdLabel(initialUi('pfd'), ctx)).toBeNull();
    const menu = run(initialUi('pfd'), [{ type: 'push' }, { type: 'turn', steps: 2 }]).ui;
    expect(holdLabel(menu, ctx)).toBe('Sync altitude');
    expect(holdLabel(run(menu, [{ type: 'turn', steps: 1 }]).ui, ctx)).toBeNull();
    const edit = run(initialUi('hsi'), [{ type: 'push' }, { type: 'turn', steps: 3 }, { type: 'push' }], { ...ctx, cdiSource: 'NAV1' }).ui;
    expect(holdLabel(edit, ctx)).toBe('Sync course');
  });
});

describe('G5 bearing pointer setup', () => {
  it('offers None, GPS and the VHF receivers', () => {
    expect(bearingOptions(['GPS', 'NAV1'])).toEqual(['OFF', 'GPS', 'NAV1']);
    expect(bearingLabel('NAV1', ['GPS', 'NAV1'])).toBe('VLOC');
    expect(bearingLabel('NAV2', ['GPS', 'NAV1', 'NAV2'])).toBe('VLOC2');
    expect(bearingLabel('OFF', ['GPS'])).toBe('None');
  });

  it('sets bearing pointer 2 to VLOC through Setup', () => {
    const r = run(initialUi('hsi'), [
      { type: 'push' },
      { type: 'turn', steps: 9 }, // to Setup, the last tile
      { type: 'push' },
      { type: 'turn', steps: 2 }, // Bearing Pointer 2
      { type: 'push' },
      { type: 'turn', steps: 2 }, // None -> GPS -> VLOC
      { type: 'push' },
    ]);
    expect(r.commands).toEqual([{ type: 'bearing.set', pointer: 2, source: 'NAV1' }]);
    expect(r.ui.mode).toEqual({ kind: 'setup', cursor: 2 });
    expect(run(r.ui, [{ type: 'turn', steps: -5 }, { type: 'push' }]).ui.mode).toEqual({ kind: 'menu', cursor: 4 });
  });
});

describe('G5 power and backlight', () => {
  it('opens the backlight page with a press; the knob dims it and the button toggles Auto', () => {
    const r = run(initialUi('pfd'), [{ type: 'power' }, { type: 'turn', steps: -4 }]);
    expect(r.ui.mode.kind).toBe('backlight');
    expect(r.ui.backlight).toEqual({ auto: false, level: 60 });
    expect(r.commands).toEqual([]);
    expect(run(r.ui, [{ type: 'power' }]).ui.backlight.auto).toBe(true);
    expect(run(r.ui, [{ type: 'push' }]).ui.mode.kind).toBe('page');
  });

  it('turns off 5 s after a hold unless a control is touched, and boots again with a press', () => {
    const holding = run(initialUi('pfd'), [{ type: 'powerHold', now: 1000 }]).ui;
    expect(holding.mode).toEqual({ kind: 'powerOff', at: 1000 + POWER_OFF_MS });
    expect(run(holding, [{ type: 'turn', steps: 1, now: 2000 }]).ui.mode.kind).toBe('page');
    const off = run(holding, [{ type: 'timer', now: 1000 + POWER_OFF_MS }]).ui;
    expect(off.mode.kind).toBe('off');
    expect(run(off, [{ type: 'turn', steps: 3 }, { type: 'push' }]).commands).toEqual([]);
    const booting = run(off, [{ type: 'power', now: 10_000 }]).ui;
    expect(booting.mode.kind).toBe('boot');
    const aligning = run(booting, [{ type: 'timer', now: nextDeadline(booting)! }]).ui;
    expect(aligning.mode).toMatchObject({ kind: 'boot', phase: 'aligning' });
    expect(run(aligning, [{ type: 'timer', now: nextDeadline(aligning)! }]).ui.mode.kind).toBe('page');
  });
});

describe('G5 formats', () => {
  it('steps the selected altitude by hundreds, snapping odd values first', () => {
    expect(stepAltitude(3500, 1)).toBe(3600);
    expect(stepAltitude(3520, 1)).toBe(3600);
    expect(stepAltitude(3520, -1)).toBe(3500);
    expect(stepAltitude(3500, -3)).toBe(3200);
  });

  it('prints headings with three digits and north as 360', () => {
    expect(headingText(5)).toBe('005°');
    expect(headingText(0)).toBe('360°');
    expect(headingText(359.6)).toBe('360°');
  });

  it('knows the standard-rate bank: about 15 degrees at 100 kt TAS', () => {
    expect(standardRateBankDeg(100)).toBeGreaterThan(14.5);
    expect(standardRateBankDeg(100)).toBeLessThan(16);
  });
});
