import type { SimCommand } from '../../sim/commands';
import type { BearingSource, CdiSource } from '../../sim/types';
import { editRow, MENU_PAGES, menuRows } from './menuPages';
import { autoRangeFor, DEFAULT_RANGE_NM, DEFAULT_SETTINGS, INHG_PER_MB, RANGES_NM, stepRange, type AspenSettings } from './settings';

/*
 * Every control on the Aspen bezel as a pure state machine (Pilot's Guide
 * chapter 2). Inputs return the next screen state and the simulator
 * commands they cause.
 *
 * Knobs: each has a home function (left CRS, right HDG) shown in cyan. The
 * first click or press "wakes" it (magenta) without changing anything;
 * further presses cycle its functions (left CRS / IAS, right HDG / ALT /
 * MIN), turning sets the value, press-and-hold syncs it, and 10 seconds
 * without input sends both knobs home. BARO is reached with its hot key.
 */

export type LeftFn = 'CRS' | 'IAS';
export type RightFn = 'HDG' | 'ALT' | 'MIN' | 'BARO';

export interface KnobState<F extends string> {
  readonly fn: F;
  /** Magenta: turning changes the value. */
  readonly active: boolean;
}

export type PowerState =
  | { readonly kind: 'on' }
  /** REV held or SHUT DOWN selected: off at `at` unless a control is touched. */
  | { readonly kind: 'shutdown'; readonly at: number }
  | { readonly kind: 'off' }
  | { readonly kind: 'boot'; readonly phase: 'splash' | 'init'; readonly until: number };

export interface AspenMenu {
  readonly page: number;
  /** Row being edited (EDIT VALUE), or null while choosing pages (SEL PAGE). */
  readonly editing: number | null;
}

export interface AspenUi {
  readonly left: KnobState<LeftFn>;
  readonly right: KnobState<RightFn>;
  readonly lastInput: number;
  readonly compass: '360' | 'ARC';
  readonly hotkeyPage: 1 | 2;
  readonly menu: AspenMenu | null;
  readonly brightness: { readonly auto: boolean; readonly level: number };
  readonly rangeNm: number;
  readonly autoRangeOn: boolean;
  /** CRS set by hand on a GPS source with Auto Course off. */
  readonly gpsCrsMag: number;
  /** Minimums to restore when the MIN hot key shows them again. */
  readonly lastMinimumsFt: number | null;
  readonly settings: AspenSettings;
  readonly power: PowerState;
  readonly onBattery: boolean;
  /** AHRS reset from the menu: attitude realigning until then. */
  readonly ahrsUntil: number | null;
  /** A short note on screen after a REV press. */
  readonly hintUntil: number | null;
}

export interface AspenContext {
  readonly cdiSources: readonly CdiSource[];
  readonly cdiSource: CdiSource;
  readonly obsMode: boolean;
  /** The GPS has an active leg (flight plan or direct-to). */
  readonly gpsActive: boolean;
  /** GPS steering on (shared autopilot state): the autopilot in HDG follows the GPS course. */
  readonly gpss: boolean;
  readonly activeWaypointNm: number | null;
  /** The course the CDI uses: VOR OBS, GPS desired track or GPS OBS course. */
  readonly courseMag: number;
  /** Bearing to the station or waypoint, for syncing CRS straight to it. */
  readonly courseSyncMag: number | null;
  readonly headingBugMag: number;
  readonly altitudeBugFt: number;
  readonly airspeedBugKt: number;
  readonly baroInHg: number;
  readonly minimumsFt: number | null;
  readonly headingMag: number;
  readonly altitudeFt: number;
  readonly iasKt: number;
  readonly bearing1: BearingSource;
  readonly bearing2: BearingSource;
  readonly volts: number;
}

type Simple = 'leftPush' | 'rightPush' | 'leftHold' | 'rightHold' | 'menu' | 'rev' | 'revHold' | 'timer';

export type AspenEvent =
  | { readonly type: 'leftTurn' | 'rightTurn'; readonly steps: number; readonly now: number }
  | { readonly type: Simple; readonly now: number }
  | { readonly type: 'hotkey'; readonly index: number; readonly now: number }
  | { readonly type: 'range' | 'rangeHold'; readonly dir: 1 | -1; readonly now: number }
  | { readonly type: 'navButton'; readonly button: 'left' | 'center' | 'right'; readonly now: number };

export interface AspenResult {
  readonly ui: AspenUi;
  readonly commands: readonly SimCommand[];
}

export const KNOB_IDLE_MS = 10_000;
export const SHUTDOWN_MS = 5_000;
const SPLASH_MS = 2_000;
const INIT_MS = 3_000;
const AHRS_RESET_MS = 5_000;
const HINT_MS = 2_500;

const HOME_LEFT: KnobState<LeftFn> = { fn: 'CRS', active: false };
const HOME_RIGHT: KnobState<RightFn> = { fn: 'HDG', active: false };

export function initialAspenUi(): AspenUi {
  return {
    left: HOME_LEFT,
    right: HOME_RIGHT,
    lastInput: 0,
    compass: '360',
    hotkeyPage: 1,
    menu: null,
    brightness: { auto: true, level: 70 },
    rangeNm: DEFAULT_RANGE_NM,
    autoRangeOn: false,
    gpsCrsMag: 360,
    lastMinimumsFt: null,
    settings: DEFAULT_SETTINGS,
    power: { kind: 'on' },
    onBattery: false,
    ahrsUntil: null,
    hintUntil: null,
  };
}

/** Auto Course Select is in charge: GPS source, enabled, sequencing (not OBS), with an active leg. */
export function autoCourse(ui: AspenUi, ctx: Pick<AspenContext, 'cdiSource' | 'obsMode' | 'gpsActive'>): boolean {
  return ui.settings.autoCrs && ctx.cdiSource === 'GPS' && !ctx.obsMode && ctx.gpsActive;
}

/** The CRS value on the display. */
export function selectedCourse(ui: AspenUi, ctx: Pick<AspenContext, 'cdiSource' | 'obsMode' | 'gpsActive' | 'courseMag'>): number {
  const manualGps = ctx.cdiSource === 'GPS' && !ctx.obsMode && !autoCourse(ui, ctx);
  return manualGps ? ui.gpsCrsMag : ctx.courseMag;
}

/** Hot key legends, top to bottom, for the current hot key page. */
export function hotkeyLegends(ui: AspenUi): readonly string[] {
  return ui.hotkeyPage === 1 ? ['1/2', 'MIN', ui.compass === '360' ? '360' : 'ARC', 'GPSS', 'BARO'] : ['2/2', 'LTNG', 'NXRD', 'TRFC', 'BARO'];
}

/** Bearing pointer choices in the order the buttons cycle them: none, then each available source. */
export function bearingCycle(sources: readonly CdiSource[]): BearingSource[] {
  return ['OFF', 'GPS', ...sources.filter((s): s is 'NAV1' | 'NAV2' => s !== 'GPS')];
}

/**
 * What holding each knob does right now (SYNC), for the touch knob dock;
 * null where a hold does nothing, so the dock offers no hold button.
 */
export function holdLabels(
  ui: AspenUi,
  ctx: Pick<AspenContext, 'cdiSource' | 'obsMode' | 'gpsActive' | 'courseSyncMag'>,
): { readonly left: string | null; readonly right: string | null } {
  if (ui.menu || ui.power.kind !== 'on') return { left: null, right: null };
  const left =
    ui.left.fn === 'IAS' ? 'Sync airspeed' : autoCourse(ui, ctx) || ctx.courseSyncMag === null ? null : 'Sync course';
  const right = { HDG: 'Sync heading', ALT: 'Sync altitude', MIN: 'Sync minimums', BARO: 'Set 29.92' }[ui.right.fn];
  return { left, right };
}

/** A knob is awake or away from its home function (the 10 s timeout brings it back). */
const knobsAway = (ui: AspenUi) => ui.left.active || ui.left.fn !== 'CRS' || ui.right.active || ui.right.fn !== 'HDG';

export function nextDeadline(ui: AspenUi): number | null {
  const p = ui.power;
  if (p.kind === 'shutdown') return p.at;
  if (p.kind === 'boot') return p.until;
  if (p.kind === 'off') return null;
  const times: number[] = [];
  if (knobsAway(ui) && !ui.menu) times.push(ui.lastInput + KNOB_IDLE_MS);
  if (ui.ahrsUntil !== null) times.push(ui.ahrsUntil);
  if (ui.hintUntil !== null) times.push(ui.hintUntil);
  return times.length ? Math.min(...times) : null;
}

const wrap = (deg: number) => {
  const d = Math.round(((deg % 360) + 360) % 360);
  return d === 0 ? 360 : d;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round10 = (ft: number) => Math.round(ft / 10) * 10;
const done = (ui: AspenUi, commands: readonly SimCommand[] = []): AspenResult => ({ ui, commands });

function stepAltitude(ft: number, steps: number): number {
  const base = steps > 0 ? Math.floor(ft / 100) * 100 : Math.ceil(ft / 100) * 100;
  return clamp(base + steps * 100, 100, 51_000);
}

function stepBaro(ui: AspenUi, inHg: number, steps: number): number {
  if (ui.settings.baroUnits === 'IN') return Math.round((inHg + steps * 0.01) * 100) / 100;
  return (Math.round(inHg / INHG_PER_MB) + steps) * INHG_PER_MB;
}

// Knobs ---------------------------------------------------------------------------

function leftTurn(ui: AspenUi, steps: number, ctx: AspenContext): AspenResult {
  const auto = autoCourse(ui, ctx);
  if (!ui.left.active) {
    // A green (auto) CRS ignores the knob; otherwise the first click only wakes it.
    if (ui.left.fn === 'CRS' && auto) return done(ui);
    return done({ ...ui, left: { ...ui.left, active: true } });
  }
  if (ui.left.fn === 'IAS') return done(ui, [{ type: 'bug.airspeed', kt: ctx.airspeedBugKt + steps }]);
  if (auto) return done(ui);
  if (ctx.cdiSource === 'GPS' && !ctx.obsMode) return done({ ...ui, gpsCrsMag: wrap(ui.gpsCrsMag + steps) });
  return done(ui, [{ type: 'course.set', mag: wrap(ctx.courseMag + steps) }]);
}

function leftPush(ui: AspenUi, ctx: AspenContext): AspenResult {
  const auto = autoCourse(ui, ctx);
  if (!ui.left.active) return done({ ...ui, left: { fn: auto ? 'IAS' : 'CRS', active: true } });
  if (ui.left.fn === 'CRS') return done({ ...ui, left: { fn: 'IAS', active: true } });
  // From IAS back to CRS; with Auto Course there is nothing to set there, so the knob goes home.
  return done({ ...ui, left: auto ? HOME_LEFT : { fn: 'CRS', active: true } });
}

function leftHold(ui: AspenUi, ctx: AspenContext): AspenResult {
  const fn = ui.left.fn;
  const active = { ...ui, left: { fn, active: true } };
  if (fn === 'IAS') return done(active, [{ type: 'bug.airspeed', kt: Math.round(ctx.iasKt) }]);
  if (autoCourse(ui, ctx) || ctx.courseSyncMag === null) return done(ui);
  // Course straight to the station or waypoint: the deviation centers with a TO indication.
  if (ctx.cdiSource === 'GPS' && !ctx.obsMode) return done({ ...active, gpsCrsMag: wrap(ctx.courseSyncMag) });
  return done(active, [{ type: 'course.set', mag: wrap(ctx.courseSyncMag) }]);
}

function rightTurn(ui: AspenUi, steps: number, ctx: AspenContext): AspenResult {
  if (!ui.right.active) return done({ ...ui, right: { ...ui.right, active: true } });
  switch (ui.right.fn) {
    case 'HDG':
      return done(ui, [{ type: 'bug.heading', mag: wrap(ctx.headingBugMag + steps) }]);
    case 'ALT':
      return done(ui, [{ type: 'bug.altitude', ft: stepAltitude(ctx.altitudeBugFt, steps) }]);
    case 'MIN':
      return done(ui, [{ type: 'minimums.set', ft: clamp((ctx.minimumsFt ?? round10(ctx.altitudeFt)) + steps * 10, 0, 20_000) }]);
    case 'BARO':
      return done(ui, [{ type: 'baro.set', inHg: stepBaro(ui, ctx.baroInHg, steps) }]);
  }
}

function rightPush(ui: AspenUi, ctx: AspenContext): AspenResult {
  if (!ui.right.active) return done({ ...ui, right: { fn: ui.right.fn, active: true } });
  switch (ui.right.fn) {
    case 'HDG':
      return done({ ...ui, right: { fn: 'ALT', active: true } });
    case 'ALT':
      return done({ ...ui, right: ctx.minimumsFt !== null ? { fn: 'MIN', active: true } : { fn: 'HDG', active: true } });
    case 'MIN':
      return done({ ...ui, right: { fn: 'HDG', active: true } });
    case 'BARO':
      return done({ ...ui, right: HOME_RIGHT });
  }
}

function rightHold(ui: AspenUi, ctx: AspenContext): AspenResult {
  const fn = ui.right.fn;
  const active = { ...ui, right: { fn, active: true } };
  switch (fn) {
    case 'HDG':
      return done(active, [{ type: 'bug.heading', mag: wrap(ctx.headingMag) }]);
    case 'ALT':
      return done(active, [{ type: 'bug.altitude', ft: round10(ctx.altitudeFt) }]);
    case 'MIN':
      return done(active, [{ type: 'minimums.set', ft: round10(ctx.altitudeFt) }]);
    case 'BARO':
      return done(active, [{ type: 'baro.set', inHg: 29.92 }]);
  }
}

// Hot keys, menu and buttons ------------------------------------------------------------

function hotkey(ui: AspenUi, index: number, ctx: AspenContext): AspenResult {
  if (index === 0) return done({ ...ui, hotkeyPage: ui.hotkeyPage === 1 ? 2 : 1 });
  if (index === 4) {
    return done({ ...ui, right: ui.right.fn === 'BARO' ? HOME_RIGHT : { fn: 'BARO', active: true } });
  }
  // Page 2 holds the hazard overlays (lightning, NEXRAD, traffic): no sensors in this installation.
  if (ui.hotkeyPage === 2) return done(ui);
  if (index === 1) {
    if (ctx.minimumsFt !== null) {
      const right = ui.right.fn === 'MIN' ? HOME_RIGHT : ui.right;
      return done({ ...ui, right, lastMinimumsFt: ctx.minimumsFt }, [{ type: 'minimums.set', ft: null }]);
    }
    // Showing the minimums makes them ready to edit straight away.
    const ft = ui.lastMinimumsFt ?? Math.max(Math.round((ctx.altitudeFt - 1000) / 100) * 100, 100);
    return done({ ...ui, right: { fn: 'MIN', active: true } }, [{ type: 'minimums.set', ft }]);
  }
  if (index === 2) return done({ ...ui, compass: ui.compass === '360' ? 'ARC' : '360' });
  // GPSS needs a GPS steering signal (an active leg) to come on; it can always be switched off.
  return ctx.gpsActive || ctx.gpss ? done(ui, [{ type: 'ap.gpss', on: !ctx.gpss }]) : done(ui);
}

function menuKey(ui: AspenUi, menu: AspenMenu, index: number, ctx: AspenContext, now: number): AspenResult {
  const row = menuRows(menu.page, ui.settings, { volts: ctx.volts, onBattery: ui.onBattery })[index];
  if (!row || row.kind === 'status' || row.kind === 'disabled') return done({ ...ui, menu: { ...menu, editing: null } });
  if (row.kind === 'edit') return done({ ...ui, menu: { ...menu, editing: index } });
  switch (row.id) {
    case 'ahrs':
      return done({ ...ui, ahrsUntil: now + AHRS_RESET_MS });
    case 'battery':
      return done({ ...ui, onBattery: true });
    case 'external':
      return done({ ...ui, onBattery: false });
    case 'shutdown':
      return done({ ...ui, menu: null, power: { kind: 'shutdown', at: now + SHUTDOWN_MS } });
    default:
      return done(ui);
  }
}

function menuTurn(ui: AspenUi, menu: AspenMenu, steps: number, ctx: AspenContext): AspenResult {
  if (menu.editing === null) {
    return done({ ...ui, menu: { page: clamp(menu.page + steps, 0, MENU_PAGES.length - 1), editing: null } });
  }
  const row = menuRows(menu.page, ui.settings, { volts: ctx.volts, onBattery: ui.onBattery })[menu.editing];
  if (!row) return done(ui);
  const settings = editRow(ui.settings, row.id, steps);
  // Turning Auto Course off leaves the CRS where the GPS had it, so the pointer doesn't jump.
  const gpsCrsMag = ui.settings.autoCrs && !settings.autoCrs ? wrap(ctx.courseMag) : ui.gpsCrsMag;
  return done({ ...ui, settings, gpsCrsMag });
}

function navButton(ui: AspenUi, button: 'left' | 'center' | 'right', ctx: AspenContext): AspenResult {
  if (button === 'center') return done(ui, [{ type: 'cdi.cycle', sources: ctx.cdiSources }]);
  const pointer = button === 'left' ? 1 : 2;
  const cycle = bearingCycle(ctx.cdiSources);
  const current = pointer === 1 ? ctx.bearing1 : ctx.bearing2;
  const source = cycle[(cycle.indexOf(current) + 1) % cycle.length]!;
  return done(ui, [{ type: 'bearing.set', pointer, source }]);
}

function range(ui: AspenUi, dir: 1 | -1, hold: boolean, ctx: AspenContext): AspenResult {
  if (ui.autoRangeOn) {
    // Any RNG press leaves Auto Range at the range it had chosen.
    return done({ ...ui, autoRangeOn: false, rangeNm: autoRangeFor(ctx.activeWaypointNm, ui.rangeNm) });
  }
  if (!hold) return done({ ...ui, rangeNm: stepRange(ui.rangeNm, dir) });
  const end = dir > 0 ? RANGES_NM[RANGES_NM.length - 1]! : RANGES_NM[0]!;
  // Holding scales all the way; holding again at the end starts Auto Range (when enabled in the menu).
  if (ui.rangeNm === end && ui.settings.autoRange) return done({ ...ui, autoRangeOn: true });
  return done({ ...ui, rangeNm: end });
}

function timer(ui: AspenUi, now: number): AspenResult {
  const p = ui.power;
  if (p.kind === 'shutdown') return done(now >= p.at ? poweredOff(ui) : ui);
  if (p.kind === 'boot') {
    if (now < p.until) return done(ui);
    if (p.phase === 'splash') return done({ ...ui, power: { kind: 'boot', phase: 'init', until: now + INIT_MS } });
    return done({ ...ui, power: { kind: 'on' } });
  }
  let next = ui;
  if (!ui.menu && now - ui.lastInput >= KNOB_IDLE_MS && knobsAway(ui)) {
    next = { ...next, left: HOME_LEFT, right: HOME_RIGHT };
  }
  if (ui.ahrsUntil !== null && now >= ui.ahrsUntil) next = { ...next, ahrsUntil: null };
  if (ui.hintUntil !== null && now >= ui.hintUntil) next = { ...next, hintUntil: null };
  return done(next);
}

/** Powering down clears the screen state; settings survive like the real unit's memory. */
function poweredOff(ui: AspenUi): AspenUi {
  return { ...ui, power: { kind: 'off' }, menu: null, left: HOME_LEFT, right: HOME_RIGHT, ahrsUntil: null, hintUntil: null };
}

export function reduce(ui: AspenUi, ev: AspenEvent, ctx: AspenContext): AspenResult {
  if (ev.type === 'timer') return timer(ui, ev.now);
  const p = ui.power;
  if (p.kind === 'off') {
    return done(ev.type === 'revHold' ? { ...ui, power: { kind: 'boot', phase: 'splash', until: ev.now + SPLASH_MS } } : ui);
  }
  if (p.kind === 'boot') return done(ui);
  if (p.kind === 'shutdown') {
    // Any control aborts the power-down, and does nothing else.
    return done(ev.type === 'revHold' ? ui : { ...ui, power: { kind: 'on' }, lastInput: ev.now });
  }

  const touched: AspenUi = { ...ui, lastInput: ev.now };
  const menu = ui.menu;
  switch (ev.type) {
    case 'revHold':
      return done({ ...touched, menu: null, power: { kind: 'shutdown', at: ev.now + SHUTDOWN_MS } });
    case 'rev':
      // A single PFD has no display to revert to; the trainer says how to power down instead.
      return done({ ...touched, hintUntil: ev.now + HINT_MS });
    case 'menu':
      return done({ ...touched, menu: menu ? null : { page: 0, editing: null }, left: HOME_LEFT, right: HOME_RIGHT });
    case 'navButton':
      return navButton(touched, ev.button, ctx);
    case 'range':
    case 'rangeHold':
      return range(touched, ev.dir, ev.type === 'rangeHold', ctx);
    case 'hotkey':
      return menu ? menuKey(touched, menu, ev.index, ctx, ev.now) : hotkey(touched, ev.index, ctx);
    case 'leftTurn':
      if (menu) {
        if (ui.brightness.auto) return done(touched);
        return done({ ...touched, brightness: { auto: false, level: clamp(ui.brightness.level + ev.steps * 2, 1, 100) } });
      }
      return leftTurn(touched, ev.steps, ctx);
    case 'leftPush':
      if (menu) return done({ ...touched, brightness: { ...ui.brightness, auto: !ui.brightness.auto } });
      return leftPush(touched, ctx);
    case 'leftHold':
      return menu ? done(touched) : leftHold(touched, ctx);
    case 'rightTurn':
      return menu ? menuTurn(touched, menu, ev.steps, ctx) : rightTurn(touched, ev.steps, ctx);
    case 'rightPush':
      if (menu) return done({ ...touched, menu: { ...menu, editing: null } });
      return rightPush(touched, ctx);
    case 'rightHold':
      return menu ? done(touched) : rightHold(touched, ctx);
  }
}
