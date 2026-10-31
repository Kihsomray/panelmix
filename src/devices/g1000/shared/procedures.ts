import { openMenu, type MenuItem, type PageMenu } from './menu';

/*
 * The PROC key's PROCEDURES menu (Figure 5-129). The trainer database has
 * no departures, arrivals or approaches, so the activate options are
 * unavailable (gray, as when nothing is loaded) and the select options open
 * the loading frame with an honest "not in the database" message.
 */

export type ProcKind = 'approach' | 'arrival' | 'departure';

export interface ProcState {
  readonly menu: PageMenu;
  /** Loading frame shown for a SELECT option, or null for the options list. */
  readonly loading: ProcKind | null;
}

const OPTIONS: readonly MenuItem[] = [
  { id: 'vtf', label: 'ACTIVATE VECTOR-TO-FINAL', enabled: false },
  { id: 'activateApproach', label: 'ACTIVATE APPROACH', enabled: false },
  { id: 'missed', label: 'ACTIVATE MISSED APPROACH', enabled: false },
  { id: 'approach', label: 'SELECT APPROACH', enabled: true },
  { id: 'arrival', label: 'SELECT ARRIVAL', enabled: true },
  { id: 'departure', label: 'SELECT DEPARTURE', enabled: true },
];

export function openProcedures(): ProcState {
  return { menu: openMenu(OPTIONS, 'PROCEDURES'), loading: null };
}

export const PROC_TITLES: Record<ProcKind, string> = {
  approach: 'APPROACH LOADING',
  arrival: 'ARRIVAL LOADING',
  departure: 'DEPARTURE LOADING',
};

export const PROC_NONE: Record<ProcKind, string> = {
  approach: 'No approaches in the trainer database',
  arrival: 'No arrivals (STARs) in the trainer database',
  departure: 'No departures (DPs) in the trainer database',
};
