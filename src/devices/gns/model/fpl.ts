import { NavDatabase, type AnyWaypoint } from '../../../core/navdb';
import { startEntry, turnSmall } from '../../../ui/identEntry';
import { completer } from './data';
import { item, LIST_ROWS, step, type PageLogic } from './page';
import type { GnsUi, PageId, Step } from './types';

/*
 * FPL key (Section 4). The active flight plan page lists the waypoints with
 * DTK and DIS and a magenta arrow on the active leg. With the cursor on a
 * waypoint: the small knob starts entering a new waypoint in front of it,
 * CLR offers to remove it, D-> flies to it. The page menu activates a leg,
 * inverts or deletes the plan with the real confirmation windows.
 */

const activeFpl: PageLogic = {
  // One stop per waypoint plus the empty row at the end for adding waypoints.
  stops: (_ui, ctx) => ctx.state.fms.plan.length + 1,
  first: (_ui, ctx) => ctx.state.fms.activeLeg?.planIndex ?? 0,
  list: (ui, ctx) => ({ header: 0, perRow: 1, visible: LIST_ROWS[ui.model].fpl, rows: ctx.state.fms.plan.length + 1 }),
  small: (ui, ctx, stop, steps) => {
    const e = turnSmall(startEntry(''), steps, completer(ctx.db, null));
    return step({ ...ui, entry: { target: { kind: 'fpl', index: stop }, e } });
  },
  clr: (ui, ctx, stop) =>
    stop !== null && stop < ctx.state.fms.plan.length
      ? step({ ...ui, popup: { kind: 'confirm', action: 'fpl.remove', index: stop, yes: true } })
      : null,
  dto: (_ui, ctx, stop) => {
    const wp = stop === null ? undefined : ctx.state.fms.plan[stop];
    return wp ? { wp, planIndex: stop } : null;
  },
  menu: (ui, ctx) => {
    const n = ctx.state.fms.plan.length;
    const onWaypoint = ui.cursor !== null && ui.cursor < n;
    return [
      item('Activate Leg?', 'fpl.activateLeg', onWaypoint),
      item('Crossfill?', 'none', false),
      item('Copy Flight Plan?', 'none', false),
      item('Invert Flight Plan?', 'fpl.invert', n >= 2),
      item('Delete Flight Plan?', 'fpl.delete', n > 0),
      item('Select Approach?', 'fpl.selectApproach'),
      item('Select Arrival?', 'fpl.selectArrival'),
      item('Select Departure?', 'fpl.selectDeparture'),
      item('Remove Approach?', 'none', false),
      item('Remove Arrival?', 'none', false),
      item('Remove Departure?', 'none', false),
      item('Closest Point of FPL?', 'none', false),
      item('Parallel Track?', 'none', false),
      item('Change Fields?', 'none', false),
      item('Restore Defaults?', 'none', false),
    ];
  },
};

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
