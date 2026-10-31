/*
 * The G5 altitude alerter (Pilot's Guide 2.1.3.2). The selected altitude
 * above the altimeter flashes for 5 seconds when the airplane comes within
 * 1,000 ft and again within 200 ft of it. Once reached, straying more than
 * 200 ft turns it yellow and flashes it. Changing the selected altitude
 * resets the alerter. Pure: the PFD page feeds it every frame.
 */

export type AlertPhase = 'far' | 'within1000' | 'within200' | 'captured' | 'deviation';

export interface AlerterState {
  readonly selectedFt: number;
  readonly phase: AlertPhase;
  /** Sim time until which the selected altitude flashes. */
  readonly flashUntil: number;
}

export const FLASH_S = 5;
/** Close enough to call the altitude reached. */
const REACHED_FT = 50;
/** Hysteresis so a needle-thin climb rate at a boundary doesn't flash over and over. */
const SLACK_FT = 50;

function phaseFor(distance: number): AlertPhase {
  if (distance <= REACHED_FT) return 'captured';
  if (distance <= 200) return 'within200';
  if (distance <= 1000) return 'within1000';
  return 'far';
}

export function initialAlerter(selectedFt: number, altitudeFt: number): AlerterState {
  return { selectedFt, phase: phaseFor(Math.abs(selectedFt - altitudeFt)), flashUntil: -Infinity };
}

export function stepAlerter(s: AlerterState, selectedFt: number, altitudeFt: number, time: number): AlerterState {
  if (selectedFt !== s.selectedFt) return initialAlerter(selectedFt, altitudeFt);
  const d = Math.abs(selectedFt - altitudeFt);
  const flash = (phase: AlertPhase): AlerterState => ({ selectedFt, phase, flashUntil: time + FLASH_S });
  const quiet = (phase: AlertPhase): AlerterState => (phase === s.phase ? s : { ...s, phase });

  switch (s.phase) {
    case 'far':
      if (d <= 200) return flash('within200');
      return d <= 1000 ? flash('within1000') : s;
    case 'within1000':
      if (d <= 200) return flash('within200');
      return d > 1000 + SLACK_FT ? quiet('far') : s;
    case 'within200':
      if (d <= REACHED_FT) return quiet('captured');
      return d > 200 + SLACK_FT ? quiet('within1000') : s;
    case 'captured':
      return d > 200 ? flash('deviation') : s;
    case 'deviation':
      return d <= 200 - SLACK_FT ? quiet('captured') : s;
  }
}

/** Blinking at about 2 Hz while the flash lasts. */
export function alerterVisible(s: AlerterState, time: number): boolean {
  return time >= s.flashUntil || Math.floor(time * 4) % 2 === 0;
}
