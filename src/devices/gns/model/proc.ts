import { distanceNm } from '../../../core/geo';
import { NavDatabase, type Waypoint } from '../../../core/navdb';
import { shortApproachName, type AirportProcedures, type Approach, type ProcTransition, type TerminalProcedure } from '../../../core/procedures';
import type { SimCommand } from '../../../sim/commands';
import { approachIndices } from '../../../sim/fms';
import { procFixWaypoint } from '../../../sim/fms/procedure';
import type { FmsState } from '../../../sim/types';
import { item, step, type PageLogic } from './page';
import { PAGES } from './pages';
import type { ApproachLoad, ChoiceOption, GnsCtx, GnsUi, MenuItem, Popup, ProcField, ProcUi, Step } from './types';

/*
 * Instrument procedures (Section 5 and the WPT airport approach, arrival
 * and departure pages). PROC opens the PROCEDURES page; "Select Approach?"
 * shows the destination's approach page with the APR window open, then the
 * TRANS window, then "Load?" / "Activate?". Approaches not approved for GPS
 * ask for the monitoring-only reminder first, ILS and LOC approaches put the
 * localizer in the VLOC standby, and reactivating the approach being flown
 * asks before discontinuing it. Departures and arrivals are not flown by the
 * trainer's FMS: loading one adds its fixes to the enroute flight plan.
 */

export const INITIAL_PROC: ProcUi = {
  flow: null,
  waiting: false,
  airport: null,
  approach: null,
  transition: null,
  arrival: null,
  arrivalTrans: null,
  arrivalRunway: null,
  departure: null,
  departureRunway: null,
  departureTrans: null,
};

/** The context these functions read. */
type ProcCtx = Pick<GnsCtx, 'state' | 'nearest' | 'db' | 'procedures'>;

// Names --------------------------------------------------------------------------

const GPS_TYPES = new Set(['RNAV', 'RNP', 'GPS']);

/** Approaches the GPS may fly ("GPS" after the name); the others are monitoring only. */
export const gpsApproved = (a: Approach) => GPS_TYPES.has(a.type);

/** ILS, LOC, LDA and SDF approaches: flown on the VLOC receiver's localizer. */
export const usesLocalizer = (a: Approach) => !!a.localizer && ['ILS', 'LOC', 'LOC BC', 'LDA', 'SDF', 'IGS'].includes(a.type);

/** The unit's approach name: type, runway, then the chart letter ("RNAV 31 Z", "ILS 17", "VOR-A"). */
export function gnsApproachName(a: Approach): string {
  if (!a.runway) return shortApproachName(a);
  const suffix = a.id.match(/-([A-Z])$/)?.[1];
  return `${a.type} ${a.runway}${suffix ? ` ${suffix}` : ''}`;
}

/**
 * The approaches a GNS database carries: not RNP AR ("RNAV (RNP)", coded H)
 * or GLS approaches, which the unit cannot fly.
 */
export const gnsApproaches = (p: AirportProcedures): readonly Approach[] => p.approaches.filter((a) => a.type !== 'RNP' && a.type !== 'GLS');

/** A transition that starts at an initial approach fix gets the "IA" designator in the TRANS window. */
const startsAtIaf = (t: ProcTransition) => t.legs.some((l) => l.iaf);

// Airports -------------------------------------------------------------------------

/**
 * The airport arrivals and approaches are offered for: the loaded approach's
 * airport, the flight plan's last airport, the direct-to airport, else the
 * nearest one.
 */
export function destinationAirport(ctx: ProcCtx): Waypoint | null {
  const fms = ctx.state.fms;
  if (fms.approach) return fms.approach.airport;
  const last = fms.plan[fms.plan.length - 1];
  if (last?.kind === 'airport') return last;
  const to = fms.activeLeg?.to;
  if (to?.kind === 'airport') return to;
  const near = ctx.nearest.airports[0];
  return near ? NavDatabase.toWaypoint(near) : null;
}

/** "When a direct-to destination is selected, departures are offered for the nearest airport." */
export function departureAirport(ctx: ProcCtx): Waypoint | null {
  const first = ctx.state.fms.plan[0];
  if (first?.kind === 'airport' && ctx.state.fms.plan.length > 1) return first;
  const near = ctx.nearest.airports[0];
  return near ? NavDatabase.toWaypoint(near) : null;
}

/** The airport's procedures: undefined while the file loads, null when it has none. */
export function proceduresOf(ctx: Pick<GnsCtx, 'procedures'>, airport: Waypoint | null): AirportProcedures | null | undefined {
  if (!airport || !ctx.procedures) return null;
  return ctx.procedures.get(airport.ident);
}

// Selections ------------------------------------------------------------------------

export interface ApproachSelection {
  readonly approach: Approach;
  /** null is VECTORS. */
  readonly transition: string | null;
}

/** What the approach page shows: the pilot's choice, else the loaded approach, else the first one. */
export function selectedApproach(ui: GnsUi, fms: FmsState, airport: Waypoint, p: AirportProcedures): ApproachSelection | null {
  const list = gnsApproaches(p);
  const first = list[0];
  if (!first) return null;
  const mine = ui.proc.airport === airport.ident && ui.proc.approach !== null;
  const loaded = fms.approach && fms.approach.airport.ident === airport.ident ? fms.approach : null;
  const id = mine ? ui.proc.approach : loaded?.approach.id ?? first.id;
  const approach = list.find((a) => a.id === id) ?? first;
  const wanted = mine ? ui.proc.transition : loaded?.approach.id === approach.id ? loaded.transition : null;
  const transition = wanted !== null && approach.transitions.some((t) => t.name === wanted) ? wanted : null;
  return { approach, transition };
}

export interface TerminalSelection {
  readonly proc: TerminalProcedure;
  readonly transition: string | null;
  readonly runway: string | null;
}

const pickName = (list: readonly ProcTransition[], wanted: string | null) =>
  wanted !== null && list.some((t) => t.name === wanted) ? wanted : list[0]?.name ?? null;

export function selectedArrival(ui: GnsUi, airport: Waypoint, p: AirportProcedures): TerminalSelection | null {
  const mine = ui.proc.airport === airport.ident;
  const star = (mine && p.arrivals.find((x) => x.id === ui.proc.arrival)) || p.arrivals[0];
  if (!star) return null;
  const same = mine && ui.proc.arrival === star.id;
  return {
    proc: star,
    transition: pickName(star.enrouteTransitions, same ? ui.proc.arrivalTrans : null),
    runway: pickName(star.runwayTransitions, same ? ui.proc.arrivalRunway : null),
  };
}

export function selectedDeparture(ui: GnsUi, airport: Waypoint, p: AirportProcedures): TerminalSelection | null {
  const mine = ui.proc.airport === airport.ident;
  const sid = (mine && p.departures.find((x) => x.id === ui.proc.departure)) || p.departures[0];
  if (!sid) return null;
  const same = mine && ui.proc.departure === sid.id;
  return {
    proc: sid,
    transition: pickName(sid.enrouteTransitions, same ? ui.proc.departureTrans : null),
    runway: pickName(sid.runwayTransitions, same ? ui.proc.departureRunway : null),
  };
}

// Windows ---------------------------------------------------------------------------------

const names = (list: readonly ProcTransition[], none: string): ChoiceOption[] =>
  list.length > 0 ? list.map((t) => ({ value: t.name, label: t.name })) : [{ value: null, label: none }];

/** The choices of a procedure field's window, and which one is selected now. */
export function fieldOptions(ui: GnsUi, fms: FmsState, field: ProcField, airport: Waypoint, p: AirportProcedures): { options: ChoiceOption[]; selected: string | null } {
  switch (field) {
    case 'approach': {
      const sel = selectedApproach(ui, fms, airport, p);
      return { options: gnsApproaches(p).map((a) => ({ value: a.id, label: gnsApproachName(a), gps: gpsApproved(a) })), selected: sel?.approach.id ?? null };
    }
    case 'transition': {
      const sel = selectedApproach(ui, fms, airport, p);
      const options: ChoiceOption[] = [
        { value: null, label: 'VECTORS' },
        ...(sel?.approach.transitions ?? []).map((t) => ({ value: t.name, label: t.name, ...(startsAtIaf(t) && { tag: 'IA' }) })),
      ];
      return { options, selected: sel?.transition ?? null };
    }
    case 'arrival':
    case 'arrivalTrans':
    case 'arrivalRunway': {
      const sel = selectedArrival(ui, airport, p);
      if (field === 'arrival') return { options: p.arrivals.map((x) => ({ value: x.id, label: x.name })), selected: sel?.proc.id ?? null };
      if (field === 'arrivalTrans') return { options: names(sel?.proc.enrouteTransitions ?? [], 'NONE'), selected: sel?.transition ?? null };
      return { options: names(sel?.proc.runwayTransitions ?? [], 'ALL'), selected: sel?.runway ?? null };
    }
    default: {
      const sel = selectedDeparture(ui, airport, p);
      if (field === 'departure') return { options: p.departures.map((x) => ({ value: x.id, label: x.name })), selected: sel?.proc.id ?? null };
      if (field === 'departureRunway') return { options: names(sel?.proc.runwayTransitions ?? [], 'ALL'), selected: sel?.runway ?? null };
      return { options: names(sel?.proc.enrouteTransitions ?? [], 'NONE'), selected: sel?.transition ?? null };
    }
  }
}

/** Opens a field's window with its current choice highlighted (or does nothing while the data loads). */
export function openField(ui: GnsUi, ctx: ProcCtx, field: ProcField, airport: Waypoint): GnsUi {
  const p = proceduresOf(ctx, airport);
  if (!p) return ui;
  const { options, selected } = fieldOptions(ui, ctx.state.fms, field, airport, p);
  if (options.length === 0) return ui;
  const index = Math.max(options.findIndex((o) => o.value === selected), 0);
  return { ...ui, popup: { kind: 'choice', field, options, index } };
}

/** The selection after a choice in a field's window: later fields of the same procedure go back to their first entry. */
export function choose(proc: ProcUi, airport: string, field: ProcField, value: string | null): ProcUi {
  const base: ProcUi = proc.airport === airport ? proc : { ...INITIAL_PROC, flow: proc.flow, airport };
  switch (field) {
    case 'approach':
      return { ...base, airport, approach: value, transition: null };
    case 'transition':
      return { ...base, airport, transition: value };
    case 'arrival':
      return { ...base, airport, arrival: value, arrivalTrans: null, arrivalRunway: null };
    case 'arrivalTrans':
      return { ...base, airport, arrivalTrans: value };
    case 'arrivalRunway':
      return { ...base, airport, arrivalRunway: value };
    case 'departure':
      return { ...base, airport, departure: value, departureRunway: null, departureTrans: null };
    case 'departureRunway':
      return { ...base, airport, departureRunway: value };
    case 'departureTrans':
      return { ...base, airport, departureTrans: value };
  }
}

// The procedure pages ------------------------------------------------------------------

export type ProcPageKind = 'approach' | 'arrival' | 'departure';

const PAGE_OF: Record<ProcPageKind, 'wpt.apr' | 'wpt.arvl' | 'wpt.dep'> = { approach: 'wpt.apr', arrival: 'wpt.arvl', departure: 'wpt.dep' };
const FIRST_FIELD: Record<ProcPageKind, ProcField> = { approach: 'approach', arrival: 'arrival', departure: 'departure' };

/** The fields of each page, in cursor order after the identifier. */
export const PAGE_FIELDS: Record<ProcPageKind, readonly ProcField[]> = {
  approach: ['approach', 'transition'],
  arrival: ['arrival', 'arrivalTrans', 'arrivalRunway'],
  departure: ['departure', 'departureRunway', 'departureTrans'],
};

/** Buttons after the fields while the page was reached with PROC: "Load?" (and "Activate?" for approaches). */
export const flowButtons = (kind: ProcPageKind): readonly ('load' | 'activate')[] => (kind === 'approach' ? ['load', 'activate'] : ['load']);

export function hasProcedures(kind: ProcPageKind, p: AirportProcedures | null | undefined): boolean {
  if (!p) return false;
  return (kind === 'approach' ? gnsApproaches(p) : kind === 'arrival' ? p.arrivals : p.departures).length > 0;
}

/** Cursor stops between the identifier and "Done?". */
export function procMiddleStops(kind: ProcPageKind, ui: GnsUi, ctx: ProcCtx, airport: Waypoint | null): number {
  if (!hasProcedures(kind, proceduresOf(ctx, airport))) return 0;
  return PAGE_FIELDS[kind].length + (ui.proc.flow === kind ? flowButtons(kind).length : 0);
}

/**
 * PROC "Select Approach?" (or arrival, departure): the airport's procedure
 * page with the cursor on the procedure name and its window open.
 */
export function openProcPage(ui: GnsUi, ctx: ProcCtx, kind: ProcPageKind): GnsUi {
  const airport = kind === 'departure' ? departureAirport(ctx) : destinationAirport(ctx);
  if (!airport) return { ...ui, popup: { kind: 'notice', title: 'PROCEDURES', lines: ['No airport', 'Select a destination first.'] } };
  const page = PAGE_OF[kind];
  const waiting = proceduresOf(ctx, airport) === undefined;
  const proc: ProcUi = ui.proc.airport === airport.ident ? { ...ui.proc, flow: kind, waiting } : { ...INITIAL_PROC, flow: kind, waiting, airport: airport.ident };
  const shown: GnsUi = {
    ...ui,
    fn: null,
    group: 'WPT',
    pages: { ...ui.pages, WPT: Math.max(PAGES[ui.model].WPT.indexOf(page), 0) },
    wpt: { ...ui.wpt, airport, runway: 0 },
    wptReturn: null,
    stack: [],
    entry: null,
    popup: null,
    proc,
    scroll: 0,
    cursor: 1,
  };
  return openField(shown, ctx, FIRST_FIELD[kind], airport);
}

/**
 * PROC "Select Approach?" before the airport's procedures had loaded: the
 * window opens as soon as they arrive, unless the pilot has moved on.
 */
export function resumeFlow(ui: GnsUi, ctx: ProcCtx): GnsUi {
  const kind = ui.proc.flow;
  const airport = ui.wpt.airport;
  if (!kind || !ui.proc.waiting || !airport || proceduresOf(ctx, airport) === undefined) return ui;
  const done: GnsUi = { ...ui, proc: { ...ui.proc, waiting: false } };
  const onPage = ui.fn === null && ui.group === 'WPT' && PAGES[ui.model].WPT[ui.pages.WPT] === PAGE_OF[kind];
  if (!onPage || ui.popup || ui.entry || ui.cursor !== 1) return done;
  return openField(done, ctx, FIRST_FIELD[kind], airport);
}

/** ENT on a choice: store it and, in the PROC flow, open the next window (or highlight "Load?"). */
export function chooseField(ui: GnsUi, ctx: ProcCtx, kind: ProcPageKind, airport: Waypoint, field: ProcField, value: string | null): GnsUi {
  const proc = choose(ui.proc, airport.ident, field, value);
  const fields = PAGE_FIELDS[kind];
  const i = fields.indexOf(field);
  const next = fields[i + 1];
  const chosen: GnsUi = { ...ui, popup: null, proc, cursor: 1 + Math.min(i + 1, fields.length - 1) };
  if (ui.proc.flow !== kind) return chosen;
  if (next) return openField(chosen, ctx, next, airport);
  return { ...chosen, cursor: 1 + fields.length };
}

// Loading ----------------------------------------------------------------------------------

/** Whether the approach to load is the one being flown, short of the MAP: reactivating it starts over. */
function restartsFlown(fms: FmsState, load: ApproachLoad | null): boolean {
  const a = fms.approach;
  const leg = fms.activeLeg;
  if (!a || !a.activated || !leg || leg.approachIndex === null || leg.approachIndex === undefined || fms.suspended) return false;
  if (load && (load.airport.ident !== a.airport.ident || load.approachId !== a.approach.id)) return false;
  const map = approachIndices(a.legs).map;
  return map === null || leg.approachIndex <= map;
}

/** The selection on the approach page as a load request. */
export function approachRequest(ui: GnsUi, ctx: ProcCtx, airport: Waypoint, mode: ApproachLoad['mode']): ApproachLoad | null {
  const p = proceduresOf(ctx, airport);
  const sel = p ? selectedApproach(ui, ctx.state.fms, airport, p) : null;
  return sel ? { airport, approachId: sel.approach.id, transition: sel.transition, mode } : null;
}

/** "Load?" / "Activate?": the reminder or restart windows first when the real unit asks. */
export function requestApproach(ui: GnsUi, ctx: ProcCtx, load: ApproachLoad): Step {
  const a = proceduresOf(ctx, load.airport)?.approaches.find((x) => x.id === load.approachId);
  if (!a) return step(ui);
  if (load.mode === 'activate' && restartsFlown(ctx.state.fms, load)) {
    return step({ ...ui, popup: { kind: 'procConfirm', reason: 'restart', load, yes: true } });
  }
  if (!gpsApproved(a)) return step({ ...ui, popup: { kind: 'procConfirm', reason: 'monitor', load, yes: true } });
  return executeLoad(ui, ctx, load);
}

/**
 * Loads (and activates) the approach. "When you Load? (or Activate?) an ILS
 * approach, the ILS frequency is automatically placed in the standby field of
 * the VLOC window." The active flight plan page appears.
 */
export function executeLoad(ui: GnsUi, ctx: ProcCtx, load: ApproachLoad): Step {
  const a = proceduresOf(ctx, load.airport)?.approaches.find((x) => x.id === load.approachId);
  if (!a) return step({ ...ui, popup: null });
  const activate = load.mode === 'load' ? 'load' : load.transition === null ? 'vtf' : 'activate';
  const cmds: SimCommand[] = [{ type: 'fms.loadApproach', airport: load.airport, approach: a, transition: load.transition, activate }];
  const loc = a.localizer ? ctx.db.localizer(a.localizer) : undefined;
  if (loc && usesLocalizer(a)) cmds.push({ type: 'nav.setStandby', radio: 0, khz: loc.freqKhz });
  const shown: GnsUi = { ...ui, popup: null, entry: null, fn: 'fpl', fplPage: 0, cursor: null, scroll: 0, stack: [], proc: { ...ui.proc, flow: null } };
  return step(shown, cmds);
}

/** PROC "Activate Approach?": activates the loaded approach (asking first when it would restart the one being flown). */
function activateLoaded(ui: GnsUi, ctx: ProcCtx): Step {
  if (restartsFlown(ctx.state.fms, null)) return step({ ...ui, popup: { kind: 'procConfirm', reason: 'restart', load: null, yes: true } });
  return step(closeProc(ui), [{ type: 'fms.activateApproach', vectorsToFinal: false }]);
}

const closeProc = (ui: GnsUi): GnsUi => ({ ...ui, fn: null, cursor: null, scroll: 0, popup: null });

/** "Yes?" in a procedure window. */
export function confirmProc(ui: GnsUi, ctx: ProcCtx, popup: Extract<Popup, { kind: 'procConfirm' }>): Step {
  const closed = { ...ui, popup: null };
  if (!popup.yes) return step(closed);
  if (!popup.load) return step(closeProc(closed), [{ type: 'fms.activateApproach', vectorsToFinal: false }]);
  return executeLoad(closed, ctx, popup.load);
}

/** The fixes of a departure or arrival in flying order (runways and airports left out). */
export function terminalFixes(proc: TerminalProcedure, runway: string | null, transition: string | null, db: NavDatabase): Waypoint[] {
  const rw = proc.runwayTransitions.find((t) => t.name === runway)?.legs ?? [];
  const en = proc.enrouteTransitions.find((t) => t.name === transition)?.legs ?? [];
  // A SID starts at the runway; a STAR starts at its enroute transition.
  const legs = proc.kind === 'SID' ? [...rw, ...proc.common, ...en] : [...en, ...proc.common, ...rw];
  const out: Waypoint[] = [];
  for (const l of legs) {
    if (!l.fix || l.fix.kind === 'runway' || l.fix.kind === 'airport') continue;
    const wp = procFixWaypoint(l.fix, db);
    const last = out[out.length - 1];
    if (last && last.ident === wp.ident && distanceNm(last, wp) < 0.5) continue;
    out.push(wp);
  }
  return out;
}

/**
 * Loading a departure or an arrival: its fixes go into the enroute plan
 * (after the departure airport, or before the destination), since the
 * trainer's FMS flies approaches but not SIDs and STARs as procedures.
 */
export function loadTerminal(ui: GnsUi, ctx: ProcCtx, kind: 'arrival' | 'departure', airport: Waypoint): Step {
  const p = proceduresOf(ctx, airport);
  const sel = p ? (kind === 'arrival' ? selectedArrival(ui, airport, p) : selectedDeparture(ui, airport, p)) : null;
  if (!sel) return step(ui);
  const fixes = terminalFixes(sel.proc, sel.runway, sel.transition, ctx.db);
  const plan = ctx.state.fms.plan;
  const cmds: SimCommand[] = [];
  if (kind === 'departure') {
    let at = 0;
    if (plan[0]?.ident === airport.ident) at = 1;
    else cmds.push({ type: 'fms.insert', index: at++, waypoint: airport });
    fixes.forEach((wp, i) => cmds.push({ type: 'fms.insert', index: at + i, waypoint: wp }));
  } else {
    const last = plan[plan.length - 1];
    const at = last && last.ident === airport.ident ? plan.length - 1 : plan.length;
    fixes.forEach((wp, i) => cmds.push({ type: 'fms.insert', index: at + i, waypoint: wp }));
  }
  const shown: GnsUi = { ...ui, popup: null, fn: 'fpl', fplPage: 0, cursor: null, scroll: 0, stack: [], proc: { ...ui.proc, flow: null } };
  return step(shown, cmds);
}

/** Menu of the approach, arrival and departure pages. */
export function procPageMenu(kind: ProcPageKind, available: boolean): readonly MenuItem[] {
  return [
    item('Load into Active FPL?', 'proc.loadIntoFpl', available),
    ...(kind === 'approach' ? [item('Load and Activate?', 'proc.loadAndActivate', available), item('Select Approach Chnl?', 'none', false)] : []),
    item('Select Next FPL Apt?', 'none', false),
    item('Select Destination Apt?', 'proc.destination'),
  ];
}

// The PROCEDURES page -------------------------------------------------------------------

export type ProcItem = 'vtf' | 'activate' | 'approach' | 'arrival' | 'departure';

export const PROC_ITEMS: readonly { readonly item: ProcItem; readonly label: string }[] = [
  { item: 'vtf', label: 'Activate Vector-To-Final?' },
  { item: 'activate', label: 'Activate Approach?' },
  { item: 'approach', label: 'Select Approach?' },
  { item: 'arrival', label: 'Select Arrival?' },
  { item: 'departure', label: 'Select Departure?' },
];

/** The items the cursor can reach: the two "Activate" lines only with an approach loaded. */
export function procItems(fms: FmsState): ProcItem[] {
  const a = fms.approach;
  const vtf = a !== null && approachIndices(a.legs).faf !== null;
  return PROC_ITEMS.map((x) => x.item).filter((x) => (x === 'vtf' ? vtf : x === 'activate' ? a !== null : true));
}

export const procPage: PageLogic = {
  stops: (_ui, ctx) => procItems(ctx.state.fms).length,
  // With an approach loaded the cursor starts on "Activate Approach?", otherwise "Select Approach?".
  first: (_ui, ctx) => {
    const items = procItems(ctx.state.fms);
    const i = items.indexOf('activate');
    return i >= 0 ? i : Math.max(items.indexOf('approach'), 0);
  },
  ent: (ui, ctx, stop) => {
    switch (procItems(ctx.state.fms)[stop]) {
      case 'vtf':
        return step(closeProc(ui), [{ type: 'fms.activateApproach', vectorsToFinal: true }]);
      case 'activate':
        return activateLoaded(ui, ctx);
      case 'approach':
        return step(openProcPage(ui, ctx, 'approach'));
      case 'arrival':
        return step(openProcPage(ui, ctx, 'arrival'));
      case 'departure':
        return step(openProcPage(ui, ctx, 'departure'));
      default:
        return null;
    }
  },
};
