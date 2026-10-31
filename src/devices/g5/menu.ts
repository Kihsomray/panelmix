import type { SimCommand } from '../../sim/commands';
import type { BearingSource, CdiSource } from '../../sim/types';
import { stepAltitude, wrapHeading } from './format';

/*
 * One G5's controls as a pure state machine: the selection knob, its menu,
 * the value pop-ups, the HSI setup list, the backlight page and the power
 * button. Every input returns the next screen state plus the simulator
 * commands it causes, so the rules can be tested without a browser.
 *
 * The knob's default function depends on the page (G5 Pilot's Guide,
 * Table 1-1): on the PFD page it sets the barometric setting, on the HSI
 * page the heading bug. Pushing it opens the menu along the bottom of the
 * screen; turning moves the cursor and pushing selects.
 */

export type G5Page = 'pfd' | 'hsi';

export type MenuItem = 'back' | 'heading' | 'altitude' | 'course' | 'obs' | 'hsi' | 'pfd' | 'esp' | 'gpss' | 'setup';

/** Values edited in a pop-up with the knob. */
export type EditTarget = 'heading' | 'altitude' | 'course' | 'obs';

export type SetupRow = 'back' | 'bearing1' | 'bearing2';
export const SETUP_ROWS: readonly SetupRow[] = ['back', 'bearing1', 'bearing2'];

export type G5Mode =
  | { readonly kind: 'page' }
  | { readonly kind: 'menu'; readonly cursor: number }
  | { readonly kind: 'edit'; readonly target: EditTarget }
  | { readonly kind: 'setup'; readonly cursor: number }
  | { readonly kind: 'pick'; readonly pointer: 1 | 2; readonly cursor: number }
  | { readonly kind: 'backlight' }
  /** Power button held: the unit turns off at `at` unless a control is touched. */
  | { readonly kind: 'powerOff'; readonly at: number }
  | { readonly kind: 'off' }
  /** Power-up: the Garmin splash, then attitude aligning. */
  | { readonly kind: 'boot'; readonly phase: 'splash' | 'aligning'; readonly until: number };

export interface G5Ui {
  readonly page: G5Page;
  readonly mode: G5Mode;
  readonly backlight: { readonly auto: boolean; readonly level: number };
  /** Time of the last control input, ms; menus close after a quiet spell. */
  readonly lastInput: number;
}

/**
 * Settings the two units share (the real pair cross-fills them over its
 * network): the GFC 500's Electronic Stability and Protection.
 */
export interface G5Shared {
  readonly esp: boolean;
}

export const INITIAL_SHARED: G5Shared = { esp: true };

/** What the reducer needs to know about the airplane and the panel, read when the input happens. */
export interface G5Context {
  readonly shared: G5Shared;
  /**
   * Autopilot installed: 'gfc500' adds ESP; a heading-only autopilot (the
   * KAP 140 through a GAD 29B, or the sim autopilot) adds GPSS.
   */
  readonly ap: string;
  /** GPS steering on (shared autopilot state). */
  readonly gpss: boolean;
  readonly cdiSources: readonly CdiSource[];
  readonly cdiSource: CdiSource;
  readonly obsMode: boolean;
  readonly headingBugMag: number;
  readonly altitudeBugFt: number;
  readonly baroInHg: number;
  /** Selected course shown by the CDI. */
  readonly courseMag: number;
  readonly headingMag: number;
  /** Altitude on the altimeter. */
  readonly altitudeFt: number;
  /** Bearing to the station or waypoint the CDI uses; syncing the course centers the needle TO. */
  readonly courseSyncMag: number | null;
  readonly bearing1: BearingSource;
  readonly bearing2: BearingSource;
}

export type G5Event =
  | { readonly type: 'turn'; readonly steps: number; readonly now: number }
  | { readonly type: 'push'; readonly now: number }
  | { readonly type: 'hold'; readonly now: number }
  | { readonly type: 'power'; readonly now: number }
  | { readonly type: 'powerHold'; readonly now: number }
  | { readonly type: 'timer'; readonly now: number };

export interface G5Result {
  readonly ui: G5Ui;
  readonly commands: readonly SimCommand[];
  /** A shared setting the input changed, for both units. */
  readonly shared?: G5Shared;
}

export const MENU_IDLE_MS = 15_000;
export const POWER_OFF_MS = 5_000;
const SPLASH_MS = 2_000;
const ALIGN_MS = 4_000;
const BACKLIGHT_STEP = 5;
const BARO_STEP_INHG = 0.01;

export function initialUi(page: G5Page): G5Ui {
  return { page, mode: { kind: 'page' }, backlight: { auto: true, level: 80 }, lastInput: 0 };
}

/** Menu tiles in the order the G5 shows them. Course appears only for VOR/LOC, OBS only in GPS OBS mode. */
export function menuItems(page: G5Page, ctx: Pick<G5Context, 'ap' | 'cdiSource' | 'obsMode'>): MenuItem[] {
  const items: MenuItem[] = ['back', 'heading', 'altitude'];
  if (page === 'hsi') {
    if (ctx.cdiSource !== 'GPS') items.push('course');
    else if (ctx.obsMode) items.push('obs');
    items.push('pfd');
  } else {
    items.push('hsi');
    if (ctx.ap === 'gfc500') items.push('esp');
  }
  if (ctx.ap === 'kap140' || ctx.ap === 'none') items.push('gpss');
  if (page === 'hsi') items.push('setup');
  return items;
}

const isEditTarget = (item: MenuItem): item is EditTarget =>
  item === 'heading' || item === 'altitude' || item === 'course' || item === 'obs';

const SYNC_LABELS: Record<EditTarget, string> = {
  heading: 'Sync heading',
  altitude: 'Sync altitude',
  course: 'Sync course',
  obs: 'Sync course',
};

/**
 * What press-and-hold does right now, for the touch knob dock, or null when
 * it does nothing (then the dock shows no hold button).
 */
export function holdLabel(ui: G5Ui, ctx: Pick<G5Context, 'ap' | 'cdiSource' | 'obsMode'>): string | null {
  const m = ui.mode;
  if (m.kind === 'page') return ui.page === 'hsi' ? SYNC_LABELS.heading : null;
  if (m.kind === 'edit') return SYNC_LABELS[m.target];
  if (m.kind === 'menu') {
    const items = menuItems(ui.page, ctx);
    const item = items[Math.min(Math.max(m.cursor, 0), items.length - 1)] ?? 'back';
    return isEditTarget(item) ? SYNC_LABELS[item] : null;
  }
  return null;
}

/** Bearing pointer choices: None, GPS and each VHF receiver the panel has. */
export function bearingOptions(sources: readonly CdiSource[]): BearingSource[] {
  return ['OFF', 'GPS', ...sources.filter((s): s is 'NAV1' | 'NAV2' => s !== 'GPS')];
}

/** "None", "GPS", "VLOC" (or "VLOC1"/"VLOC2" with two receivers). */
export function bearingLabel(source: BearingSource, sources: readonly CdiSource[]): string {
  if (source === 'OFF') return 'None';
  if (source === 'GPS') return 'GPS';
  const two = sources.includes('NAV2');
  return two ? `VLOC${source === 'NAV1' ? 1 : 2}` : 'VLOC';
}

const isMenuLike = (m: G5Mode) =>
  m.kind === 'menu' || m.kind === 'edit' || m.kind === 'setup' || m.kind === 'pick' || m.kind === 'backlight';

/** When the next timer event is due, or null when nothing is pending. */
export function nextDeadline(ui: G5Ui): number | null {
  const m = ui.mode;
  if (m.kind === 'powerOff') return m.at;
  if (m.kind === 'boot') return m.until;
  if (isMenuLike(m)) return ui.lastInput + MENU_IDLE_MS;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const done = (ui: G5Ui, commands: readonly SimCommand[] = []): G5Result => ({ ui, commands });

function editTurn(target: EditTarget, steps: number, ctx: G5Context): SimCommand {
  switch (target) {
    case 'heading':
      return { type: 'bug.heading', mag: wrapHeading(ctx.headingBugMag + steps) };
    case 'altitude':
      return { type: 'bug.altitude', ft: stepAltitude(ctx.altitudeBugFt, steps) };
    case 'course':
    case 'obs':
      return { type: 'course.set', mag: wrapHeading(ctx.courseMag + steps) };
  }
}

/** Press-and-hold: heading and altitude to the present values, course straight to the station. */
function sync(target: EditTarget, ctx: G5Context): SimCommand[] {
  switch (target) {
    case 'heading':
      return [{ type: 'bug.heading', mag: wrapHeading(ctx.headingMag) }];
    case 'altitude':
      return [{ type: 'bug.altitude', ft: Math.round(ctx.altitudeFt / 10) * 10 }];
    case 'course':
    case 'obs':
      return ctx.courseSyncMag === null ? [] : [{ type: 'course.set', mag: wrapHeading(ctx.courseSyncMag) }];
  }
}

export function reduce(ui: G5Ui, ev: G5Event, ctx: G5Context): G5Result {
  const m = ui.mode;

  // Off and starting up: only the power button and the clock matter.
  if (m.kind === 'off') {
    if (ev.type === 'power' || ev.type === 'powerHold') {
      return done({ ...ui, mode: { kind: 'boot', phase: 'splash', until: ev.now + SPLASH_MS } });
    }
    return done(ui);
  }
  if (m.kind === 'boot') {
    if (ev.type !== 'timer' || ev.now < m.until) return done(ui);
    if (m.phase === 'splash') return done({ ...ui, mode: { kind: 'boot', phase: 'aligning', until: ev.now + ALIGN_MS } });
    return done({ ...ui, mode: { kind: 'page' } });
  }
  if (m.kind === 'powerOff') {
    if (ev.type === 'timer') return done(ev.now >= m.at ? { ...ui, mode: { kind: 'off' } } : ui);
    if (ev.type === 'powerHold') return done(ui);
    // Any other control cancels the shutdown.
    return done({ ...ui, mode: { kind: 'page' }, lastInput: ev.now });
  }

  if (ev.type === 'timer') {
    return done(isMenuLike(m) && ev.now - ui.lastInput >= MENU_IDLE_MS ? { ...ui, mode: { kind: 'page' } } : ui);
  }

  const touched: G5Ui = { ...ui, lastInput: ev.now };
  if (ev.type === 'powerHold') return done({ ...touched, mode: { kind: 'powerOff', at: ev.now + POWER_OFF_MS } });
  if (ev.type === 'power') {
    if (m.kind === 'backlight') return done({ ...touched, backlight: { ...ui.backlight, auto: !ui.backlight.auto } });
    return done({ ...touched, mode: { kind: 'backlight' } });
  }

  const items = menuItems(ui.page, ctx);

  switch (m.kind) {
    case 'page':
      if (ev.type === 'turn') {
        if (ui.page === 'pfd') {
          return done(touched, [{ type: 'baro.set', inHg: Math.round((ctx.baroInHg + ev.steps * BARO_STEP_INHG) * 100) / 100 }]);
        }
        return done(touched, [{ type: 'bug.heading', mag: wrapHeading(ctx.headingBugMag + ev.steps) }]);
      }
      if (ev.type === 'push') return done({ ...touched, mode: { kind: 'menu', cursor: 0 } });
      // Hold on the HSI page syncs the heading bug; on the PFD page it does nothing.
      return done(touched, ui.page === 'hsi' ? sync('heading', ctx) : []);

    case 'menu': {
      const cursor = clamp(m.cursor, 0, items.length - 1);
      const item = items[cursor] ?? 'back';
      if (ev.type === 'turn') return done({ ...touched, mode: { kind: 'menu', cursor: clamp(cursor + ev.steps, 0, items.length - 1) } });
      if (ev.type === 'hold') return done(touched, isEditTarget(item) ? sync(item, ctx) : []);
      switch (item) {
        case 'back':
          return done({ ...touched, mode: { kind: 'page' } });
        case 'heading':
        case 'altitude':
        case 'course':
        case 'obs':
          return done({ ...touched, mode: { kind: 'edit', target: item } });
        case 'hsi':
        case 'pfd':
          return done({ ...touched, page: item, mode: { kind: 'page' } });
        case 'esp':
          return { ui: touched, commands: [], shared: { ...ctx.shared, esp: !ctx.shared.esp } };
        case 'gpss':
          return done(touched, [{ type: 'ap.gpss', on: !ctx.gpss }]);
        case 'setup':
          return done({ ...touched, mode: { kind: 'setup', cursor: 0 } });
      }
    }

    case 'edit':
      // The tile can vanish under the pop-up (the CDI switched away from VOR): close it.
      if ((m.target === 'course' || m.target === 'obs') && !items.includes(m.target)) {
        return done({ ...touched, mode: { kind: 'page' } });
      }
      if (ev.type === 'turn') return done(touched, [editTurn(m.target, ev.steps, ctx)]);
      if (ev.type === 'hold') return done(touched, sync(m.target, ctx));
      return done({ ...touched, mode: { kind: 'page' } });

    case 'setup': {
      const cursor = clamp(m.cursor, 0, SETUP_ROWS.length - 1);
      if (ev.type === 'turn') return done({ ...touched, mode: { kind: 'setup', cursor: clamp(cursor + ev.steps, 0, SETUP_ROWS.length - 1) } });
      const row = SETUP_ROWS[cursor];
      if (row === 'back' || row === undefined) {
        return done({ ...touched, mode: { kind: 'menu', cursor: Math.max(items.indexOf('setup'), 0) } });
      }
      const pointer = row === 'bearing1' ? 1 : 2;
      const current = pointer === 1 ? ctx.bearing1 : ctx.bearing2;
      const options = bearingOptions(ctx.cdiSources);
      return done({ ...touched, mode: { kind: 'pick', pointer, cursor: Math.max(options.indexOf(current), 0) } });
    }

    case 'pick': {
      const options = bearingOptions(ctx.cdiSources);
      const cursor = clamp(m.cursor, 0, options.length - 1);
      if (ev.type === 'turn') {
        return done({ ...touched, mode: { ...m, cursor: clamp(cursor + ev.steps, 0, options.length - 1) } });
      }
      const source = options[cursor] ?? 'OFF';
      return done({ ...touched, mode: { kind: 'setup', cursor: m.pointer } }, [{ type: 'bearing.set', pointer: m.pointer, source }]);
    }

    case 'backlight':
      if (ev.type === 'turn') {
        return done({ ...touched, backlight: { auto: false, level: clamp(ui.backlight.level + ev.steps * BACKLIGHT_STEP, 5, 100) } });
      }
      return done({ ...touched, mode: { kind: 'page' } });
  }
}
