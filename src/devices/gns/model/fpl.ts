import { NavDatabase, type AnyWaypoint } from '../../../core/navdb';
import type { RouteLeg } from '../../../sim/fms/types';
import type { FmsState } from '../../../sim/types';
import { startEntry, turnSmall } from '../../../ui/identEntry';
import { completer } from './data';
import { item, LIST_ROWS, step, type PageLogic } from './page';
import { gnsApproachName } from './proc';
import type { GnsUi, PageId, Step } from './types';

/*
 * FPL key (Section 4). The active flight plan page lists the enroute
 * waypoints with DTK and DIS, then a loaded approach under its own header
 * ("Approach RNAV 17") with each leg and its designator (IA, FA, MA, MH);
 * a magenta arrow marks the active leg. With the cursor on an enroute
 * waypoint the small knob starts entering a new one in front of it, CLR
 * offers to remove it, D-> flies to it. On an approach leg D-> flies to its
 * fix (joining the approach there) and MENU "Activate Leg?" flies the leg.
 * CLR on the approach header offers to remove the approach.
 */

export type FplRow =
  | { readonly kind: 'wp'; readonly index: number }
  /** The empty line after the enroute waypoints, where new ones are added. */
  | { readonly kind: 'blank' }
  | { readonly kind: 'header' }
  | { readonly kind: 'leg'; readonly index: number };

/** The rows of the page, also its cursor stops. */
export function fplRows(fms: FmsState): FplRow[] {
  const rows: FplRow[] = fms.plan.map((_, index) => ({ kind: 'wp', index }));
  rows.push({ kind: 'blank' });
  if (fms.approach) {
    rows.push({ kind: 'header' });
    fms.approach.legs.forEach((_, index) => rows.push({ kind: 'leg', index }));
  }
  return rows;
}

/** The row of the active leg's waypoint, if it is on the page. */
export function activeRow(fms: FmsState): number | null {
  const leg = fms.activeLeg;
  if (!leg) return null;
  if (leg.approachIndex !== null && leg.approachIndex !== undefined) return fms.plan.length + 2 + leg.approachIndex;
  return leg.planIndex;
}

/** Waypoint designators shown in magenta after approach fixes. */
export const ROLE_TAG: Partial<Record<NonNullable<RouteLeg['role']>, string>> = { IAF: 'IA', FAF: 'FA', MAP: 'MA', MAHP: 'MH' };

/** How a leg reads in the list: the fix, or the leg's own label in the unit's lower case ("hold", "man seq"). */
export function legName(leg: RouteLeg): string {
  switch (leg.label) {
    case 'HOLD':
      return 'hold';
    case 'MANSEQ':
      return 'man seq';
    case 'INTRCPT':
      return 'intrcpt';
    case 'PROC TURN':
      return 'proc turn';
    default:
      return leg.to && !leg.label.endsWith('ft') ? leg.to.ident : leg.label;
  }
}

export const approachHeader = (fms: FmsState) => (fms.approach ? `Approach ${gnsApproachName(fms.approach.approach)}` : '');

const rowAt = (ui: GnsUi, fms: FmsState) => (ui.cursor === null ? null : fplRows(fms)[ui.cursor] ?? null);

const activeFpl: PageLogic = {
  stops: (_ui, ctx) => fplRows(ctx.state.fms).length,
  first: (_ui, ctx) => activeRow(ctx.state.fms) ?? 0,
  list: (ui, ctx) => ({ header: 0, perRow: 1, visible: LIST_ROWS[ui.model].fpl, rows: fplRows(ctx.state.fms).length }),
  small: (ui, ctx, stop, steps) => {
    const row = fplRows(ctx.state.fms)[stop];
    // Waypoints go into the enroute part; the approach is changed from the PROC pages.
    if (!row || (row.kind !== 'wp' && row.kind !== 'blank')) return null;
    const index = row.kind === 'wp' ? row.index : ctx.state.fms.plan.length;
    const e = turnSmall(startEntry(''), steps, completer(ctx.db, null));
    return step({ ...ui, entry: { target: { kind: 'fpl', index }, e } });
  },
  clr: (ui, ctx, stop) => {
    const row = stop === null ? null : fplRows(ctx.state.fms)[stop];
    if (row?.kind === 'wp') return step({ ...ui, popup: { kind: 'confirm', action: 'fpl.remove', index: row.index, yes: true } });
    if (row?.kind === 'header') return step({ ...ui, popup: { kind: 'confirm', action: 'fpl.removeApproach', index: 0, yes: true } });
    return null;
  },
  dto: (ui, ctx) => {
    const fms = ctx.state.fms;
    const row = rowAt(ui, fms);
    if (row?.kind === 'wp') return { wp: fms.plan[row.index]!, planIndex: row.index };
    if (row?.kind === 'leg') {
      const to = fms.approach?.legs[row.index]?.to;
      return to ? { wp: to, planIndex: null } : null;
    }
    return null;
  },
  menu: (ui, ctx) => {
    const fms = ctx.state.fms;
    const n = fms.plan.length;
    const row = rowAt(ui, fms);
    const onLeg = row?.kind === 'wp' || row?.kind === 'leg';
    const approach = fms.approach !== null;
    return [
      item('Activate Leg?', 'fpl.activateLeg', onLeg),
      item('Crossfill?', 'none', false),
      item('Copy Flight Plan?', 'none', false),
      item('Invert Flight Plan?', 'fpl.invert', n >= 2),
      item('Delete Flight Plan?', 'fpl.delete', n > 0 || approach),
      item('Select Approach?', 'proc.selectApproach'),
      item('Select Arrival?', 'proc.selectArrival'),
      item('Select Departure?', 'proc.selectDeparture'),
      item('Remove Approach?', 'fpl.removeApproach', approach),
      item('Remove Arrival?', 'none', false),
      item('Remove Departure?', 'none', false),
      item('Closest Point of FPL?', 'none', false),
      item('Parallel Track?', 'none', false),
      item('Change Fields?', 'none', false),
      item('Restore Defaults?', 'none', false),
    ];
  },
};

/** MENU "Activate Leg?" on the highlighted row: the ACTIVATE LEG window. */
export function activateLegWindow(ui: GnsUi, fms: FmsState): GnsUi {
  const row = rowAt(ui, fms);
  if (row?.kind === 'wp') return { ...ui, popup: { kind: 'activateLeg', target: 'plan', index: row.index } };
  if (row?.kind === 'leg') return { ...ui, popup: { kind: 'activateLeg', target: 'approach', index: row.index } };
  return ui;
}

/** Stored flight plans are not kept by the trainer: the catalog shows empty with its options unavailable. */
const catalog: PageLogic = {
  stops: () => 0,
  menu: () => [
    item('Activate Flight Plan?', 'none', false),
    item('Invert & Activate FPL?', 'none', false),
    item('Create New Flight Plan?', 'none', false),
    item('Crossfill?', 'none', false),
    item('Copy Flight Plan?', 'none', false),
    item('Delete Flight Plan?', 'none', false),
    item('Delete All Flight Plans?', 'none', false),
    item('Sort List By Number?', 'none', false),
  ],
};

export const FPL_LOGIC: Partial<Record<PageId, PageLogic>> = { 'fpl.active': activeFpl, 'fpl.catalog': catalog };

/**
 * ENT after spelling a new flight plan waypoint: it goes in front of the
 * highlighted one and the cursor moves on, ready for the next.
 */
export function acceptFplWaypoint(ui: GnsUi, index: number, wp: AnyWaypoint): Step {
  return step({ ...ui, entry: null, cursor: index + 1 }, [{ type: 'fms.insert', index, waypoint: NavDatabase.toWaypoint(wp) }]);
}
