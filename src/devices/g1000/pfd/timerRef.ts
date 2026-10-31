import { C172_SPEEDS } from '../../../ui/instruments/palette';

/*
 * The PFD Timer/References window (TMR/REF softkey, Pilot's Guide 2.1):
 * a count-up / count-down timer, the Glide, Vr, Vx and Vy reference flags
 * shown beside the airspeed tape, and the barometric minimums. The large
 * FMS knob moves between fields, the small knob changes the one under the
 * cursor, ENT steps on (or runs the timer command).
 *
 * The timer runs on simulator time so pausing the sim pauses it.
 */

export type VSpeedId = 'glide' | 'vr' | 'vx' | 'vy';

export interface VSpeed {
  readonly id: VSpeedId;
  readonly label: string;
  /** One-letter flag on the airspeed tape. */
  readonly flag: string;
  readonly kt: number;
  readonly on: boolean;
}

export const DEFAULT_VSPEEDS: readonly VSpeed[] = [
  { id: 'glide', label: 'GLIDE', flag: 'G', kt: C172_SPEEDS.vg, on: false },
  { id: 'vr', label: 'Vr', flag: 'R', kt: C172_SPEEDS.vr, on: false },
  { id: 'vx', label: 'Vx', flag: 'X', kt: C172_SPEEDS.vx, on: false },
  { id: 'vy', label: 'Vy', flag: 'Y', kt: C172_SPEEDS.vy, on: false },
];

export interface TimerState {
  readonly up: boolean;
  /** Seconds accumulated before the current run. */
  readonly elapsedSec: number;
  /** Sim time the current run started, or null when stopped. */
  readonly startedAt: number | null;
  /** Count-down starting value, seconds. */
  readonly presetSec: number;
}

export interface References {
  readonly timer: TimerState;
  readonly vspeeds: readonly VSpeed[];
  readonly minimumsOn: boolean;
  readonly minimumsFt: number;
}

export const DEFAULT_REFERENCES: References = {
  timer: { up: true, elapsedSec: 0, startedAt: null, presetSec: 0 },
  vspeeds: DEFAULT_VSPEEDS,
  minimumsOn: false,
  minimumsFt: 1000,
};

/** Cursor fields, top to bottom. */
export const TMR_FIELDS = [
  'time',
  'dir',
  'ctl',
  'glide',
  'glideOn',
  'vr',
  'vrOn',
  'vx',
  'vxOn',
  'vy',
  'vyOn',
  'minMode',
  'minFt',
] as const;
export type TmrField = (typeof TMR_FIELDS)[number];

export interface TimerRefWindow {
  readonly field: number;
  /** Timer command offered in the control field. */
  readonly ctl: 'start' | 'stop' | 'reset';
}

export function openTimerRef(refs: References): TimerRefWindow {
  return { field: 0, ctl: refs.timer.startedAt !== null ? 'stop' : 'start' };
}

export function timerElapsed(t: TimerState, simTime: number): number {
  return t.elapsedSec + (t.startedAt !== null ? Math.max(simTime - t.startedAt, 0) : 0);
}

/** What the timer shows: elapsed time counting up, or what remains of the preset counting down. */
export function timerShown(t: TimerState, simTime: number): number {
  const e = timerElapsed(t, simTime);
  return t.up ? e : Math.max(t.presetSec - e, 0);
}

export function fieldOf(w: TimerRefWindow): TmrField {
  return TMR_FIELDS[w.field] ?? 'time';
}

export function timerRefOuter(w: TimerRefWindow, steps: number): TimerRefWindow {
  return { ...w, field: Math.min(Math.max(w.field + steps, 0), TMR_FIELDS.length - 1) };
}

export interface TimerRefChange {
  readonly window: TimerRefWindow;
  readonly refs: References;
}

const setSpeed = (refs: References, id: VSpeedId, patch: Partial<VSpeed>): References => ({
  ...refs,
  vspeeds: refs.vspeeds.map((v) => (v.id === id ? { ...v, ...patch } : v)),
});

/** Small FMS knob: changes the field under the cursor. */
export function timerRefInner(w: TimerRefWindow, refs: References, steps: number, simTime: number): TimerRefChange {
  const field = fieldOf(w);
  const t = refs.timer;
  switch (field) {
    case 'time': {
      // Setting the time (whole minutes) is possible while stopped; it presets a count-down.
      if (t.startedAt !== null) return { window: w, refs };
      const sec = Math.max(timerShown(t, simTime) + steps * 60, 0);
      const timer = t.up ? { ...t, elapsedSec: sec } : { ...t, presetSec: sec, elapsedSec: 0 };
      return { window: w, refs: { ...refs, timer } };
    }
    case 'dir': {
      // Switching keeps the displayed time: counting down continues from what is shown.
      const shown = timerShown(t, simTime);
      const timer: TimerState = t.up
        ? { up: false, presetSec: shown, elapsedSec: 0, startedAt: t.startedAt !== null ? simTime : null }
        : { ...t, up: true, elapsedSec: shown, startedAt: t.startedAt !== null ? simTime : null };
      return { window: w, refs: { ...refs, timer } };
    }
    case 'ctl': {
      const options: TimerRefWindow['ctl'][] = t.startedAt !== null ? ['stop', 'reset'] : ['start', 'reset'];
      const i = Math.max(options.indexOf(w.ctl), 0);
      return { window: { ...w, ctl: options[(((i + steps) % 2) + 2) % 2]! }, refs };
    }
    case 'glide':
    case 'vr':
    case 'vx':
    case 'vy': {
      const v = refs.vspeeds.find((x) => x.id === field)!;
      return { window: w, refs: setSpeed(refs, field, { kt: Math.min(Math.max(v.kt + steps, 30), 200) }) };
    }
    case 'glideOn':
    case 'vrOn':
    case 'vxOn':
    case 'vyOn': {
      const id = field.slice(0, -2) as VSpeedId;
      return { window: w, refs: setSpeed(refs, id, { on: steps > 0 }) };
    }
    case 'minMode':
      return { window: w, refs: { ...refs, minimumsOn: steps > 0 } };
    case 'minFt':
      return { window: w, refs: { ...refs, minimumsFt: Math.min(Math.max(refs.minimumsFt + steps * 10, 0), 16000) } };
  }
}

/** ENT runs the timer command in the control field, otherwise moves to the next field. */
export function timerRefEnt(w: TimerRefWindow, refs: References, simTime: number): TimerRefChange {
  if (fieldOf(w) !== 'ctl') return { window: timerRefOuter(w, 1), refs };
  const t = refs.timer;
  switch (w.ctl) {
    case 'start':
      return { window: { ...w, ctl: 'stop' }, refs: { ...refs, timer: { ...t, startedAt: simTime } } };
    case 'stop':
      return {
        window: { ...w, ctl: 'reset' },
        refs: { ...refs, timer: { ...t, elapsedSec: timerElapsed(t, simTime), startedAt: null } },
      };
    case 'reset':
      return { window: { ...w, ctl: 'start' }, refs: { ...refs, timer: { ...t, elapsedSec: 0, startedAt: null } } };
  }
}

/** The TMR/REF page menu: all references on or off, or back to defaults. */
export function referencesMenu(refs: References, id: string): References {
  switch (id) {
    case 'allOn':
      return { ...refs, vspeeds: refs.vspeeds.map((v) => ({ ...v, on: true })) };
    case 'allOff':
      return { ...refs, vspeeds: refs.vspeeds.map((v) => ({ ...v, on: false })) };
    case 'defaults':
      return { ...refs, vspeeds: DEFAULT_VSPEEDS };
  }
  return refs;
}

/** "hh:mm:ss" */
export function formatTimer(sec: number): string {
  const s = Math.floor(Math.max(sec, 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600) % 100)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
