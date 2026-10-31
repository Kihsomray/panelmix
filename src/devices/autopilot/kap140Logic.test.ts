import { describe, expect, it } from 'vitest';
import type { Simulator } from '../../sim/simulator';
import { stepAlerter, initialAlerter } from './alerter';
import {
  initialKap,
  kapDisplay,
  pressKap,
  releaseUpDown,
  TEST_S,
  tickKap,
  turnKapKnob,
  type KapButton,
  type KapState,
  type KapView,
} from './kap140Logic';
import { makeSim, send } from './testSim';

function viewOf(sim: Simulator, now: number): KapView {
  const s = sim.getState();
  const d = sim.getDerived();
  return {
    now,
    engaged: s.ap.engaged,
    flightDirector: s.ap.flightDirector,
    lateral: s.ap.lateral,
    vertical: s.ap.vertical,
    lateralArmed: s.ap.lateralArmed,
    altitudeArmed: s.ap.altitudeArmed,
    selectedAltitudeFt: s.bugs.altitudeFt,
    vsBugFpm: s.bugs.verticalSpeedFpm,
    baroInHg: s.bugs.baroInHg,
    altitudeFt: d.indicatedAltitudeFt,
  };
}

/** A KAP 140 wired to a real simulator, with a clock in real seconds. */
function rig() {
  const sim = makeSim();
  let now = 100;
  let kap: KapState = initialKap(viewOf(sim, now));
  const press = (b: KapButton, held = false) => {
    const r = pressKap(kap, b, viewOf(sim, now), held);
    kap = r.state;
    send(sim, r.commands);
  };
  const knob = (ring: 'outer' | 'inner', steps: number) => {
    const r = turnKapKnob(kap, ring, steps, viewOf(sim, now));
    kap = r.state;
    send(sim, r.commands);
  };
  /** Advances sim and real time together, ticking the autopilot ten times a second. */
  const fly = (seconds: number) => {
    for (let i = Math.max(Math.round(seconds / 0.1), 1); i > 0; i--) {
      sim.step(0.1);
      now += 0.1;
      const r = tickKap(kap, viewOf(sim, now));
      kap = r.state;
      send(sim, r.commands);
    }
  };
  const display = () => kapDisplay(kap, viewOf(sim, now));
  return { sim, press, knob, fly, display, wait: (s: number) => (now += s), get state() { return kap; } };
}

describe('KAP 140 power-up', () => {
  it('runs the preflight test, locks the buttons, then flashes the baro', () => {
    const r = rig();
    expect(r.display().test).toBe(1);
    r.press('AP');
    expect(r.sim.getState().ap.engaged).toBe(false);
    r.fly(TEST_S - 0.6);
    expect(r.display().test).toBe('segments');
    r.fly(0.7);
    expect(r.display().test).toBeNull();
    expect(r.display().right).toEqual({ kind: 'BARO', unit: 'INHG', value: 30.12, flash: true });
    r.press('BARO');
    r.wait(3.1);
    expect(r.display().right).toEqual({ kind: 'ALT', ft: 3500 });
  });
});

describe('KAP 140 engagement and vertical modes', () => {
  const ready = () => {
    const r = rig();
    r.fly(TEST_S + 0.1);
    r.press('BARO');
    r.wait(3.1);
    return r;
  };

  it('engages in ROL and VS holding the current vertical speed, and shows it for 3 s', () => {
    const r = ready();
    r.press('AP');
    const ap = r.sim.getState().ap;
    expect(ap).toMatchObject({ engaged: true, lateral: 'ROL', vertical: 'VS', flightDirector: false });
    expect(r.display()).toMatchObject({ lateral: 'ROL', vertical: 'VS', ap: 'on' });
    expect(r.display().right.kind).toBe('VS');
    r.wait(3.1);
    expect(r.display().right).toEqual({ kind: 'ALT', ft: 3500 });
  });

  it('shows the VS on the first UP press and changes it 100 fpm per press after', () => {
    const r = ready();
    r.press('AP');
    r.wait(3.1);
    const vs0 = r.sim.getState().bugs.verticalSpeedFpm;
    r.press('UP');
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBe(vs0);
    expect(r.display().right.kind).toBe('VS');
    r.press('UP');
    r.press('UP');
    r.press('DN');
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBe(vs0 + 100);
  });

  it('climbs and captures the selected altitude with ALT ARM', () => {
    const r = ready();
    r.sim.dispatch({ type: 'engine.throttle', value: 1 });
    r.press('AP');
    r.knob('inner', 10);
    expect(r.sim.getState().bugs.altitudeFt).toBe(4500);
    expect(r.sim.getState().ap.altitudeArmed).toBe(true);
    expect(r.display()).toMatchObject({ verticalArmed: 'ALT' });
    for (let i = 0; i < 5; i++) r.press('UP');
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBeGreaterThanOrEqual(400);
    r.fly(240);
    const st = r.sim.getState();
    expect(st.ap.vertical).toBe('ALT');
    expect(Math.abs(st.aircraft.altitudeFt - 4500)).toBeLessThan(60);
    expect(r.display()).toMatchObject({ vertical: 'ALT', verticalArmed: '' });
  });

  it('toggles ALT hold and VS with the ALT button, and moves ALT hold 20 ft per UP press', () => {
    const r = ready();
    r.press('AP');
    r.press('ALT');
    const ref = r.sim.getState().ap.altitudeRefFt;
    expect(r.sim.getState().ap.vertical).toBe('ALT');
    r.press('UP');
    expect(r.sim.getState().ap.altitudeRefFt).toBe(ref + 20);
    r.press('ALT');
    expect(r.sim.getState().ap.vertical).toBe('VS');
  });

  it('flies up at about 500 fpm while UP is held in ALT, then holds the new altitude', () => {
    const r = ready();
    r.sim.dispatch({ type: 'engine.throttle', value: 1 });
    r.press('AP');
    r.press('ALT');
    const start = r.sim.getState().aircraft.altitudeFt;
    for (let i = 0; i < 120; i++) {
      r.press('UP', true);
      r.fly(0.1);
      expect(r.display().vertical).toBe('ALT');
    }
    const r2 = releaseUpDown(r.state, viewOf(r.sim, 0));
    send(r.sim, r2.commands);
    expect(r2.commands).toEqual([{ type: 'ap.vertical', mode: 'ALT' }]);
    // 12 s at 500 fpm is 100 ft, less the time to establish the climb.
    const climbed = r.sim.getState().ap.altitudeRefFt - start;
    expect(climbed).toBeGreaterThan(60);
    expect(climbed).toBeLessThan(110);
  });

  it('turns to the heading bug in HDG and returns to ROL on a second press', () => {
    const r = ready();
    r.press('AP');
    r.sim.dispatch({ type: 'bug.heading', mag: 90 });
    r.press('HDG');
    expect(r.display().lateral).toBe('HDG');
    r.fly(120);
    expect(Math.abs(r.sim.getDerived().headingMag - 90)).toBeLessThan(3);
    r.press('HDG');
    expect(r.sim.getState().ap.lateral).toBe('ROL');
  });

  it('flashes AP for five seconds after a disconnect and clears the arms', () => {
    const r = ready();
    r.press('AP');
    r.knob('outer', 1);
    r.press('NAV');
    r.press('AP');
    r.fly(0.2);
    expect(r.display().ap).toBe('flash');
    expect(r.sim.getState().ap).toMatchObject({ altitudeArmed: false, lateralArmed: null });
    r.fly(5);
    expect(r.display().ap).toBe('off');
  });

  it('rolls the wings level in ROL, even when engaged in a bank', () => {
    const r = ready();
    r.sim.dispatch({ type: 'controls.set', roll: 1, pitch: 0 });
    r.fly(1.5);
    r.sim.dispatch({ type: 'controls.set', roll: 0, pitch: 0 });
    r.fly(3);
    expect(Math.abs(r.sim.getState().aircraft.bankDeg)).toBeGreaterThan(15);
    r.press('AP');
    expect(r.sim.getState().ap).toMatchObject({ lateral: 'ROL', rollRefDeg: 0 });
    r.fly(10);
    expect(Math.abs(r.sim.getState().aircraft.bankDeg)).toBeLessThan(2);
  });

  it('ignores the mode buttons while the autopilot is off', () => {
    const r = ready();
    r.press('HDG');
    r.press('ALT');
    expect(r.sim.getState().ap).toMatchObject({ engaged: false, flightDirector: false, lateral: 'ROL', vertical: 'PIT' });
  });
});

describe('KAP 140 NAV, APR and REV', () => {
  const base: KapView = {
    now: 50,
    engaged: true,
    flightDirector: false,
    lateral: 'HDG',
    vertical: 'VS',
    lateralArmed: null,
    altitudeArmed: false,
    selectedAltitudeFt: 3500,
    vsBugFpm: 0,
    baroInHg: 29.92,
    altitudeFt: 3500,
  };
  const ready: KapState = { ...initialKap(base), baroPending: false };

  it('arms the shared NAV capture and shows the armed mode under the active one', () => {
    const armed = pressKap(ready, 'APR', base);
    expect(armed.commands).toEqual([{ type: 'ap.armNav', on: true }]);
    expect(kapDisplay(armed.state, { ...base, lateralArmed: 'NAV' })).toMatchObject({ lateral: 'HDG', lateralArmed: 'APR' });
    // Captured by the core: the coupled button's name moves up to the active field.
    expect(kapDisplay(armed.state, { ...base, lateral: 'NAV' })).toMatchObject({ lateral: 'APR', lateralArmed: '' });
  });

  it('disarms on a second press, and returns a coupled mode to the wing leveler', () => {
    const armed = pressKap(ready, 'NAV', base).state;
    expect(pressKap(armed, 'NAV', { ...base, lateralArmed: 'NAV' }).commands).toEqual([{ type: 'ap.armNav', on: false }]);
    expect(pressKap(armed, 'NAV', { ...base, lateral: 'NAV' }).commands).toEqual([{ type: 'ap.lateral', mode: 'ROL', rollRefDeg: 0 }]);
  });

  it('switches the annunciation between NAV, APR and REV on the same course', () => {
    const coupled = { ...base, lateral: 'NAV' as const };
    const rev = pressKap(ready, 'REV', coupled);
    expect(rev.commands).toEqual([]);
    expect(kapDisplay(rev.state, coupled).lateral).toBe('REV');
  });

  it('intercepts a GPS course: HDG flies with NAV armed until the core captures', () => {
    const r = rig();
    r.fly(TEST_S + 0.1);
    r.press('BARO');
    r.sim.dispatch({ type: 'bug.heading', mag: 20 });
    r.press('AP');
    r.press('HDG');
    r.press('NAV');
    expect(r.sim.getState().ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    expect(r.display()).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    r.fly(300);
    expect(r.sim.getState().ap).toMatchObject({ lateral: 'NAV', lateralArmed: null });
    expect(r.display()).toMatchObject({ lateral: 'NAV', lateralArmed: '' });
    expect(Math.abs(r.sim.getDerived().cdi.needle)).toBeLessThan(0.2);
  });

  it('sets the baro with the knobs after BARO, in inches or hectopascals', () => {
    const shown = pressKap(ready, 'BARO', base).state;
    expect(turnKapKnob(shown, 'inner', 3, base).commands).toEqual([{ type: 'baro.set', inHg: 29.95 }]);
    const hpa = pressKap(ready, 'BARO_HOLD', base).state;
    expect(kapDisplay(hpa, base).right).toEqual({ kind: 'BARO', unit: 'HPA', value: 1013, flash: false });
    const cmd = turnKapKnob(hpa, 'inner', 1, base).commands[0];
    expect(cmd?.type === 'baro.set' && Math.round(cmd.inHg * 33.8639)).toBe(1014);
  });
});

describe('altitude alerter', () => {
  it('lights 1000 ft out, goes out inside 200 ft, blinks on arrival and flashes on leaving', () => {
    let s = initialAlerter(5000);
    const at = (alt: number, now = 0) => {
      const r = stepAlerter(s, alt, 5000, now);
      s = r.state;
      return r.lamp;
    };
    expect(at(3800)).toBe('off');
    expect(at(4100)).toBe('on');
    expect(at(4850)).toBe('off');
    expect(at(4990, 10)).toBe('on');
    expect(at(5000, 12)).toBe('off');
    expect(at(5250, 20)).toBe('flash');
    expect(at(6100, 30)).toBe('off');
    expect(at(5500, 40)).toBe('on');
  });
});
