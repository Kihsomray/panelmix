/*
 * Aspen altitude alerter (Pilot's Guide 4.2.3.3): a yellow flag beside the
 * selected altitude comes on 200 ft or 15 seconds before reaching it, goes
 * out within 25 ft, and flashes if the airplane then strays more than
 * 200 ft. Selecting a new altitude starts over.
 */

export type AspenAlertPhase = 'idle' | 'approaching' | 'captured' | 'deviation';

export interface AspenAlerter {
  readonly selectedFt: number;
  readonly phase: AspenAlertPhase;
}

const LEAD_S = 15;

export function initialAspenAlerter(selectedFt: number, altitudeFt: number): AspenAlerter {
  return { selectedFt, phase: Math.abs(selectedFt - altitudeFt) <= 25 ? 'captured' : 'idle' };
}

export function stepAspenAlerter(s: AspenAlerter, selectedFt: number, altitudeFt: number, vsFpm: number): AspenAlerter {
  if (selectedFt !== s.selectedFt) return initialAspenAlerter(selectedFt, altitudeFt);
  const toGo = selectedFt - altitudeFt;
  const d = Math.abs(toGo);
  const closing = Math.sign(toGo) === Math.sign(vsFpm) && Math.abs(vsFpm) > 50;
  const soon = closing && (d / Math.abs(vsFpm)) * 60 <= LEAD_S;
  const to = (phase: AspenAlertPhase) => (phase === s.phase ? s : { selectedFt, phase });
  switch (s.phase) {
    case 'idle':
      return d <= 200 || soon ? to('approaching') : s;
    case 'approaching':
      if (d <= 25) return to('captured');
      return d > 250 && !closing ? to('idle') : s;
    case 'captured':
      return d > 200 ? to('deviation') : s;
    case 'deviation':
      return d <= 25 ? to('captured') : s;
  }
}

/** The flag: steady while approaching, flashing after a deviation. */
export function alertFlag(s: AspenAlerter, time: number): boolean {
  if (s.phase === 'approaching') return true;
  return s.phase === 'deviation' && Math.floor(time * 2.5) % 2 === 0;
}
