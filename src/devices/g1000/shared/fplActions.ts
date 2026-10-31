import type { LatLon } from '../../../core/geo';
import { NavDatabase, type Waypoint } from '../../../core/navdb';
import type { SimCommand } from '../../../sim/commands';
import type { ActiveLeg } from '../../../sim/types';
import { openConfirm, type Confirm, type MenuItem } from './menu';

/*
 * Flight plan page menu and confirmations shared by the PFD Flight Plan
 * window and the MFD Active Flight Plan page, with the Pilot's Guide wording
 * ("Remove KJYO?", "Invert Active Flight Plan?", "Delete all waypoints in
 * flight plan?"). Options for equipment and data the trainer lacks (stored
 * plans, parallel track) are listed but unavailable.
 */

export function resolveWaypoint(db: NavDatabase, ident: string, near: LatLon): Waypoint | null {
  const w = ident ? db.get(ident, near) : undefined;
  return w ? NavDatabase.toWaypoint(w) : null;
}

export function fplMenuItems(planLength: number, cursorIndex: number | null): MenuItem[] {
  const onWaypoint = cursorIndex !== null && cursorIndex < planLength;
  return [
    { id: 'activateLeg', label: 'Activate Leg', enabled: onWaypoint },
    { id: 'invert', label: 'Invert Flight Plan', enabled: planLength >= 2 },
    { id: 'delete', label: 'Delete Flight Plan', enabled: planLength > 0 },
    { id: 'store', label: 'Store Flight Plan', enabled: false },
    { id: 'parallel', label: 'Parallel Track', enabled: false },
    { id: 'closest', label: 'Closest Point of FPL', enabled: false },
  ];
}

/** The confirmation a flight plan menu choice asks for. */
export function fplMenuConfirm(id: string, plan: readonly Waypoint[], cursorIndex: number | null): Confirm | null {
  switch (id) {
    case 'activateLeg': {
      if (cursorIndex === null || !plan[cursorIndex]) return null;
      const from = cursorIndex > 0 ? plan[cursorIndex - 1]!.ident : 'P.POS';
      return openConfirm('activateLeg', '', cursorIndex, 'ACTIVATE', `${from} ➔ ${plan[cursorIndex]!.ident}`);
    }
    case 'invert':
      return openConfirm('invert', 'Invert Active Flight Plan?');
    case 'delete':
      return openConfirm('delete', 'Delete all waypoints in flight plan?');
  }
  return null;
}

export function removeConfirm(plan: readonly Waypoint[], index: number): Confirm | null {
  const w = plan[index];
  return w ? openConfirm('remove', `Remove ${w.ident}?`, index) : null;
}

/** Commands for a confirmation answered OK. */
export function confirmCommands(c: Confirm): SimCommand[] {
  if (c.choice !== 0) return [];
  switch (c.id) {
    case 'activateLeg':
      return c.arg !== null ? [{ type: 'fms.activateLeg', index: c.arg }] : [];
    case 'invert':
      return [{ type: 'fms.invert' }];
    case 'delete':
      return [{ type: 'fms.clear' }];
    case 'remove':
      return c.arg !== null ? [{ type: 'fms.remove', index: c.arg }] : [];
  }
  return [];
}

export function directToMenuItems(activeLeg: ActiveLeg | null): MenuItem[] {
  return [{ id: 'cancelDto', label: 'Cancel Direct-To NAV', enabled: !!activeLeg?.isDirectTo }];
}

/** "KJYO / KHGR": the flight plan comment, first and last waypoint. */
export function planComment(plan: readonly Waypoint[]): string {
  if (plan.length === 0) return '_____ / _____';
  return `${plan[0]!.ident} / ${plan[plan.length - 1]!.ident}`;
}
