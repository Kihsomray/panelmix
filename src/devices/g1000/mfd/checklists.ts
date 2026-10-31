import type { ChecklistState } from './mfdState';

/*
 * Electronic checklists (CHKLIST softkey). The G1000 loads them from an SD
 * card the operator writes; this is a short sample in the style of the 172S
 * handbook for practising the page, not an approved checklist.
 */

export interface Checklist {
  readonly name: string;
  readonly items: readonly (readonly [item: string, action: string])[];
}

export const NORMAL_CHECKLISTS: readonly Checklist[] = [
  {
    name: 'BEFORE TAKEOFF',
    items: [
      ['Parking Brake', 'SET'],
      ['Seats and Belts', 'SECURE'],
      ['Cabin Doors', 'CLOSED and LOCKED'],
      ['Flight Controls', 'FREE and CORRECT'],
      ['Flight Instruments (PFD)', 'CHECK'],
      ['Altimeters', 'SET'],
      ['Fuel Selector Valve', 'BOTH'],
      ['Mixture', 'RICH'],
      ['Elevator Trim', 'SET FOR TAKEOFF'],
      ['Throttle', '1800 RPM'],
      ['Magnetos', 'CHECK'],
      ['Autopilot', 'OFF'],
    ],
  },
  {
    name: 'CRUISE',
    items: [
      ['Power', '2100-2700 RPM'],
      ['Elevator Trim', 'ADJUST'],
      ['Mixture', 'LEAN'],
      ['Fuel Quantity', 'CHECK'],
    ],
  },
  {
    name: 'DESCENT',
    items: [
      ['Power', 'AS DESIRED'],
      ['Mixture', 'ENRICHEN'],
      ['Altimeters', 'SET'],
      ['Fuel Selector Valve', 'BOTH'],
    ],
  },
  {
    name: 'BEFORE LANDING',
    items: [
      ['Seats and Belts', 'SECURE'],
      ['Fuel Selector Valve', 'BOTH'],
      ['Mixture', 'RICH'],
      ['Landing Lights', 'ON'],
      ['Autopilot', 'OFF'],
    ],
  },
];

export const EMERGENCY_CHECKLISTS: readonly Checklist[] = [
  {
    name: 'ENGINE FAILURE DURING FLIGHT',
    items: [
      ['Airspeed', '68 KIAS'],
      ['Fuel Selector Valve', 'BOTH'],
      ['Fuel Shutoff Valve', 'ON'],
      ['Mixture', 'RICH'],
      ['Magnetos', 'BOTH'],
      ['Primer', 'IN and LOCKED'],
    ],
  },
];

export function checklistsOf(c: ChecklistState): readonly Checklist[] {
  return c.emergency ? EMERGENCY_CHECKLISTS : NORMAL_CHECKLISTS;
}

const key = (c: ChecklistState, list: number, item: number) => `${c.emergency ? 'E' : 'N'}${list}:${item}`;

export function isChecked(c: ChecklistState, list: number, item: number): boolean {
  return c.checked.includes(key(c, list, item));
}

/** CHECK / ENT: toggles the item under the cursor and moves to the next one. */
export function checkItem(c: ChecklistState): ChecklistState {
  const k = key(c, c.list, c.item);
  const checked = c.checked.includes(k) ? c.checked.filter((x) => x !== k) : [...c.checked, k];
  const count = checklistsOf(c)[c.list]?.items.length ?? 0;
  return { ...c, checked, item: Math.min(c.item + 1, Math.max(count - 1, 0)) };
}

/** Large knob: the checklist; small knob: the item. */
export function moveChecklist(c: ChecklistState, knob: 'outer' | 'inner', steps: number): ChecklistState {
  const lists = checklistsOf(c);
  if (knob === 'outer') return { ...c, list: Math.min(Math.max(c.list + steps, 0), lists.length - 1), item: 0 };
  const count = lists[c.list]?.items.length ?? 0;
  return { ...c, item: Math.min(Math.max(c.item + steps, 0), Math.max(count - 1, 0)) };
}

export function toggleEmergency(c: ChecklistState): ChecklistState {
  return { ...c, emergency: !c.emergency, list: 0, item: 0 };
}
