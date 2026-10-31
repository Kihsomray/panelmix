import type { SimCommand } from '../../sim/commands';
import type { TransponderMode } from '../../sim/types';
import {
  clearAll,
  clearDigit,
  completeEntry,
  identActive,
  pressVfr,
  replyFlash,
  shownCode,
  specialCodeText,
  typeDigit,
  type SquawkEntry,
} from './squawk';

/*
 * GTX 345 front-panel logic (software v2.90 menu structure), as pure
 * functions: a key press or a clock tick goes in, the new local state and
 * any sim commands come out. The component only renders `gtxScreen`.
 *
 * Two clocks: `simTime` drives anything the airplane experiences (timers,
 * reply light), `realTime` drives screen transients (start-up screen, the
 * group name after FUNC) so they stay readable at any sim rate.
 */

export type GtxGroup = 'XPDR' | 'TMR' | 'ALT' | 'SYS';

export type GtxPage =
  | 'FLIGHT_ID'
  | 'ADSB_TX'
  | 'UP_COUNTER'
  | 'DOWN_COUNTER'
  | 'FLIGHT_TIMER'
  | 'TRIP_TIMER'
  | 'PRESSURE_ALT'
  | 'ALT_MONITOR'
  | 'SAT_DALT'
  | 'BACKLIGHT'
  | 'CONTRAST'
  | 'MESSAGES'
  | 'BLUETOOTH'
  | 'GPS_STATUS';

/** FUNC cycles the groups in this order. */
const GROUPS: readonly GtxGroup[] = ['XPDR', 'TMR', 'ALT', 'SYS'];

/** Pages of each group, in 8 (up) / 9 (down) order. */
export const GROUP_PAGES: Readonly<Record<GtxGroup, readonly GtxPage[]>> = {
  XPDR: ['FLIGHT_ID', 'ADSB_TX'],
  TMR: ['UP_COUNTER', 'DOWN_COUNTER', 'FLIGHT_TIMER', 'TRIP_TIMER'],
  ALT: ['PRESSURE_ALT', 'ALT_MONITOR', 'SAT_DALT'],
  SYS: ['BACKLIGHT', 'CONTRAST', 'MESSAGES', 'BLUETOOTH', 'GPS_STATUS'],
};

export type GtxKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'CLR'
  | 'CLR_HOLD'
  | 'CRSR'
  | 'ENT'
  | 'FUNC'
  | 'VFR'
  | 'IDNT'
  | 'ON'
  | 'ALT'
  | 'SBY'
  | 'OFF';

/** Field the cursor (CRSR) is editing. */
export type GtxCursor = 'DOWN_SET' | 'ALT_MON' | 'BACKLIGHT' | 'CONTRAST';

export interface Stopwatch {
  readonly running: boolean;
  /** Seconds counted before the current run. */
  readonly accumulated: number;
  /** Sim time the current run started. */
  readonly startedAt: number;
}

export interface AltitudeMonitor {
  readonly on: boolean;
  readonly refFt: number;
  /** Deviation beyond the limit was detected and not yet recovered. */
  readonly alerting: boolean;
  /** The deviation flashes until CLR or recovery. */
  readonly flashing: boolean;
  /** Real time the "LEAVING ALTITUDE" banner ends. */
  readonly bannerUntil: number;
}

export interface GtxState {
  /** Real time the start-up screen ends. */
  readonly bootUntil: number;
  readonly entry: SquawkEntry | null;
  readonly vfrPrevious: string | null;
  readonly group: GtxGroup;
  /** The page last shown in each group; the unit returns to it. */
  readonly pageIn: Readonly<Record<GtxGroup, number>>;
  /** Real time the group name stops showing after FUNC. */
  readonly groupNameUntil: number;
  readonly cursor: GtxCursor | null;
  /** Count-down time being typed, HHMMSS digits. */
  readonly downDigits: string;
  readonly up: Stopwatch;
  readonly down: { readonly preset: number; readonly sw: Stopwatch };
  readonly flight: Stopwatch;
  readonly trip: Stopwatch;
  readonly airborne: boolean;
  readonly altMon: AltitudeMonitor;
  readonly backlightOffset: number;
  readonly contrastOffset: number;
}

/** What the unit reads from the simulator. */
export interface GtxView {
  readonly simTime: number;
  readonly realTime: number;
  readonly code: string;
  readonly mode: TransponderMode;
  readonly identUntil: number | null;
  readonly pressureAltFt: number;
  readonly densityAltFt: number;
  readonly oatC: number;
  readonly verticalSpeedFpm: number;
  readonly airborne: boolean;
}

export interface GtxResult {
  readonly state: GtxState;
  readonly commands: readonly SimCommand[];
}

/** The trainer airplane's ADS-B flight ID (registration). */
const FLIGHT_ID = 'N172SP';
export const BOOT_SECONDS = 2.5;
const GROUP_NAME_SECONDS = 2;
/** Default altitude monitor deviation limit (installer configurable, 200 to 999 ft). */
const ALT_MONITOR_LIMIT_FT = 250;
const BANNER_SECONDS = 2;
const BACKLIGHT_LEVEL = 50;
const CONTRAST_LEVEL = 65;
const OFFSET_LIMIT = 50;

const stopped: Stopwatch = { running: false, accumulated: 0, startedAt: 0 };

function elapsed(sw: Stopwatch, simTime: number): number {
  return sw.accumulated + (sw.running ? Math.max(simTime - sw.startedAt, 0) : 0);
}

function toggleWatch(sw: Stopwatch, simTime: number): Stopwatch {
  return sw.running
    ? { running: false, accumulated: elapsed(sw, simTime), startedAt: simTime }
    : { running: true, accumulated: sw.accumulated, startedAt: simTime };
}

function resetWatch(sw: Stopwatch, simTime: number): Stopwatch {
  return { running: sw.running, accumulated: 0, startedAt: simTime };
}

export function initialGtx(): GtxState {
  return {
    bootUntil: 0,
    entry: null,
    vfrPrevious: null,
    // The trainer's unit is configured to restore pages at power-up, with PRESSURE ALT selected.
    group: 'ALT',
    pageIn: { XPDR: 0, TMR: 0, ALT: 0, SYS: 0 },
    groupNameUntil: 0,
    cursor: null,
    downDigits: '',
    up: stopped,
    down: { preset: 0, sw: stopped },
    flight: stopped,
    trip: stopped,
    airborne: false,
    altMon: { on: false, refFt: 0, alerting: false, flashing: false, bannerUntil: 0 },
    backlightOffset: 0,
    contrastOffset: 0,
  };
}

export function currentPage(s: GtxState): GtxPage {
  const pages = GROUP_PAGES[s.group];
  return pages[Math.min(Math.max(s.pageIn[s.group], 0), pages.length - 1)]!;
}

function showPage(s: GtxState, group: GtxGroup, page: GtxPage): GtxState {
  return { ...s, group, pageIn: { ...s.pageIn, [group]: GROUP_PAGES[group].indexOf(page) } };
}

const isPowered = (mode: TransponderMode) => mode !== 'OFF';
const done = (state: GtxState, commands: readonly SimCommand[] = []): GtxResult => ({ state, commands });

/** "HHMMSS" digits to seconds; minutes and seconds above 59 are limited to 59. */
export function digitsToSeconds(digits: string): number {
  const d = digits.padEnd(6, '0');
  const h = Number(d.slice(0, 2));
  const m = Math.min(Number(d.slice(2, 4)), 59);
  const s = Math.min(Number(d.slice(4, 6)), 59);
  return h * 3600 + m * 60 + s;
}

function applyDownDigits(s: GtxState, simTime: number): GtxState {
  if (s.downDigits.length === 0) return { ...s, cursor: null };
  const preset = digitsToSeconds(s.downDigits);
  return { ...s, cursor: null, downDigits: '', down: { preset, sw: { running: false, accumulated: 0, startedAt: simTime } } };
}

/** CRSR on a page with an editable field puts the cursor on it. */
function cursorFor(page: GtxPage): GtxCursor | null {
  switch (page) {
    case 'DOWN_COUNTER':
      return 'DOWN_SET';
    case 'ALT_MONITOR':
      return 'ALT_MON';
    case 'BACKLIGHT':
      return 'BACKLIGHT';
    case 'CONTRAST':
      return 'CONTRAST';
    default:
      return null;
  }
}

function adjustOffset(s: GtxState, delta: number): GtxState {
  const clamp = (v: number) => Math.min(Math.max(v, -OFFSET_LIMIT), OFFSET_LIMIT);
  if (s.cursor === 'BACKLIGHT') return { ...s, backlightOffset: clamp(s.backlightOffset + delta) };
  if (s.cursor === 'CONTRAST') return { ...s, contrastOffset: clamp(s.contrastOffset + delta) };
  return s;
}

/** ENT and CLR on the timer pages: start/stop and reset. */
function timerKey(s: GtxState, key: 'ENT' | 'CLR', simTime: number): GtxState {
  const page = currentPage(s);
  const act = key === 'ENT' ? toggleWatch : resetWatch;
  switch (page) {
    case 'UP_COUNTER':
      return { ...s, up: act(s.up, simTime) };
    case 'FLIGHT_TIMER':
      return { ...s, flight: act(s.flight, simTime) };
    case 'TRIP_TIMER':
      return { ...s, trip: act(s.trip, simTime) };
    case 'DOWN_COUNTER':
      return key === 'ENT'
        ? { ...s, down: { ...s.down, sw: toggleWatch(s.down.sw, simTime) } }
        : { ...s, down: { ...s.down, sw: { running: false, accumulated: 0, startedAt: simTime } } };
    case 'ALT_MONITOR':
      // CLR silences the flashing deviation alert.
      return key === 'CLR' ? { ...s, altMon: { ...s.altMon, flashing: false } } : s;
    default:
      return s;
  }
}

const MODE_KEYS: Partial<Record<GtxKey, TransponderMode>> = { ON: 'ON', ALT: 'ALT', SBY: 'STBY', OFF: 'OFF' };

/** A front-panel key press. */
export function pressGtx(s: GtxState, key: GtxKey, v: GtxView): GtxResult {
  const mode = MODE_KEYS[key];
  if (mode) {
    if (mode === 'OFF') return done({ ...s, entry: null, cursor: null }, [{ type: 'xpdr.mode', mode }]);
    // From OFF the mode keys power the unit up; it shows its start-up screen first.
    const booting = isPowered(v.mode) ? s.bootUntil : v.realTime + BOOT_SECONDS;
    return done({ ...s, bootUntil: booting }, [{ type: 'xpdr.mode', mode }]);
  }
  if (!isPowered(v.mode) || v.realTime < s.bootUntil) return done(s);

  if (key === 'IDNT') return done(s, [{ type: 'xpdr.ident' }]);
  if (key === 'VFR') {
    const r = pressVfr(v.code, s.vfrPrevious);
    return done({ ...s, entry: null, vfrPrevious: r.previous }, r.code === v.code ? [] : [{ type: 'xpdr.code', code: r.code }]);
  }
  if (key === 'FUNC') {
    const next = GROUPS[(GROUPS.indexOf(s.group) + 1) % GROUPS.length]!;
    return done({ ...s, entry: null, cursor: null, downDigits: '', group: next, groupNameUntil: v.realTime + GROUP_NAME_SECONDS });
  }

  // Squawk entry owns the keypad while it is open.
  if (s.entry) {
    switch (key) {
      case 'CLR':
        return done({ ...s, entry: clearDigit(s.entry) });
      case 'CLR_HOLD':
        return done({ ...s, entry: clearAll(s.entry) });
      case 'CRSR':
        return done({ ...s, entry: null });
      case 'ENT': {
        const r = completeEntry(s.entry);
        return done({ ...s, entry: r.entry }, r.commit ? [{ type: 'xpdr.code', code: r.commit }] : []);
      }
      case '8':
      case '9':
        return done(s);
      default: {
        const r = typeDigit(s.entry, Number(key));
        return done({ ...s, entry: r.entry }, r.commit ? [{ type: 'xpdr.code', code: r.commit }] : []);
      }
    }
  }

  // Typing a count-down time: 0 to 9 all enter digits (8 and 9 included).
  if (s.cursor === 'DOWN_SET') {
    if (/^[0-9]$/.test(key)) {
      const downDigits = `${s.downDigits}${key}`;
      const next = { ...s, downDigits };
      return done(downDigits.length === 6 ? applyDownDigits(next, v.simTime) : next);
    }
    if (key === 'CLR' || key === 'CLR_HOLD') {
      if (s.downDigits.length === 0 || key === 'CLR_HOLD') return done({ ...s, cursor: null, downDigits: '' });
      return done({ ...s, downDigits: s.downDigits.slice(0, -1) });
    }
    if (key === 'ENT' || key === 'CRSR') return done(applyDownDigits(s, v.simTime));
    return done(s);
  }

  if (/^[0-7]$/.test(key)) {
    const r = typeDigit(null, Number(key));
    return done({ ...s, cursor: null, entry: r.entry }, r.commit ? [{ type: 'xpdr.code', code: r.commit }] : []);
  }

  if (key === '8' || key === '9') {
    const up = key === '8';
    if (s.cursor === 'BACKLIGHT' || s.cursor === 'CONTRAST') return done(adjustOffset(s, up ? 1 : -1));
    if (s.cursor) return done(s);
    const pages = GROUP_PAGES[s.group];
    const index = Math.min(Math.max(s.pageIn[s.group] + (up ? -1 : 1), 0), pages.length - 1);
    return done({ ...s, pageIn: { ...s.pageIn, [s.group]: index } });
  }

  if (key === 'CRSR') {
    if (s.cursor) return done({ ...s, cursor: null });
    const cursor = cursorFor(currentPage(s));
    return done(cursor ? { ...s, cursor, downDigits: '' } : s);
  }

  if (key === 'ENT') {
    if (s.cursor === 'ALT_MON') {
      const on = !s.altMon.on;
      return done({ ...s, cursor: null, altMon: { on, refFt: v.pressureAltFt, alerting: false, flashing: false, bannerUntil: 0 } });
    }
    if (s.cursor) return done({ ...s, cursor: null });
    return done(timerKey(s, 'ENT', v.simTime));
  }

  if (key === 'CLR' || key === 'CLR_HOLD') {
    if (s.cursor) return done({ ...s, cursor: null });
    return done(timerKey(s, 'CLR', v.simTime));
  }
  return done(s);
}

/**
 * Called as time passes: automatic airborne timers and the altitude
 * monitor. Returns the same object when nothing changed.
 */
export function tickGtx(s: GtxState, v: GtxView): GtxState {
  let next = s;
  if (v.airborne !== s.airborne) {
    // Flight timer: airborne time since the last takeoff. Trip timer: airborne time since its last manual reset.
    next = v.airborne
      ? {
          ...next,
          airborne: true,
          flight: { running: true, accumulated: 0, startedAt: v.simTime },
          trip: next.trip.running ? next.trip : { running: true, accumulated: next.trip.accumulated, startedAt: v.simTime },
        }
      : {
          ...next,
          airborne: false,
          flight: next.flight.running ? toggleWatch(next.flight, v.simTime) : next.flight,
          trip: next.trip.running ? toggleWatch(next.trip, v.simTime) : next.trip,
        };
  }
  const mon = next.altMon;
  if (mon.on) {
    const off = Math.abs(v.pressureAltFt - mon.refFt) > ALT_MONITOR_LIMIT_FT;
    if (off && !mon.alerting) {
      // "LEAVING ALTITUDE" for two seconds, then the monitor page with the deviation flashing.
      next = showPage({ ...next, altMon: { ...mon, alerting: true, flashing: true, bannerUntil: v.realTime + BANNER_SECONDS } }, 'ALT', 'ALT_MONITOR');
    } else if (!off && mon.alerting) {
      next = { ...next, altMon: { ...mon, alerting: false, flashing: false, bannerUntil: 0 } };
    }
  }
  return next;
}

// Screen ------------------------------------------------------------------------

export type GtxPageView =
  | {
      readonly kind: 'titled';
      readonly title: string;
      readonly value: string;
      /** Field under the cursor (shown inverse). */
      readonly highlight: boolean;
      readonly flash: 'title' | 'value' | null;
    }
  | { readonly kind: 'rows'; readonly rows: readonly { readonly label: string; readonly value: string; readonly highlight: boolean }[] };

export interface GtxScreen {
  readonly kind: 'off' | 'boot' | 'normal';
  readonly mode: string;
  readonly code: string;
  readonly entering: boolean;
  readonly ident: boolean;
  readonly reply: boolean;
  readonly special: string | null;
  readonly page: GtxPageView;
  readonly scroll: { readonly index: number; readonly count: number };
  /** Group name shown after FUNC, or null. */
  readonly groupName: string | null;
  readonly banner: string | null;
  /** Display brightness factor from the backlight setting, 0.3 to 1. */
  readonly brightness: number;
}

/** "HH:MM:SS"; hours wrap at 100. */
export function formatTimer(seconds: number): string {
  const t = Math.max(Math.floor(seconds), 0);
  const h = Math.floor(t / 3600) % 100;
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Pressure altitude in the configured FLIGHT LVL units: "FL037". */
export function formatFlightLevel(ft: number): string {
  const fl = Math.round(ft / 100);
  return fl < 0 ? `FL-${String(-fl).padStart(2, '0')}` : `FL${String(fl).padStart(3, '0')}`;
}

/** Count-down entry as typed: "12:3_:__". */
function typedTime(digits: string): string {
  const d = digits.padEnd(6, '_');
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`;
}

const MODE_TEXT: Record<TransponderMode, string> = { OFF: 'OFF', STBY: 'STBY', ON: 'ON', ALT: 'ALT', GND: 'GND' };

function pageView(s: GtxState, page: GtxPage, v: GtxView): GtxPageView {
  const titled = (title: string, value: string, highlight = false, flash: 'title' | 'value' | null = null): GtxPageView => ({
    kind: 'titled',
    title,
    value,
    highlight,
    flash,
  });
  switch (page) {
    case 'FLIGHT_ID':
      return titled('FLIGHT ID', FLIGHT_ID);
    case 'ADSB_TX':
      return titled('1090ES TX CTRL', 'ON');
    case 'UP_COUNTER':
      return titled('UP COUNTER', formatTimer(elapsed(s.up, v.simTime)));
    case 'DOWN_COUNTER': {
      if (s.cursor === 'DOWN_SET') return titled('DOWN COUNTER', typedTime(s.downDigits), true);
      const remaining = s.down.preset - elapsed(s.down.sw, v.simTime);
      if (s.down.preset > 0 && remaining <= 0) return titled('EXPIRED', formatTimer(-remaining), false, 'title');
      return titled('DOWN COUNTER', formatTimer(remaining));
    }
    case 'FLIGHT_TIMER':
      return titled('FLIGHT TIMER', formatTimer(elapsed(s.flight, v.simTime)));
    case 'TRIP_TIMER':
      return titled('TRIP TIMER', formatTimer(elapsed(s.trip, v.simTime)));
    case 'PRESSURE_ALT': {
      const trend = v.verticalSpeedFpm > 300 ? '↑' : v.verticalSpeedFpm < -300 ? '↓' : '';
      return titled('PRESSURE ALT', `${formatFlightLevel(v.pressureAltFt)}${trend}`);
    }
    case 'ALT_MONITOR': {
      const m = s.altMon;
      if (!m.on) return titled('ALT MONITOR', 'OFF', s.cursor === 'ALT_MON');
      const dev = Math.round((v.pressureAltFt - m.refFt) / 10) * 10;
      return titled('ALT MONITOR', `${dev > 0 ? '+' : ''}${dev}FT`, s.cursor === 'ALT_MON', m.flashing ? 'value' : null);
    }
    case 'SAT_DALT':
      return {
        kind: 'rows',
        rows: [
          { label: 'SAT', value: `${v.oatC.toFixed(1)}°C`, highlight: false },
          { label: 'DALT', value: formatFlightLevel(v.densityAltFt), highlight: false },
        ],
      };
    case 'BACKLIGHT':
      return {
        kind: 'rows',
        rows: [
          { label: 'BACKLIGHT', value: String(BACKLIGHT_LEVEL), highlight: false },
          { label: 'OFFSET', value: String(s.backlightOffset), highlight: s.cursor === 'BACKLIGHT' },
        ],
      };
    case 'CONTRAST':
      return {
        kind: 'rows',
        rows: [
          { label: 'CONTRAST', value: String(CONTRAST_LEVEL), highlight: false },
          { label: 'OFFSET', value: String(s.contrastOffset), highlight: s.cursor === 'CONTRAST' },
        ],
      };
    case 'MESSAGES':
      return titled('MESSAGES', '0');
    case 'BLUETOOTH':
      return titled('BLUETOOTH', 'ON');
    case 'GPS_STATUS':
      return titled('GPS STATUS', '3D DIFF');
  }
}

/** Everything the display shows, derived from the local state and the sim. */
export function gtxScreen(s: GtxState, v: GtxView): GtxScreen {
  const page = currentPage(s);
  const kind = !isPowered(v.mode) ? 'off' : v.realTime < s.bootUntil ? 'boot' : 'normal';
  const level = BACKLIGHT_LEVEL + s.backlightOffset;
  return {
    kind,
    mode: MODE_TEXT[v.mode],
    code: shownCode(s.entry, v.code),
    entering: s.entry !== null,
    ident: identActive(v.identUntil, v.simTime),
    reply: replyFlash(v.mode, v.simTime),
    special: s.entry ? null : specialCodeText(v.code),
    page: pageView(s, page, v),
    scroll: { index: GROUP_PAGES[s.group].indexOf(page), count: GROUP_PAGES[s.group].length },
    groupName: v.realTime < s.groupNameUntil ? s.group : null,
    banner: v.realTime < s.altMon.bannerUntil ? 'LEAVING ALTITUDE' : null,
    brightness: Math.min(Math.max(0.3 + (1.4 * level) / 100, 0.3), 1),
  };
}
