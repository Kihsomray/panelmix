import type { NavDatabase } from '../../../core/navdb';
import type { SimCommand } from '../../../sim/commands';
import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import type { PanelInfo } from '../../types';
import type { GduActions } from '../bezel/GduBezel';
import { movePointer, pointerTarget, stepG1000Range } from '../screen/MapView';
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
import { fplClamp, fplClr, fplCursorOn, fplEnt, fplInner, fplOuter, scrollToShow } from '../shared/flightPlan';
import {
  confirmCommands,
  directToMenuItems,
  fplMenuConfirm,
  fplMenuItems,
  removeConfirm,
  resolveWaypoint,
} from '../shared/fplActions';
import { confirmMove, menuMove, menuSelection, openMenu, type MenuItem } from '../shared/menu';
import { primaryCom } from '../shared/nearest';
import { openProcedures, type ProcKind } from '../shared/procedures';
import { setNavTuned } from '../shared/radioPanel';
import { getShared, updateShared } from '../shared/store';
import { codeFinish, codeKnobInner, codeKnobOuter } from '../shared/xpdrCode';
import { INSET_RECT } from './InsetMap';
import { endCodeEntry, pressPfdSoftkey, type PfdKeyContext } from './pfdSoftkeys';
import { moveListCursor, type PfdUi, type PfdWindow } from './pfdState';
import { DME_SOURCES, NRST_VISIBLE, PFD_FPL_ROWS } from './PfdWindows';
import { openTimerRef, referencesMenu, timerRefEnt, timerRefInner, timerRefOuter, type References } from './timerRef';

/*
 * Wires the PFD bezel to the PFD screen and the simulator. The FMS knob,
 * ENT, CLR and MENU act on the pop-up first (page menu or confirmation),
 * then on the open window, then on transponder code entry. Pure window
 * logic lives in the reducers; this file only routes.
 */

export interface PfdControlContext {
  readonly state: SimState;
  readonly derived: Derived;
  readonly dispatch: (cmd: SimCommand) => void;
  readonly db: NavDatabase;
  readonly panel: PanelInfo;
  readonly ui: PfdUi;
  readonly setUi: (fn: (ui: PfdUi) => PfdUi) => void;
  readonly keyContext: PfdKeyContext;
  /** Nearest airports in the NRST window, nearest first. */
  readonly nearestIdents: readonly string[];
  /** Flight plan and nearest identifiers for the Direct-to waypoint submenu. */
  readonly dtoLists: DirectToLists;
}

/** Minimums go to the simulator so every altitude tape shows the bug. */
function minimumsCommand(refs: References): SimCommand {
  return { type: 'minimums.set', ft: refs.minimumsOn ? refs.minimumsFt : null };
}

export function pfdControls(c: PfdControlContext): GduActions {
  const { state, derived, dispatch, db, ui, setUi } = c;
  const pos = { lat: state.aircraft.lat, lon: state.aircraft.lon };
  const plan = state.fms.plan;
  const activeIndex = state.fms.activeLeg?.planIndex ?? null;
  const resolves = (ident: string) => !!ident && db.find(ident).length > 0;
  const complete = (prefix: string) => db.complete(prefix)?.ident;
  const run = (cmds: readonly SimCommand[]) => {
    for (const cmd of cmds) dispatch(cmd);
  };
  const setWindow = (window: PfdWindow | null) => setUi((u) => ({ ...u, window, popup: null }));
  const openPopupMenu = (items: MenuItem[], title?: string) =>
    setUi((u) => ({ ...u, popup: { kind: 'menu', menu: openMenu(items, title) } }));

  const fplWindow = (): PfdWindow => {
    const cursor = fplCursorOn(plan.length, activeIndex);
    return { kind: 'fpl', cursor, scroll: scrollToShow(0, cursor.index, PFD_FPL_ROWS, plan.length + 1) };
  };

  const refsChanged = (refs: References) => {
    if (refs.minimumsOn !== ui.refs.minimumsOn || refs.minimumsFt !== ui.refs.minimumsFt) dispatch(minimumsCommand(refs));
  };

  const fms = (knob: 'outer' | 'inner', steps: number) => {
    const popup = ui.popup;
    if (popup) {
      setUi((u) => ({
        ...u,
        popup: popup.kind === 'menu' ? { kind: 'menu', menu: menuMove(popup.menu, steps) } : { kind: 'confirm', confirm: confirmMove(popup.confirm, steps) },
      }));
      return;
    }
    const code = ui.keys.code;
    if (code && ui.keys.menu === 'code') {
      const t = performance.now();
      setUi((u) => ({ ...u, keys: { ...u.keys, code: knob === 'inner' ? codeKnobInner(code, steps, t) : codeKnobOuter(code, steps, t) } }));
      return;
    }
    const w = ui.window;
    if (!w) return;
    switch (w.kind) {
      case 'nrst': {
        const count = c.nearestIdents.length * 2;
        const cursor = moveListCursor(w.cursor, knob === 'outer' ? steps * 2 : steps, count);
        const apt = cursor === null ? 0 : Math.floor(cursor / 2);
        const scroll = Math.min(Math.max(w.scroll, apt - NRST_VISIBLE + 1), apt);
        setWindow({ ...w, cursor, scroll: Math.max(scroll, 0) });
        return;
      }
      case 'tmrRef':
        if (knob === 'outer') setWindow({ ...w, w: timerRefOuter(w.w, steps) });
        else {
          const change = timerRefInner(w.w, ui.refs, steps, state.time);
          refsChanged(change.refs);
          setUi((u) => ({ ...u, refs: change.refs, window: { ...w, w: change.window } }));
        }
        return;
      case 'alerts':
        setWindow({ ...w, scroll: Math.min(Math.max(w.scroll + steps, 0), Math.max(state.messages.length - 1, 0)) });
        return;
      case 'dme': {
        const i = DME_SOURCES.indexOf(w.choice);
        setWindow({ ...w, choice: DME_SOURCES[(((i + steps) % 3) + 3) % 3]! });
        return;
      }
      case 'dto':
        setWindow({
          ...w,
          dto: knob === 'inner' ? directToInner(w.dto, steps, complete, c.dtoLists) : directToOuter(w.dto, steps, resolves, c.dtoLists),
        });
        return;
      case 'fpl': {
        const cur = fplClamp(w.cursor, plan.length);
        const cursor = knob === 'outer' ? fplOuter(cur, steps, plan.length) : fplInner(cur, steps, complete);
        setWindow({ ...w, cursor, scroll: scrollToShow(w.scroll, cursor.index, PFD_FPL_ROWS, plan.length + 1 + (cursor.entry ? 1 : 0)) });
        return;
      }
      case 'proc':
        if (!w.proc.loading) setWindow({ ...w, proc: { ...w.proc, menu: menuMove(w.proc.menu, steps) } });
        return;
    }
  };

  const menuChoice = (id: string) => {
    const w = ui.window;
    if (id === 'cancelDto') {
      dispatch({ type: 'fms.cancelDirectTo' });
      setWindow(null);
      return;
    }
    if (w?.kind === 'tmrRef') {
      const refs = referencesMenu(ui.refs, id);
      setUi((u) => ({ ...u, refs, popup: null }));
      return;
    }
    if (w?.kind === 'fpl') {
      const confirm = fplMenuConfirm(id, plan, fplClamp(w.cursor, plan.length).index);
      setUi((u) => ({ ...u, popup: confirm ? { kind: 'confirm', confirm } : null }));
      return;
    }
    setUi((u) => ({ ...u, popup: null }));
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
    const code = ui.keys.code;
    if (code && ui.keys.menu === 'code') {
      const finished = codeFinish(code);
      if (finished) dispatch({ type: 'xpdr.code', code: finished });
      setUi((u) => ({ ...u, keys: endCodeEntry(u.keys) }));
      return;
    }
    const w = ui.window;
    if (!w) return;
    switch (w.kind) {
      case 'nrst': {
        if (w.cursor === null) return;
        if (w.cursor % 2 === 1) {
          const apt = db.airport(c.nearestIdents[Math.floor(w.cursor / 2)] ?? '');
          const com = apt ? primaryCom(apt) : null;
          // Loads the airport's frequency into the COM standby with the tuning box.
          if (com) dispatch({ type: 'com.setStandby', radio: getShared().radio.comTuned, khz: com.khz });
        } else setWindow({ ...w, cursor: w.cursor + 1 });
        return;
      }
      case 'tmrRef': {
        const change = timerRefEnt(w.w, ui.refs, state.time);
        refsChanged(change.refs);
        setUi((u) => ({ ...u, refs: change.refs, window: { ...w, w: change.window } }));
        return;
      }
      case 'dme': {
        const holdKhz = w.choice === 'HOLD' ? dmeKhz(c) : ui.dme.holdKhz;
        setUi((u) => ({ ...u, dme: { source: w.choice, holdKhz }, window: null }));
        return;
      }
      case 'dto': {
        // A pick from the flight plan list joins the plan at that waypoint.
        const fromPlan = w.dto.list?.kind === 'FPL' ? w.dto.list.index : null;
        const result = directToEnt(w.dto, resolves, c.dtoLists);
        if (result.activate) {
          const wp = resolveWaypoint(db, result.activate, pos);
          if (wp) dispatch({ type: 'fms.directTo', waypoint: wp, planIndex: planIndexFor(plan, wp.ident, w.planIndex, activeIndex) });
          setWindow(null);
        } else if (result.state) setWindow({ ...w, dto: result.state, planIndex: fromPlan ?? w.planIndex });
        return;
      }
      case 'fpl': {
        const result = fplEnt(fplClamp(w.cursor, plan.length), resolves);
        if (result.insert) {
          const wp = resolveWaypoint(db, result.insert.ident, plan[result.insert.index] ?? plan[plan.length - 1] ?? pos);
          if (wp) dispatch({ type: 'fms.insert', index: result.insert.index, waypoint: wp });
        }
        setWindow({ ...w, cursor: result.cursor, scroll: scrollToShow(w.scroll, result.cursor.index, PFD_FPL_ROWS, plan.length + 2) });
        return;
      }
      case 'proc': {
        if (w.proc.loading) return;
        const id = menuSelection(w.proc.menu);
        if (id === 'approach' || id === 'arrival' || id === 'departure') setWindow({ ...w, proc: { ...w.proc, loading: id as ProcKind } });
        return;
      }
      case 'alerts':
        return;
    }
  };

  const clr = () => {
    if (ui.popup) {
      setUi((u) => ({ ...u, popup: null }));
      return;
    }
    const w = ui.window;
    if (!w) return;
    switch (w.kind) {
      case 'dto': {
        const result = directToClr(w.dto);
        setWindow(result.state ? { ...w, dto: result.state } : null);
        return;
      }
      case 'fpl': {
        const result = fplClr(fplClamp(w.cursor, plan.length), plan.length);
        if (result.remove !== undefined) {
          const confirm = removeConfirm(plan, result.remove);
          if (confirm) setUi((u) => ({ ...u, popup: { kind: 'confirm', confirm } }));
        } else if (result.cursor.entry !== w.cursor.entry) setWindow({ ...w, cursor: result.cursor });
        else setWindow(null);
        return;
      }
      case 'proc':
        setWindow(w.proc.loading ? { ...w, proc: { ...w.proc, loading: null } } : null);
        return;
      default:
        setWindow(null);
    }
  };

  const menu = () => {
    if (ui.popup?.kind === 'menu') {
      setUi((u) => ({ ...u, popup: null }));
      return;
    }
    const w = ui.window;
    if (w?.kind === 'fpl') openPopupMenu(fplMenuItems(plan.length, fplClamp(w.cursor, plan.length).index));
    else if (w?.kind === 'dto') openPopupMenu(directToMenuItems(state.fms.activeLeg));
    else if (w?.kind === 'tmrRef')
      openPopupMenu([
        { id: 'allOn', label: 'All References On', enabled: true },
        { id: 'allOff', label: 'All References Off', enabled: true },
        { id: 'defaults', label: 'Restore Defaults', enabled: true },
      ]);
    else openPopupMenu([]);
  };

  const directTo = () => {
    const w = ui.window;
    if (w?.kind === 'dto') {
      setWindow(null);
      return;
    }
    // Pre-filled from the waypoint under a cursor, else the active waypoint.
    let ident = derived.gps.to?.ident ?? '';
    let planIndex: number | null = activeIndex;
    if (w?.kind === 'fpl') {
      const i = fplClamp(w.cursor, plan.length).index;
      if (i !== null && plan[i]) {
        ident = plan[i]!.ident;
        planIndex = i;
      }
    } else if (w?.kind === 'nrst' && w.cursor !== null) {
      ident = c.nearestIdents[Math.floor(w.cursor / 2)] ?? ident;
      planIndex = null;
    } else if (ui.pointer && ui.keys.settings.inset) {
      const target = pointerTarget(db, { ...insetMapView(c), w: INSET_RECT.w, h: INSET_RECT.h }, ui.pointer);
      if (target) {
        ident = target.ident;
        planIndex = null;
      }
    }
    setUi((u) => ({ ...u, popup: null, window: { kind: 'dto', dto: openDirectTo(ident), planIndex } }));
  };

  const toggle = (kind: PfdWindow['kind'], open: () => PfdWindow) => setWindow(ui.window?.kind === kind ? null : open());

  return {
    ...commonControls(state, derived, dispatch),
    range: (n) => setUi((u) => ({ ...u, insetRangeNm: stepG1000Range(u.insetRangeNm, n) })),
    pan: () => setUi((u) => ({ ...u, pointer: u.pointer || !u.keys.settings.inset ? null : { x: 0, y: 0 } })),
    panMove: (dir) => setUi((u) => (u.pointer ? { ...u, pointer: movePointer(u.pointer, dir, INSET_RECT.w, INSET_RECT.h) } : u)),
    directTo,
    menu,
    fpl: () => toggle('fpl', fplWindow),
    proc: () => toggle('proc', () => ({ kind: 'proc', proc: openProcedures() })),
    clr,
    clrHold: clr,
    ent,
    fmsOuter: (n) => fms('outer', n),
    fmsInner: (n) => fms('inner', n),
    fmsPush: () => {
      if (ui.popup) {
        setUi((u) => ({ ...u, popup: null }));
        return;
      }
      const w = ui.window;
      if (w?.kind === 'nrst') setWindow({ ...w, cursor: w.cursor === null ? 0 : null });
      else if (w?.kind === 'dto' || w?.kind === 'fpl' || w?.kind === 'proc') setWindow(null);
    },
    softkey: (index) => {
      const out = pressPfdSoftkey(ui.keys, index, c.keyContext);
      run(out.commands);
      if (out.tuneNav !== undefined) {
        const radio = out.tuneNav;
        updateShared((s) => ({ ...s, radio: setNavTuned(s.radio, radio) }));
      }
      if (out.keys.settings.baroHpa !== ui.keys.settings.baroHpa) {
        const hpa = out.keys.settings.baroHpa;
        updateShared((s) => ({ ...s, baroHpa: hpa }));
      }
      setUi((u) => {
        let window = u.window;
        if (out.toggleWindow) {
          const kind = out.toggleWindow;
          window =
            window?.kind === kind
              ? null
              : kind === 'nrst'
                ? { kind, cursor: null, scroll: 0 }
                : kind === 'tmrRef'
                  ? { kind, w: openTimerRef(u.refs) }
                  : kind === 'alerts'
                    ? { kind, scroll: 0 }
                    : { kind: 'dme', choice: u.dme.source };
        }
        const pointer = out.keys.settings.inset ? u.pointer : null;
        return { ...u, keys: out.keys, window, popup: out.toggleWindow ? null : u.popup, pointer };
      });
    },
  };
}

/** What the softkey logic needs to know about the simulator. */
export function pfdKeyContext(state: SimState, panel: PanelInfo, now: number): PfdKeyContext {
  const unread = state.messages.filter((m) => !m.read);
  return {
    xpdrMode: state.xpdr.mode,
    bearing1: state.nav.bearing1,
    bearing2: state.nav.bearing2,
    cdiSource: state.nav.cdiSource,
    cdiSources: panel.cdiSources,
    obsAvailable: state.nav.cdiSource === 'GPS' && state.fms.activeLeg !== null,
    obsMode: state.fms.obsMode,
    baroStd: state.bugs.baroStd,
    alert: unread.length === 0 ? null : unread.some((m) => m.level === 'caution') ? 'caution' : 'advisory',
    now,
  };
}

/** The frequency the DME would hold now (HOLD keeps it when the NAV is retuned). */
export function dmeKhz(c: Pick<PfdControlContext, 'state' | 'ui'>): number | null {
  const source = c.ui.dme.source;
  if (source === 'HOLD') return c.ui.dme.holdKhz;
  return c.state.radios.nav[source === 'NAV1' ? 0 : 1].activeKhz;
}

/** Inset map geometry shared by the screen and the pointer lookup. */
export function insetMapView(c: Pick<PfdControlContext, 'state' | 'ui'>) {
  const a = c.state.aircraft;
  return {
    ownship: { lat: a.lat, lon: a.lon, headingTrue: a.headingTrue, trackTrue: a.trackTrue },
    rangeNm: c.ui.insetRangeNm,
    orientation: 'track' as const,
  };
}
