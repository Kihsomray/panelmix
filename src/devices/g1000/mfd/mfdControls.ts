import type { AnyWaypoint, NavDatabase } from '../../../core/navdb';
import type { SimCommand } from '../../../sim/commands';
import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import type { GduActions } from '../bezel/GduBezel';
import { movePointer, stepG1000Range } from '../screen/MapView';
import { commonControls } from '../shared/commonControls';
import {
  directToClr,
  directToEnt,
  directToInner,
  directToOuter,
  openDirectTo,
  planIndexFor,
  type DirectToLists,
} from '../shared/directTo';
import { FPL_CURSOR_OFF, fplClamp, fplClr, fplCursorOn, fplEnt, fplInner, fplOuter, scrollToShow } from '../shared/flightPlan';
import { confirmCommands, directToMenuItems, fplMenuConfirm, fplMenuItems, removeConfirm, resolveWaypoint } from '../shared/fplActions';
import { confirmMove, menuMove, menuSelection, openMenu, type MenuItem } from '../shared/menu';
import { openProcedures, type ProcKind } from '../shared/procedures';
import { getShared } from '../shared/store';
import { checkItem, moveChecklist, toggleEmergency } from './checklists';
import { MFD_FPL_ROWS, PAGE } from './layout';
import { fplKey, goTo, pageId, procKey, selectGroup, selectPage, type PageId } from './mfdPages';
import { pressMfdSoftkey } from './mfdSoftkeys';
import {
  NRST_START,
  nrstMove,
  nrstPush,
  nrstSection,
  wptClr,
  wptEnt,
  wptInner,
  wptOuter,
  wptPush,
  type MfdUi,
  type WptKind,
} from './mfdState';

/*
 * Wires the MFD bezel to its pages and the simulator. Like the PFD, the FMS
 * knob, ENT, CLR and MENU act on a pop-up first, then the Direct-to panel,
 * then the page's own cursor; with no cursor the FMS knob selects pages.
 */

/** What the page on screen offers to the knobs: its lists and records. */
export interface MfdPageData {
  /** Items in the nearest list on a NRST page, nearest first. */
  readonly nearest: readonly AnyWaypoint[];
  /** Frequencies (kHz) of the selected nearest airport, or the flattened nearest-frequencies list. */
  readonly freqs: readonly number[];
  readonly runways: number;
  /** The waypoint a WPT page shows. */
  readonly wpt: AnyWaypoint | undefined;
  /** What the map pointer is on. */
  readonly pointerTarget: AnyWaypoint | null;
}

export interface MfdControlContext {
  readonly state: SimState;
  readonly derived: Derived;
  readonly dispatch: (cmd: SimCommand) => void;
  readonly db: NavDatabase;
  readonly ui: MfdUi;
  readonly setUi: (fn: (ui: MfdUi) => MfdUi) => void;
  readonly data: MfdPageData;
  /** Flight plan and nearest identifiers for the Direct-to waypoint submenu. */
  readonly dtoLists: DirectToLists;
}

const WPT_KIND: Partial<Record<PageId, WptKind>> = { airportInfo: 'airport', vorInfo: 'vor', ndbInfo: 'ndb' };
const NRST_PAGES: readonly PageId[] = ['nrstAirports', 'nrstVor', 'nrstNdb', 'nrstFreq'];

/** COM frequencies go to the COM standby with the tuning box, VOR ones to the NAV standby. NDBs need an ADF the trainer does not have. */
export function loadFrequency(khz: number): SimCommand | null {
  const radio = getShared().radio;
  if (khz >= 108000 && khz < 118000) return { type: 'nav.setStandby', radio: radio.navTuned, khz };
  if (khz >= 118000 && khz < 137000) return { type: 'com.setStandby', radio: radio.comTuned, khz };
  return null;
}

export function mfdControls(c: MfdControlContext): GduActions {
  const { state, derived, dispatch, db, ui, setUi, data } = c;
  const pos = { lat: state.aircraft.lat, lon: state.aircraft.lon };
  const plan = state.fms.plan;
  const activeIndex = state.fms.activeLeg?.planIndex ?? null;
  const page = pageId(ui.pages);
  const wptKind = WPT_KIND[page];
  const resolves = (ident: string) => !!ident && db.find(ident).length > 0;
  const complete = (prefix: string) => db.complete(prefix)?.ident;
  const run = (cmds: readonly SimCommand[]) => {
    for (const cmd of cmds) dispatch(cmd);
  };
  const openPopupMenu = (items: MenuItem[]) => setUi((u) => ({ ...u, popup: { kind: 'menu', menu: openMenu(items) } }));
  const fplCursor = fplClamp(ui.fpl.cursor, plan.length);
  const setFpl = (cursor: typeof fplCursor) =>
    setUi((u) => ({ ...u, fpl: { cursor, scroll: scrollToShow(u.fpl.scroll, cursor.index, MFD_FPL_ROWS, plan.length + 1 + (cursor.entry ? 1 : 0)) } }));
  const load = (khz: number | undefined) => {
    const cmd = khz !== undefined ? loadFrequency(khz) : null;
    if (cmd) dispatch(cmd);
  };

  /** Page changes reset the page cursors and the page-level softkeys. */
  const showPages = (fn: (u: MfdUi) => MfdUi['pages']) =>
    setUi((u) => ({
      ...u,
      pages: fn(u),
      keys: { ...u.keys, menu: u.keys.menu === 'map' ? 'page' : u.keys.menu },
      fpl: { cursor: FPL_CURSOR_OFF, scroll: u.fpl.scroll },
      wpt: { ...u.wpt, cursor: 'off', entry: null, proc: null },
      nrst: NRST_START,
      pointer: null,
      popup: null,
    }));

  const fms = (knob: 'outer' | 'inner', steps: number) => {
    const popup = ui.popup;
    if (popup) {
      setUi((u) => ({
        ...u,
        popup: popup.kind === 'menu' ? { kind: 'menu', menu: menuMove(popup.menu, steps) } : { kind: 'confirm', confirm: confirmMove(popup.confirm, steps) },
      }));
      return;
    }
    if (ui.dto) {
      const d = ui.dto;
      const next = knob === 'inner' ? directToInner(d.dto, steps, complete, c.dtoLists) : directToOuter(d.dto, steps, resolves, c.dtoLists);
      setUi((u) => ({ ...u, dto: { ...d, dto: next } }));
      return;
    }
    if (ui.pages.proc) {
      if (!ui.proc.loading) setUi((u) => ({ ...u, proc: { ...u.proc, menu: menuMove(u.proc.menu, steps) } }));
      return;
    }
    if (page === 'activeFpl' && fplCursor.index !== null) {
      setFpl(knob === 'outer' ? fplOuter(fplCursor, steps, plan.length) : fplInner(fplCursor, steps, complete));
      return;
    }
    if (wptKind && ui.wpt.cursor !== 'off') {
      const current = data.wpt?.ident ?? '';
      const counts = { runways: data.runways, freqs: data.freqs.length };
      setUi((u) => ({
        ...u,
        wpt: knob === 'outer' ? wptOuter(u.wpt, steps, wptKind === 'airport') : wptInner(u.wpt, steps, complete, current, counts),
      }));
      return;
    }
    if (NRST_PAGES.includes(page) && ui.nrst.item !== null) {
      const count = page === 'nrstFreq' ? data.freqs.length : data.nearest.length;
      setUi((u) => ({ ...u, nrst: nrstMove(u.nrst, steps, count, { runways: data.runways, freqs: data.freqs.length }) }));
      return;
    }
    if (page === 'checklist' && ui.checklist.active) {
      setUi((u) => ({ ...u, checklist: moveChecklist(u.checklist, knob, steps) }));
      return;
    }
    const now = performance.now();
    showPages((u) => (knob === 'outer' ? selectGroup(u.pages, steps, now) : selectPage(u.pages, steps, now)));
  };

  const menuChoice = (id: string) => {
    if (id === 'cancelDto') {
      dispatch({ type: 'fms.cancelDirectTo' });
      setUi((u) => ({ ...u, dto: null, popup: null }));
      return;
    }
    if (id === 'declutter') {
      setUi((u) => ({ ...u, popup: null, keys: { ...u.keys, map: { ...u.keys.map, declutter: ((u.keys.map.declutter + 1) % 4) as 0 | 1 | 2 | 3 } } }));
      return;
    }
    if (id === 'profile') {
      setUi((u) => ({ ...u, popup: null, keys: { ...u.keys, map: { ...u.keys.map, profile: !u.keys.map.profile } } }));
      return;
    }
    if (id === 'aptWindow' || id === 'rnwyWindow' || id === 'freqWindow') {
      const section = id === 'aptWindow' ? 'list' : id === 'rnwyWindow' ? 'runway' : 'freq';
      setUi((u) => ({ ...u, popup: null, nrst: nrstSection(u.nrst, section) }));
      return;
    }
    const confirm = fplMenuConfirm(id, plan, fplCursor.index);
    setUi((u) => ({ ...u, popup: confirm ? { kind: 'confirm', confirm } : null }));
  };

  const ent = () => {
    const popup = ui.popup;
    if (popup) {
      if (popup.kind === 'menu') {
        const id = menuSelection(popup.menu);
        if (id) menuChoice(id);
      } else {
        run(confirmCommands(popup.confirm));
        setUi((u) => ({ ...u, popup: null }));
      }
      return;
    }
    if (ui.dto) {
      const d = ui.dto;
      // A pick from the flight plan list joins the plan at that waypoint.
      const fromPlan = d.dto.list?.kind === 'FPL' ? d.dto.list.index : null;
      const result = directToEnt(d.dto, resolves, c.dtoLists);
      if (result.activate) {
        const wp = resolveWaypoint(db, result.activate, pos);
        if (wp) dispatch({ type: 'fms.directTo', waypoint: wp, planIndex: planIndexFor(plan, wp.ident, d.planIndex, activeIndex) });
        setUi((u) => ({ ...u, dto: null }));
      } else if (result.state) {
        const next = result.state;
        setUi((u) => ({ ...u, dto: { dto: next, planIndex: fromPlan ?? d.planIndex } }));
      }
      return;
    }
    if (ui.pages.proc) {
      const id = menuSelection(ui.proc.menu);
      if (!ui.proc.loading && (id === 'approach' || id === 'arrival' || id === 'departure')) {
        setUi((u) => ({ ...u, proc: { ...u.proc, loading: id as ProcKind } }));
      }
      return;
    }
    if (page === 'activeFpl' && fplCursor.index !== null) {
      const result = fplEnt(fplCursor, resolves);
      if (result.insert) {
        const near = plan[result.insert.index] ?? plan[plan.length - 1] ?? pos;
        const wp = resolveWaypoint(db, result.insert.ident, near);
        if (wp) dispatch({ type: 'fms.insert', index: result.insert.index, waypoint: wp });
      }
      setFpl(result.cursor);
      return;
    }
    if (wptKind) {
      if (ui.wpt.entry) setUi((u) => ({ ...u, wpt: wptEnt(u.wpt, wptKind, resolves) }));
      else if (ui.wpt.cursor === 'freq') load(wptKind === 'airport' ? data.freqs[ui.wpt.freq] : data.freqs[0]);
      return;
    }
    if (NRST_PAGES.includes(page) && ui.nrst.item !== null) {
      if (page === 'nrstFreq') load(data.freqs[ui.nrst.item]);
      else if (ui.nrst.section === 'freq') load(data.freqs[page === 'nrstAirports' ? ui.nrst.freq : 0]);
      else setUi((u) => ({ ...u, nrst: nrstMove(u.nrst, 1, data.nearest.length, { runways: data.runways, freqs: data.freqs.length }) }));
      return;
    }
    if (page === 'checklist' && ui.checklist.active) setUi((u) => ({ ...u, checklist: checkItem(u.checklist) }));
  };

  const clr = () => {
    if (ui.popup) {
      setUi((u) => ({ ...u, popup: null }));
      return;
    }
    if (ui.dto) {
      const d = ui.dto;
      const result = directToClr(d.dto);
      const next = result.state;
      setUi((u) => ({ ...u, dto: next ? { ...d, dto: next } : null }));
      return;
    }
    if (ui.pages.proc) {
      if (ui.proc.loading) setUi((u) => ({ ...u, proc: { ...u.proc, loading: null } }));
      else setUi((u) => ({ ...u, pages: procKey(u.pages) }));
      return;
    }
    if (page === 'activeFpl' && fplCursor.index !== null) {
      const result = fplClr(fplCursor, plan.length);
      if (result.remove !== undefined) {
        const confirm = removeConfirm(plan, result.remove);
        if (confirm) setUi((u) => ({ ...u, popup: { kind: 'confirm', confirm } }));
      } else setFpl(result.cursor.entry !== fplCursor.entry ? result.cursor : FPL_CURSOR_OFF);
      return;
    }
    if (wptKind) {
      setUi((u) => ({ ...u, wpt: wptClr(u.wpt) }));
      return;
    }
    if (NRST_PAGES.includes(page)) setUi((u) => ({ ...u, nrst: NRST_START }));
  };

  const menu = () => {
    if (ui.popup?.kind === 'menu') {
      setUi((u) => ({ ...u, popup: null }));
      return;
    }
    if (ui.dto) return openPopupMenu(directToMenuItems(state.fms.activeLeg));
    switch (page) {
      case 'activeFpl':
        return openPopupMenu(fplMenuItems(plan.length, fplCursor.index));
      case 'navMap':
        return openPopupMenu([
          { id: 'mapSetup', label: 'Map Setup', enabled: false },
          { id: 'declutter', label: 'Declutter', enabled: true },
          { id: 'measure', label: 'Measure Bearing/Distance', enabled: false },
          { id: 'profile', label: ui.keys.map.profile ? 'Hide Profile View' : 'Show Profile View', enabled: true },
        ]);
      case 'nrstAirports':
        return openPopupMenu([
          { id: 'aptWindow', label: 'Select Airport Window', enabled: true },
          { id: 'rnwyWindow', label: 'Select Runway Window', enabled: true },
          { id: 'freqWindow', label: 'Select Frequency Window', enabled: true },
          { id: 'aprWindow', label: 'Select Approach Window', enabled: false },
        ]);
      default:
        return openPopupMenu([]);
    }
  };

  const directTo = () => {
    if (ui.dto) {
      setUi((u) => ({ ...u, dto: null }));
      return;
    }
    // Pre-filled from whatever the cursor or pointer is on, else the active waypoint.
    let ident = derived.gps.to?.ident ?? '';
    let planIndex: number | null = activeIndex;
    if (page === 'activeFpl' && fplCursor.index !== null && plan[fplCursor.index]) {
      ident = plan[fplCursor.index]!.ident;
      planIndex = fplCursor.index;
    } else if (wptKind && data.wpt) {
      ident = data.wpt.ident;
      planIndex = null;
    } else if (NRST_PAGES.includes(page) && page !== 'nrstFreq' && ui.nrst.item !== null && data.nearest[ui.nrst.item]) {
      ident = data.nearest[ui.nrst.item]!.ident;
      planIndex = null;
    } else if (page === 'navMap' && ui.pointer && data.pointerTarget) {
      ident = data.pointerTarget.ident;
      planIndex = null;
    }
    setUi((u) => ({ ...u, popup: null, dto: { dto: openDirectTo(ident), planIndex } }));
  };

  const softkey = (index: number) => {
    const tanks = state.aircraft.engine.fuelGal[0] + state.aircraft.engine.fuelGal[1];
    const out = pressMfdSoftkey(ui.keys, index, page, tanks);
    if (out.goTo) {
      const target = out.goTo;
      showPages((u) => goTo(u.pages, target));
    }
    setUi((u) => {
      let next: MfdUi = { ...u, keys: out.keys };
      switch (out.action) {
        case 'actLeg': {
          const confirm = fplMenuConfirm('activateLeg', plan, fplClamp(u.fpl.cursor, plan.length).index);
          if (confirm) next = { ...next, popup: { kind: 'confirm', confirm } };
          break;
        }
        case 'dp':
        case 'star':
        case 'apr':
          next = { ...next, wpt: { ...u.wpt, proc: out.action } };
          break;
        case 'apt':
          next = { ...next, nrst: nrstSection(u.nrst, 'list') };
          break;
        case 'rnwy':
          next = { ...next, nrst: nrstSection(u.nrst, 'runway') };
          break;
        case 'freq':
          next = { ...next, nrst: nrstSection(u.nrst, 'freq') };
          break;
        case 'check':
          next = { ...next, checklist: { ...checkItem(u.checklist), active: true } };
          break;
        case 'emergcy':
          next = { ...next, checklist: toggleEmergency(u.checklist) };
          break;
        case 'exit':
          next = { ...next, pages: goTo(u.pages, 'navMap') };
          break;
        case 'info':
          // From a procedure frame INFO brings the airport information back (without paging INFO-1/2).
          if (u.wpt.proc !== null) next = { ...next, keys: { ...next.keys, airportInfo2: u.keys.airportInfo2 }, wpt: { ...u.wpt, proc: null } };
          break;
      }
      return next;
    });
  };

  return {
    ...commonControls(state, derived, dispatch),
    range: (n) =>
      setUi((u) => (wptKind ? { ...u, infoRangeNm: stepG1000Range(u.infoRangeNm, n) } : { ...u, rangeNm: stepG1000Range(u.rangeNm, n) })),
    pan: () => {
      if (page === 'navMap') setUi((u) => ({ ...u, pointer: u.pointer ? null : { x: 0, y: 0 } }));
    },
    panMove: (dir) => setUi((u) => (u.pointer ? { ...u, pointer: movePointer(u.pointer, dir, PAGE.w, PAGE.h) } : u)),
    directTo,
    menu,
    fpl: () =>
      setUi((u) => ({ ...u, dto: null, popup: null, pages: fplKey(u.pages), keys: { ...u.keys, menu: 'page' }, fpl: { cursor: FPL_CURSOR_OFF, scroll: 0 } })),
    proc: () => setUi((u) => ({ ...u, dto: null, popup: null, pages: procKey(u.pages), proc: openProcedures() })),
    clr,
    clrHold: () =>
      setUi((u) => ({
        ...u,
        dto: null,
        popup: null,
        pointer: null,
        pages: goTo({ ...u.pages, proc: false }, 'navMap'),
        keys: { ...u.keys, menu: 'page' },
        wpt: { ...u.wpt, cursor: 'off', entry: null, proc: null },
        nrst: NRST_START,
      })),
    ent,
    fmsOuter: (n) => fms('outer', n),
    fmsInner: (n) => fms('inner', n),
    fmsPush: () => {
      if (ui.popup) return setUi((u) => ({ ...u, popup: null }));
      if (ui.dto) return setUi((u) => ({ ...u, dto: null }));
      if (page === 'activeFpl') return setFpl(fplCursor.index === null ? fplCursorOn(plan.length, activeIndex) : FPL_CURSOR_OFF);
      if (wptKind) return setUi((u) => ({ ...u, wpt: wptPush(u.wpt) }));
      if (NRST_PAGES.includes(page)) return setUi((u) => ({ ...u, nrst: nrstPush(u.nrst) }));
      if (page === 'checklist') return setUi((u) => ({ ...u, checklist: { ...u.checklist, active: !u.checklist.active } }));
    },
    softkey,
  };
}
