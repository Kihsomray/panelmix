import { NavDatabase, type AnyWaypoint } from '../../../core/navdb';
import { startEntry, turnSmall } from '../../../ui/identEntry';
import { completer, DTO_NEAREST_COUNT } from './data';
import { item, step, type PageLogic } from './page';
import { planIndexOf } from './wpt';
import type { DtoState, GnsCtx, GnsUi, Step } from './types';

/*
 * The SELECT DIRECT-TO WAYPOINT page (Section 3). It opens with the
 * identifier highlighted, pre-filled with the waypoint under the cursor (or
 * the active waypoint). ENT confirms the identifier and moves to
 * "Activate?"; ENT again flies direct. The FPL and NRST fields pop up lists
 * with the small knob. MENU offers "Cancel Direct-To NAV?".
 */

export const DTO_STOP = { ident: 0, fpl: 1, nrst: 2, activate: 3 } as const;

/** D-> pressed: remember the page underneath and open the direct-to page. */
export function openDto(ui: GnsUi, ctx: GnsCtx, prefill: DtoState | null): GnsUi {
  const leg = ctx.state.fms.activeLeg;
  const dto = prefill ?? (leg ? { wp: leg.to, planIndex: leg.planIndex } : { wp: null, planIndex: null });
  return {
    ...ui,
    stack: [...ui.stack, { fn: ui.fn, cursor: ui.cursor, scroll: ui.scroll }],
    fn: 'dto',
    dto,
    cursor: DTO_STOP.ident,
    scroll: 0,
    popup: null,
    entry: null,
  };
}

export const dtoPage: PageLogic = {
  stops: () => 4,
  small: (ui, ctx, stop, steps) => {
    if (stop === DTO_STOP.ident) {
      const e = turnSmall(startEntry(ui.dto.wp?.ident ?? ''), steps, completer(ctx.db, null));
      return step({ ...ui, entry: { target: { kind: 'dto' }, e } });
    }
    if (stop === DTO_STOP.fpl) {
      const plan = ctx.state.fms.plan;
      if (plan.length === 0) return null;
      return step({ ...ui, popup: { kind: 'list', purpose: 'dto.fpl', items: plan, index: Math.min(ui.dto.planIndex ?? 0, plan.length - 1) } });
    }
    if (stop === DTO_STOP.nrst) {
      const items = ctx.nearest.airports.slice(0, DTO_NEAREST_COUNT).map((a) => NavDatabase.toWaypoint(a));
      return items.length > 0 ? step({ ...ui, popup: { kind: 'list', purpose: 'dto.nrst', items, index: 0 } }) : null;
    }
    return null;
  },
  ent: (ui, _ctx, stop) => {
    const wp = ui.dto.wp;
    if (!wp) return null;
    if (stop === DTO_STOP.activate) return step(closeModal(ui), [{ type: 'fms.directTo', waypoint: wp, planIndex: ui.dto.planIndex }]);
    return step({ ...ui, cursor: DTO_STOP.activate });
  },
  menu: (_ui, ctx) => [item('Cancel Direct-To NAV?', 'dto.cancel', ctx.state.fms.activeLeg?.isDirectTo === true)],
};

/** ENT after spelling an identifier: the page shows it and "Activate?" is highlighted. */
export function acceptDto(ui: GnsUi, ctx: GnsCtx, wp: AnyWaypoint): Step {
  const plain = NavDatabase.toWaypoint(wp);
  return step({ ...ui, entry: null, dto: { wp: plain, planIndex: planIndexOf(ctx.state.fms, plain) }, cursor: DTO_STOP.activate });
}

/** Closes a modal page (D->, MSG) back to whatever was under it. */
export function closeModal(ui: GnsUi): GnsUi {
  const frame = ui.stack[ui.stack.length - 1];
  const base = { ...ui, popup: null, entry: null, stack: ui.stack.slice(0, -1) };
  return frame ? { ...base, fn: frame.fn, cursor: frame.cursor, scroll: frame.scroll } : { ...base, fn: null, cursor: null, scroll: 0 };
}
