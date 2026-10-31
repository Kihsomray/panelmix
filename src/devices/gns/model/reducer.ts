import type { SimCommand } from '../../../sim/commands';
import { entryValue, turnLarge, turnSmall } from '../../../ui/identEntry';
import { AUX_LOGIC, INITIAL_TIMER } from './aux';
import { completer, DEFAULT_CRITERIA, findWaypoint } from './data';
import { acceptDto, closeModal, DTO_STOP, dtoPage, openDto } from './dto';
import { acceptFplWaypoint, FPL_LOGIC } from './fpl';
import { DEFAULT_VNAV, defaultMap, NAV_LOGIC, procedureNotice } from './navPages';
import { NRST_LOGIC } from './nrst';
import { clampStep, step, type PageLogic } from './page';
import { currentPage, MAP_RANGES_NM, NAV_MAP_RANGES_NM, stepGroup, stepPage } from './pages';
import { adjustVolume, EMERGENCY_KHZ, INITIAL_RADIO, pushVolume, toggleTuning, tune } from './radios';
import type { FnPage, GnsCtx, GnsInput, GnsKey, GnsUi, MenuAction, Model, PageId, Popup, Step } from './types';
import { acceptWpt, returnFromWpt, WPT_LOGIC } from './wpt';

/*
 * The GNS 430W / 530W as a pure reducer: (screen state, bezel input, sim
 * snapshot) -> (next screen state, sim commands). The generic Garmin rules
 * live here (cursor on/off, large knob moves the cursor, windows, knob entry,
 * function keys); each page adds its own stops and actions.
 */

const LOGIC: Readonly<Record<PageId, PageLogic>> = {
  ...NAV_LOGIC,
  ...WPT_LOGIC,
  ...AUX_LOGIC,
  ...NRST_LOGIC,
  ...FPL_LOGIC,
  dto: dtoPage,
} as Record<PageId, PageLogic>;

export function initialUi(model: Model): GnsUi {
  return {
    model,
    group: 'NAV',
    pages: { NAV: 0, WPT: 0, AUX: 0, NRST: 0 },
    fn: null,
    fplPage: 0,
    cursor: null,
    scroll: 0,
    popup: null,
    entry: null,
    stack: [],
    dto: { wp: null, planIndex: null },
    wpt: { airport: null, vor: null, ndb: null, runway: 0 },
    wptReturn: null,
    map: defaultMap(model),
    navRange: NAV_MAP_RANGES_NM.indexOf(10),
    rwyRange: MAP_RANGES_NM.indexOf(3.5),
    navcomAirport: 0,
    radio: INITIAL_RADIO,
    aux: { sub: null, timer: INITIAL_TIMER, criteria: DEFAULT_CRITERIA, tripLeg: 0 },
    vnav: DEFAULT_VNAV,
  };
}

export function reduce(ui: GnsUi, input: GnsInput, ctx: GnsCtx): Step {
  switch (input.kind) {
    case 'left':
      return tune(ui, ctx, input.ring, input.steps);
    case 'leftPush':
      return toggleTuning(ui, ctx);
    case 'volume':
      return adjustVolume(ui, ctx, input.knob, input.steps);
    case 'volumePush':
      return pushVolume(ui, ctx, input.knob);
    case 'hold':
      // CLR held: "immediately display the Default Navigation Page". C held two seconds: 121.500 active.
      return input.key === 'CLR' ? step(defaultNavPage(ui)) : step(ui, [{ type: 'com.setActive', radio: 0, khz: EMERGENCY_KHZ }]);
    case 'key':
      return key(ui, input.key, ctx);
    case 'right':
      return input.ring === 'outer' ? largeKnob(ui, ctx, input.steps) : smallKnob(ui, ctx, input.steps);
    case 'rightPush':
      return crsr(ui, ctx);
  }
}

const logicFor = (ui: GnsUi): PageLogic => LOGIC[currentPage(ui)];

function defaultNavPage(ui: GnsUi): GnsUi {
  return {
    ...ui,
    fn: null,
    group: 'NAV',
    pages: { ...ui.pages, NAV: 0 },
    cursor: null,
    scroll: 0,
    popup: null,
    entry: null,
    stack: [],
    wptReturn: null,
    aux: { ...ui.aux, sub: null },
  };
}

/** Keeps the highlighted row of a scrolling list on screen. */
function follow(ui: GnsUi, ctx: GnsCtx): GnsUi {
  const shape = logicFor(ui).list?.(ui, ctx);
  if (!shape || ui.cursor === null) return ui;
  if (ui.cursor < shape.header) return { ...ui, scroll: 0 };
  const row = Math.floor((ui.cursor - shape.header) / shape.perRow);
  // A stop after the list ("Done?") leaves the list where it is.
  if (row >= shape.rows) return ui;
  let scroll = Math.min(ui.scroll, Math.max(shape.rows - shape.visible, 0));
  if (row < scroll) scroll = row;
  else if (row >= scroll + shape.visible) scroll = row - shape.visible + 1;
  return scroll === ui.scroll ? ui : { ...ui, scroll };
}

/** A page handler's result with its list scrolled to the cursor. */
const followed = (s: Step, ctx: GnsCtx): Step => ({ ...s, ui: follow(s.ui, ctx) });

// Keys ---------------------------------------------------------------------------

function key(ui: GnsUi, k: GnsKey, ctx: GnsCtx): Step {
  switch (k) {
    case 'COM_FLIP':
      return step(ui, [{ type: 'com.swap', radio: 0 }]);
    case 'VLOC_FLIP':
      return step(ui, [{ type: 'nav.swap', radio: 0 }]);
    case 'CDI':
      return step(ui, [{ type: 'cdi.cycle', sources: ctx.cdiSources }]);
    case 'OBS':
      return step(ui, [{ type: 'fms.obs', on: !ctx.state.fms.obsMode }]);
    case 'MSG':
      return ui.fn === 'msg' ? step(closeModal(ui)) : step(openModal(ui, 'msg'), [{ type: 'msg.readAll' }]);
    case 'FPL':
      return step(toggleFn(ui, 'fpl'));
    case 'PROC':
      return step(toggleFn(ui, 'proc'));
    case 'VNAV':
      return ui.model === '530' ? step(toggleFn(ui, 'vnav')) : step(ui);
    case 'DTO':
      return dtoKey(ui, ctx);
    case 'MENU':
      return menuKey(ui, ctx);
    case 'CLR':
      return clrKey(ui, ctx);
    case 'ENT':
      return entKey(ui, ctx);
    case 'RNG_IN':
    case 'RNG_OUT': {
      // The up arrow zooms out to a larger area.
      if (ui.popup) return step(ui);
      const next = logicFor(ui).range?.(ui, k === 'RNG_OUT' ? 1 : -1);
      return step(next ?? ui);
    }
  }
}

/** FPL, PROC and VNAV pages: the key opens the page, pressed again returns to the main pages. */
function toggleFn(ui: GnsUi, fn: FnPage): GnsUi {
  const base = { ...ui, popup: null, entry: null, stack: [], scroll: 0 };
  if (ui.fn === fn) return { ...base, fn: null, cursor: null };
  // PROC opens with the cursor on "Select Approach?".
  return { ...base, fn, fplPage: fn === 'fpl' ? 0 : ui.fplPage, cursor: fn === 'proc' ? 0 : null };
}

function openModal(ui: GnsUi, fn: FnPage): GnsUi {
  return { ...ui, stack: [...ui.stack, { fn: ui.fn, cursor: ui.cursor, scroll: ui.scroll }], fn, cursor: null, scroll: 0, popup: null, entry: null };
}

function dtoKey(ui: GnsUi, ctx: GnsCtx): Step {
  if (ui.fn === 'dto') return step(closeModal(ui));
  const prefill = ui.entry ? null : logicFor(ui).dto?.(ui, ctx, ui.cursor) ?? null;
  return step(openDto({ ...ui, entry: null, popup: null }, ctx, prefill));
}

function menuKey(ui: GnsUi, ctx: GnsCtx): Step {
  if (ui.popup?.kind === 'menu') return step({ ...ui, popup: null });
  if (ui.popup || ui.entry) return step(ui);
  const items = logicFor(ui).menu?.(ui, ctx);
  if (!items || items.length === 0) return step(ui);
  const first = items.findIndex((i) => i.enabled);
  return step({ ...ui, popup: { kind: 'menu', items, index: Math.max(first, 0) } });
}

function clrKey(ui: GnsUi, ctx: GnsCtx): Step {
  if (ui.popup) return step({ ...ui, popup: null });
  if (ui.entry) return step({ ...ui, entry: null });
  if (ui.fn === 'dto' || ui.fn === 'msg') return step(closeModal(ui));
  const handled = logicFor(ui).clr?.(ui, ctx, ui.cursor);
  if (handled) return followed(handled, ctx);
  if (ui.wptReturn && ui.fn === null && ui.group === 'WPT') return step(returnFromWpt(ui));
  return step(ui);
}

function entKey(ui: GnsUi, ctx: GnsCtx): Step {
  if (ui.popup) return popupEnt(ui, ui.popup, ctx);
  if (ui.entry) return acceptEntry(ui, ctx);
  if (ui.cursor === null) return step(ui);
  const handled = logicFor(ui).ent?.(ui, ctx, ui.cursor);
  return handled ? followed(handled, ctx) : step(ui);
}

// Knobs ----------------------------------------------------------------------------

function largeKnob(ui: GnsUi, ctx: GnsCtx, steps: number): Step {
  if (ui.popup) return step({ ...ui, popup: movePopup(ui.popup, steps) });
  if (ui.entry) return step({ ...ui, entry: { ...ui.entry, e: turnLarge(ui.entry.e, steps) } });
  if (ui.cursor !== null) {
    const logic = logicFor(ui);
    const handled = logic.large?.(ui, ctx, ui.cursor, steps);
    if (handled) return followed(handled, ctx);
    return step(follow({ ...ui, cursor: clampStep(ui.cursor, steps, logic.stops(ui, ctx)) }, ctx));
  }
  // Modal pages keep the knob; function pages give way to the main page groups.
  if (ui.fn === 'dto' || ui.fn === 'msg') return step(ui);
  return step(stepGroup({ ...ui, aux: { ...ui.aux, sub: null } }, steps));
}

function smallKnob(ui: GnsUi, ctx: GnsCtx, steps: number): Step {
  if (ui.popup) return step({ ...ui, popup: movePopup(ui.popup, steps) });
  if (ui.entry) {
    const kind = ui.entry.target.kind === 'wpt' ? ui.entry.target.what : null;
    return step({ ...ui, entry: { ...ui.entry, e: turnSmall(ui.entry.e, steps, completer(ctx.db, kind)) } });
  }
  if (ui.cursor !== null) {
    const handled = logicFor(ui).small?.(ui, ctx, ui.cursor, steps);
    return handled ? followed(handled, ctx) : step(ui);
  }
  if (ui.fn === null && ui.aux.sub) return step(stepPage({ ...ui, aux: { ...ui.aux, sub: null } }, steps));
  return step(stepPage(ui, steps));
}

/** Small right knob pushed (CRSR): cursor on or off. */
function crsr(ui: GnsUi, ctx: GnsCtx): Step {
  if (ui.popup) return step(ui);
  if (ui.entry) return step({ ...ui, entry: null, cursor: ui.fn === 'dto' ? DTO_STOP.ident : null });
  // The direct-to page always has its cursor.
  if (ui.fn === 'dto') return step(ui);
  if (ui.cursor !== null) return step({ ...ui, cursor: null, scroll: 0 });
  const logic = logicFor(ui);
  if (logic.stops(ui, ctx) === 0) return step(ui);
  const shown = logic.cursorOn?.(ui, ctx) ?? ui;
  return step(follow({ ...shown, cursor: logic.first?.(shown, ctx) ?? 0 }, ctx));
}

// Windows ---------------------------------------------------------------------------

function movePopup(p: Popup, steps: number): Popup {
  switch (p.kind) {
    case 'menu': {
      // Skip unavailable items.
      let i = p.index;
      const dir = Math.sign(steps);
      for (let n = Math.abs(steps); n > 0; n--) {
        let j = i + dir;
        while (j >= 0 && j < p.items.length && !p.items[j]!.enabled) j += dir;
        if (j < 0 || j >= p.items.length) break;
        i = j;
      }
      return { ...p, index: i };
    }
    case 'confirm':
      return { ...p, yes: steps % 2 === 0 ? p.yes : !p.yes };
    case 'list':
      return { ...p, index: clampStep(p.index, steps, p.items.length) };
    default:
      return p;
  }
}

function popupEnt(ui: GnsUi, p: Popup, ctx: GnsCtx): Step {
  const closed = { ...ui, popup: null };
  switch (p.kind) {
    case 'menu': {
      const it = p.items[p.index];
      return it?.enabled ? menuAction(closed, it.action, ctx) : step(ui);
    }
    case 'confirm':
      if (!p.yes) return step(closed);
      return p.action === 'fpl.delete'
        ? step({ ...closed, cursor: null, scroll: 0 }, [{ type: 'fms.clear' }])
        : followed(step({ ...closed, cursor: p.index }, [{ type: 'fms.remove', index: p.index }]), ctx);
    case 'activateLeg':
      return step({ ...closed, cursor: null, scroll: 0 }, [{ type: 'fms.activateLeg', index: p.index }]);
    case 'list': {
      const wp = p.items[p.index];
      if (!wp) return step(closed);
      if (p.purpose === 'navcom.airport') return step({ ...closed, navcomAirport: p.index });
      return step({ ...closed, dto: { wp, planIndex: p.purpose === 'dto.fpl' ? p.index : null }, cursor: DTO_STOP.activate });
    }
    case 'notice':
      return step(closed);
  }
}

function menuAction(ui: GnsUi, action: MenuAction, ctx: GnsCtx): Step {
  const cmds: SimCommand[] = [];
  switch (action) {
    case 'fpl.activateLeg':
      return ui.cursor === null ? step(ui) : step({ ...ui, popup: { kind: 'activateLeg', index: ui.cursor } });
    case 'fpl.invert':
      cmds.push({ type: 'fms.invert' });
      return step({ ...ui, cursor: null, scroll: 0 }, cmds);
    case 'fpl.delete':
      return step({ ...ui, popup: { kind: 'confirm', action: 'fpl.delete', index: 0, yes: true } });
    case 'fpl.selectApproach':
      return step({ ...ui, popup: procedureNotice(ctx, 'Approach') });
    case 'fpl.selectArrival':
      return step({ ...ui, popup: procedureNotice(ctx, 'Arrival') });
    case 'fpl.selectDeparture':
      return step({ ...ui, popup: procedureNotice(ctx, 'Departure') });
    case 'dto.cancel':
      return step(closeModal(ui), [{ type: 'fms.cancelDirectTo' }]);
    case 'map.fields':
      return step({ ...ui, map: { ...ui.map, fields: !ui.map.fields } });
    case 'map.restore':
      return step({ ...ui, map: defaultMap(ui.model) });
    case 'nav.restore':
      return step({ ...ui, navRange: NAV_MAP_RANGES_NM.indexOf(10) });
    case 'vnav.restore':
      return step({ ...ui, vnav: DEFAULT_VNAV });
    case 'none':
      return step(ui);
  }
}

// Knob entry --------------------------------------------------------------------------

/** ENT while spelling an identifier: accept it if the database has it. */
function acceptEntry(ui: GnsUi, ctx: GnsCtx): Step {
  const entry = ui.entry!;
  const target = entry.target;
  const kind = target.kind === 'wpt' ? target.what : null;
  const wp = findWaypoint(ctx.db, entryValue(entry.e), kind, ctx.state.aircraft);
  if (!wp) return step(ui);
  switch (target.kind) {
    case 'dto':
      return acceptDto(ui, ctx, wp);
    case 'fpl':
      return followed(acceptFplWaypoint(ui, target.index, wp), ctx);
    case 'wpt':
      return step(acceptWpt(ui, target.what, wp));
  }
}
