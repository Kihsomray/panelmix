import type { LatLon } from '../../../core/geo';
import type { NavDatabase, Waypoint } from '../../../core/navdb';
import type { DirectToLists } from './directTo';
import { nearestAirports } from './nearest';

/*
 * The identifiers the Direct-to waypoint submenu offers: the flight plan in
 * order, and the 25 nearest airports (a cached search).
 */

export const NO_LISTS: DirectToLists = { FPL: [], NRST: [] };

export function directToLists(plan: readonly Waypoint[], db: NavDatabase, pos: LatLon): DirectToLists {
  return { FPL: plan.map((w) => w.ident), NRST: nearestAirports(db, pos).map((n) => n.item.ident) };
}
