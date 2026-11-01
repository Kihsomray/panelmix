import { step, type PageLogic } from './page';
import type { AuxSub, GenericTimer, GnsCtx, GnsUi, NearestCriteria, PageId, RunwaySurfaceCriteria, UnitSettings } from './types';

/*
 * AUX group (Section 9): four menu pages. Highlight an item with the cursor
 * and press ENT to open it; CLR goes back. Working items: Flight Timers
 * (generic count up/down timer), Trip Planning, Density Alt / TAS / Winds,
 * CDI / Alarms (ILS CDI auto or manual, the arrival alarm), Nearest Airport
 * Criteria (filters the NRST list) and the database versions. The rest open
 * honestly empty.
 */

export type AuxPage = 'aux.fplan' | 'aux.util' | 'aux.setup1' | 'aux.setup2';

export const AUX_TITLE: Record<AuxPage, string> = {
  'aux.fplan': 'FLIGHT PLANNING',
  'aux.util': 'UTILITY',
  'aux.setup1': 'SETUP 1',
  'aux.setup2': 'SETUP 2',
};

export const AUX_ITEMS: Record<AuxPage, readonly { readonly label: string; readonly sub: AuxSub }[]> = {
  'aux.fplan': [
    { label: 'Fuel Planning', sub: 'fuel' },
    { label: 'Trip Planning', sub: 'trip' },
    { label: 'Density Alt / TAS / Winds', sub: 'dalt' },
    { label: 'Crossfill', sub: 'crossfill' },
    { label: 'Scheduler', sub: 'scheduler' },
  ],
  'aux.util': [
    { label: 'Checklists', sub: 'checklists' },
    { label: 'Flight Timers', sub: 'timers' },
    { label: 'Trip Statistics', sub: 'tripStats' },
    { label: 'RAIM Prediction', sub: 'raim' },
    { label: 'Sunrise / Sunset', sub: 'sun' },
    { label: 'Software Versions', sub: 'versions' },
  ],
  'aux.setup1': [
    { label: 'Airspace Alarms', sub: 'airspace' },
    { label: 'CDI / Alarms', sub: 'cdi' },
    { label: 'Units / Mag Var', sub: 'units' },
    { label: 'Position / Map Datum', sub: 'position' },
    { label: 'Date / Time', sub: 'datetime' },
  ],
  'aux.setup2': [
    { label: 'Display', sub: 'display' },
    { label: 'Nearest Airport Criteria', sub: 'nearestApt' },
    { label: 'SBAS Selection', sub: 'sbas' },
    { label: 'COM Configuration', sub: 'com' },
  ],
};

export const INITIAL_TIMER: GenericTimer = { running: false, up: true, base: 0, startedAt: 0, preset: 0 };

/** The generic timer's reading at sim time `now`, seconds. */
export function timerSeconds(t: GenericTimer, now: number): number {
  if (!t.running) return t.base;
  const dt = Math.max(now - t.startedAt, 0);
  return t.up ? t.base + dt : Math.max(t.base - dt, 0);
}

export const TIMER_STOP = { startStop: 0, direction: 1, time: 2 } as const;
export const CRITERIA_STOP = { surface: 0, length: 1 } as const;
export const CDI_STOP = { ilsCdi: 0, arrival: 1, arrivalNm: 2 } as const;

/** Factory settings: automatic ILS CDI selection, arrival alarm off. */
export const DEFAULT_SETTINGS: UnitSettings = { ilsCdi: 'auto', arrivalAlarm: false, arrivalNm: 1 };

const CRITERIA_SURFACES: readonly RunwaySurfaceCriteria[] = ['any', 'hard', 'hard-soft'];
export const CRITERIA_SURFACE_LABEL: Record<RunwaySurfaceCriteria, string> = { any: 'Any', hard: 'Hard only', 'hard-soft': 'Hard/soft' };
const MAX_MIN_LENGTH_FT = 9900;

const SUB_STOPS: Partial<Record<AuxSub, number>> = { timers: 3, nearestApt: 2, trip: 1, cdi: 3 };

const subStops = (ui: GnsUi) => (ui.aux.sub ? SUB_STOPS[ui.aux.sub] ?? 0 : 0);

const setTimer = (ui: GnsUi, timer: GenericTimer): GnsUi => ({ ...ui, aux: { ...ui.aux, timer } });
const setCriteria = (ui: GnsUi, criteria: NearestCriteria): GnsUi => ({ ...ui, aux: { ...ui.aux, criteria } });

function smallInSub(ui: GnsUi, ctx: GnsCtx, stop: number, steps: number): GnsUi | null {
  const t = ui.aux.timer;
  switch (ui.aux.sub) {
    case 'timers':
      if (t.running) return null;
      if (stop === TIMER_STOP.direction) {
        const up = !t.up;
        return setTimer(ui, { ...t, up, base: up ? 0 : t.preset });
      }
      if (stop === TIMER_STOP.time && !t.up) {
        const preset = Math.min(Math.max(t.preset + steps * 60, 0), 99 * 3600);
        return setTimer(ui, { ...t, preset, base: preset });
      }
      return null;
    case 'nearestApt': {
      const c = ui.aux.criteria;
      if (stop === CRITERIA_STOP.surface) {
        const i = CRITERIA_SURFACES.indexOf(c.surface);
        const n = CRITERIA_SURFACES.length;
        return setCriteria(ui, { ...c, surface: CRITERIA_SURFACES[(((i + steps) % n) + n) % n]! });
      }
      return setCriteria(ui, { ...c, minLengthFt: Math.min(Math.max(c.minLengthFt + steps * 100, 0), MAX_MIN_LENGTH_FT) });
    }
    case 'trip': {
      // 0 is the whole plan ("CUM"), i the leg ending at plan[i].
      const options = Math.max(ctx.state.fms.plan.length, 1);
      return { ...ui, aux: { ...ui.aux, tripLeg: (((ui.aux.tripLeg + steps) % options) + options) % options } };
    }
    case 'cdi': {
      const s = ui.settings;
      if (stop === CDI_STOP.ilsCdi) return { ...ui, settings: { ...s, ilsCdi: s.ilsCdi === 'auto' ? 'manual' : 'auto' } };
      if (stop === CDI_STOP.arrival) return { ...ui, settings: { ...s, arrivalAlarm: !s.arrivalAlarm } };
      const arrivalNm = Math.min(Math.max(Math.round((s.arrivalNm + steps * 0.1) * 10) / 10, 0.1), 9.9);
      return { ...ui, settings: { ...s, arrivalNm } };
    }
    default:
      return null;
  }
}

function auxLogic(page: AuxPage): PageLogic {
  const items = AUX_ITEMS[page];
  return {
    stops: (ui) => (ui.aux.sub ? subStops(ui) : items.length),
    ent: (ui, ctx, stop) => {
      if (!ui.aux.sub) {
        const sub = items[stop]?.sub;
        if (!sub) return null;
        const opened = { ...ui, aux: { ...ui.aux, sub } };
        return step({ ...opened, cursor: subStops(opened) > 0 ? 0 : null, scroll: 0 });
      }
      if (ui.aux.sub === 'timers' && stop === TIMER_STOP.startStop) {
        const t = ui.aux.timer;
        const now = ctx.state.time;
        if (t.running) return step(setTimer(ui, { ...t, running: false, base: timerSeconds(t, now) }));
        const base = !t.up && t.base <= 0 ? t.preset : t.base;
        return step(setTimer(ui, { ...t, running: true, startedAt: now, base }));
      }
      return null;
    },
    small: (ui, ctx, stop, steps) => {
      if (!ui.aux.sub) return null;
      const next = smallInSub(ui, ctx, stop, steps);
      return next ? step(next) : null;
    },
    clr: (ui, _ctx, stop) => {
      const sub = ui.aux.sub;
      if (!sub) return null;
      if (sub === 'timers' && stop === TIMER_STOP.time) {
        const t = ui.aux.timer;
        return step(setTimer(ui, { ...t, running: false, base: t.up ? 0 : t.preset }));
      }
      const index = items.findIndex((x) => x.sub === sub);
      return step({ ...ui, aux: { ...ui.aux, sub: null }, cursor: index >= 0 ? index : null });
    },
  };
}

export const AUX_LOGIC: Partial<Record<PageId, PageLogic>> = {
  'aux.fplan': auxLogic('aux.fplan'),
  'aux.util': auxLogic('aux.util'),
  'aux.setup1': auxLogic('aux.setup1'),
  'aux.setup2': auxLogic('aux.setup2'),
};
