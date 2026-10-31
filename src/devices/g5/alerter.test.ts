import { describe, expect, it } from 'vitest';
import { initialWatch, watchAfcs, afcsBox, flashing, DISCONNECT_FLASH_S } from './afcs';
import { alerterVisible, FLASH_S, initialAlerter, stepAlerter, type AlerterState } from './alerter';
import { initialSimState } from '../../sim/defaults';
import { filterRate } from './trend';

/** Flies a climb from `from` to `to`, sampling once per 10 ft. */
function climb(s: AlerterState, from: number, to: number, t0 = 0) {
  const seen: AlerterState[] = [];
  let t = t0;
  for (let alt = from; from < to ? alt <= to : alt >= to; alt += from < to ? 10 : -10) {
    s = stepAlerter(s, s.selectedFt, alt, (t += 1));
    seen.push(s);
  }
  return { s, seen, t };
}

describe('G5 altitude alerter', () => {
  it('flashes passing within 1,000 ft and within 200 ft, then settles at the altitude', () => {
    const start = initialAlerter(5000, 3000);
    expect(start.phase).toBe('far');
    const { s, seen } = climb(start, 3000, 5000);
    const flashes = seen.filter((x, i) => i > 0 && x.flashUntil !== seen[i - 1]!.flashUntil);
    expect(flashes.map((x) => x.phase)).toEqual(['within1000', 'within200']);
    expect(s.phase).toBe('captured');
  });

  it('turns to a yellow deviation after leaving the selected altitude by more than 200 ft', () => {
    const at = initialAlerter(5000, 5000);
    expect(at.phase).toBe('captured');
    const low = stepAlerter(at, 5000, 4790, 10);
    expect(low.phase).toBe('deviation');
    expect(low.flashUntil).toBe(10 + FLASH_S);
    expect(alerterVisible(low, 10.3)).toBe(false);
    expect(alerterVisible(low, 20)).toBe(true);
    expect(stepAlerter(low, 5000, 4900, 11).phase).toBe('captured');
  });

  it('resets when the pilot selects a new altitude', () => {
    const at = initialAlerter(5000, 5000);
    const reset = stepAlerter(at, 7000, 5000, 3);
    expect(reset.phase).toBe('far');
    expect(alerterVisible(reset, 3)).toBe(true);
  });
});

describe('GFC 500 status box', () => {
  const base = initialSimState();

  it('is empty with the autopilot and flight director off', () => {
    expect(afcsBox(base.ap, { source: 'GPS', label: 'GPS' }, base.bugs).status).toBeNull();
  });

  it('names NAV mode by its source and shows the vertical reference', () => {
    const ap = { ...base.ap, engaged: true, flightDirector: true, lateral: 'NAV' as const, vertical: 'VS' as const, altitudeArmed: true };
    const box = afcsBox(ap, { source: 'NAV1', label: 'VOR1' }, { verticalSpeedFpm: 500, airspeedKt: 90 });
    expect(box).toEqual({
      lateralArmed: null,
      lateralActive: 'VOR',
      status: 'AP',
      verticalActive: 'VS',
      verticalRef: { value: '+500', unit: 'FPM' },
      verticalArmed: 'ALTS',
    });
    expect(afcsBox({ ...ap, engaged: false }, { source: 'GPS', label: 'GPS' }, base.bugs).lateralActive).toBe('GPS');
    expect(afcsBox({ ...ap, engaged: false }, { source: 'GPS', label: 'GPS' }, base.bugs).status).toBe('FD');
  });

  it('shows armed NAV in white, named by the CDI source, until it captures', () => {
    const hdg = { ...base.ap, engaged: true, flightDirector: true, lateral: 'HDG' as const, lateralArmed: 'NAV' as const };
    expect(afcsBox(hdg, { source: 'GPS', label: 'GPS' }, base.bugs)).toMatchObject({ lateralArmed: 'GPS', lateralActive: 'HDG' });
    expect(afcsBox(hdg, { source: 'NAV1', label: 'LOC1' }, base.bugs).lateralArmed).toBe('LOC');
    let w = initialWatch(hdg);
    w = watchAfcs(w, { ...hdg, lateral: 'NAV', lateralArmed: null }, 50);
    expect(w.navCapturedAt).toBe(50);
    expect(flashing(w.navCapturedAt, 10, 55)).toBe(true);
  });

  it('flags a disconnect for 5 s and an altitude capture', () => {
    const on = { ...base.ap, engaged: true, flightDirector: true, vertical: 'PIT' as const, altitudeArmed: true };
    let w = initialWatch(on);
    w = watchAfcs(w, { ...on, vertical: 'ALT', altitudeArmed: false }, 100);
    expect(w.capturedAt).toBe(100);
    w = watchAfcs(w, { ...on, engaged: false, vertical: 'ALT', altitudeArmed: false }, 120);
    expect(flashing(w.disconnectedAt, DISCONNECT_FLASH_S, 124)).toBe(true);
    expect(flashing(w.disconnectedAt, DISCONNECT_FLASH_S, 126)).toBe(false);
  });
});

describe('airspeed trend', () => {
  it('settles on the rate of change and restarts after a gap', () => {
    let f = filterRate(null, 100, 0);
    for (let t = 0.05; t <= 5; t += 0.05) f = filterRate(f, 100 - t, t);
    expect(f.rate).toBeCloseTo(-1, 1);
    expect(filterRate(f, 90, f.time)).toBe(f);
    expect(filterRate(f, 90, f.time + 10).rate).toBe(0);
  });
});
