import { describe, expect, it } from 'vitest';
import type { Simulator } from '../../sim/simulator';
import {
  gmcLeds,
  initialGmc,
  pressGmc,
  rollWheel,
  syncAltitude,
  syncHeading,
  tickGmc,
  type GmcKey,
  type GmcState,
  type GmcView,
} from './gfc500Logic';
import { makeSim, send } from './testSim';

function viewOf(sim: Simulator): GmcView {
  const s = sim.getState();
  const d = sim.getDerived();
  return {
    engaged: s.ap.engaged,
    flightDirector: s.ap.flightDirector,
    lateral: s.ap.lateral,
    vertical: s.ap.vertical,
    lateralArmed: s.ap.lateralArmed,
    altitudeArmed: s.ap.altitudeArmed,
    altitudeRefFt: s.ap.altitudeRefFt,
    headingMag: d.headingMag,
    trackMag: d.trackMag,
    altitudeFt: d.indicatedAltitudeFt,
    cdiFlag: d.cdi.flag,
  };
}

function rig() {
  const sim = makeSim();
  let gmc: GmcState = initialGmc(viewOf(sim));
  const press = (...keys: GmcKey[]) => {
    for (const k of keys) {
      const r = pressGmc(gmc, k, viewOf(sim));
      gmc = r.state;
      send(sim, r.commands);
    }
  };
  const wheel = (direction: 1 | -1, times = 1) => {
    for (let i = 0; i < times; i++) {
      const r = rollWheel(gmc, direction, viewOf(sim));
      gmc = r.state;
      send(sim, r.commands);
    }
  };
  const fly = (seconds: number) => {
    for (let i = Math.max(Math.round(seconds / 0.1), 1); i > 0; i--) {
      sim.step(0.1);
      gmc = tickGmc(gmc, viewOf(sim));
    }
  };
  const leds = () => gmcLeds(gmc, viewOf(sim));
  return { sim, press, wheel, fly, leds, get state() { return gmc; } };
}

const lit = (leds: Record<GmcKey, boolean>) => (Object.keys(leds) as GmcKey[]).filter((k) => leds[k]).sort();

describe('GMC 507 engagement', () => {
  it('AP turns on the flight director and engages in ROL and PIT with ALTS armed', () => {
    const r = rig();
    r.press('AP');
    expect(r.sim.getState().ap).toMatchObject({ engaged: true, flightDirector: true, lateral: 'ROL', vertical: 'PIT', altitudeArmed: true });
    expect(lit(r.leds())).toEqual(['AP', 'FD', 'YD']);
    r.press('AP');
    expect(r.sim.getState().ap).toMatchObject({ engaged: false, flightDirector: true });
  });

  it('FD toggles the director alone and is disabled while the autopilot flies', () => {
    const r = rig();
    r.press('FD');
    expect(r.sim.getState().ap).toMatchObject({ engaged: false, flightDirector: true, lateral: 'ROL', vertical: 'PIT' });
    r.press('AP', 'FD');
    expect(r.sim.getState().ap.flightDirector).toBe(true);
    r.press('AP', 'FD');
    expect(r.sim.getState().ap).toMatchObject({ engaged: false, flightDirector: false, altitudeArmed: false });
  });

  it('a mode key with the director off turns it on in that mode', () => {
    const r = rig();
    r.press('HDG');
    expect(r.sim.getState().ap).toMatchObject({ engaged: false, flightDirector: true, lateral: 'HDG', vertical: 'PIT' });
    expect(lit(r.leds())).toEqual(['FD', 'HDG']);
  });

  it('LVL engages wings level with zero vertical speed and cancels the arms', () => {
    const r = rig();
    r.press('LVL');
    expect(r.sim.getState().ap).toMatchObject({ engaged: true, lateral: 'ROL', vertical: 'VS', altitudeArmed: false });
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBe(0);
    expect(lit(r.leds())).toEqual(['AP', 'FD', 'LVL', 'YD']);
    r.wheel(1);
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBe(0);
    r.press('HDG');
    expect(lit(r.leds())).toEqual(['AP', 'FD', 'HDG', 'LVL', 'YD']);
    r.press('VS');
    expect(lit(r.leds())).toEqual(['AP', 'FD', 'HDG', 'VS', 'YD']);
  });
});

describe('GMC 507 vertical modes and the wheel', () => {
  it('VS takes the current vertical speed and the wheel changes it 100 fpm a click', () => {
    const r = rig();
    r.press('AP', 'VS');
    const vs = r.sim.getState().bugs.verticalSpeedFpm;
    r.wheel(1, 3);
    r.wheel(-1);
    expect(r.sim.getState().bugs.verticalSpeedFpm).toBe(vs + 200);
    expect(r.sim.getState().ap.altitudeArmed).toBe(true);
  });

  it('pressing the active vertical mode returns to PIT', () => {
    const r = rig();
    r.press('AP', 'IAS');
    expect(r.sim.getState().ap.vertical).toBe('IAS');
    r.press('IAS');
    expect(r.sim.getState().ap.vertical).toBe('PIT');
  });

  it('limits the wheel to 200 ft of change in ALT hold', () => {
    const r = rig();
    r.press('AP', 'ALT');
    const ref = r.sim.getState().ap.altitudeRefFt;
    expect(r.sim.getState().ap.altitudeArmed).toBe(false);
    r.wheel(1, 30);
    expect(r.sim.getState().ap.altitudeRefFt).toBe(ref + 200);
    r.wheel(-1, 5);
    expect(r.sim.getState().ap.altitudeRefFt).toBe(ref + 150);
  });

  it('climbs in VS and captures the selected altitude', () => {
    const r = rig();
    r.sim.dispatch({ type: 'engine.throttle', value: 1 });
    r.sim.dispatch({ type: 'bug.altitude', ft: 4500 });
    r.press('AP', 'VS');
    r.wheel(1, 5);
    r.fly(240);
    const st = r.sim.getState();
    expect(st.ap.vertical).toBe('ALT');
    expect(Math.abs(st.aircraft.altitudeFt - 4500)).toBeLessThan(60);
    expect(lit(r.leds())).toEqual(['ALT', 'AP', 'FD', 'YD']);
  });
});

describe('GMC 507 lateral modes', () => {
  const base: GmcView = {
    engaged: true,
    flightDirector: true,
    lateral: 'HDG',
    vertical: 'PIT',
    lateralArmed: null,
    altitudeArmed: true,
    altitudeRefFt: 3500,
    headingMag: 300,
    trackMag: 306.4,
    altitudeFt: 3500,
    cdiFlag: false,
  };
  const s0: GmcState = initialGmc(base);

  it('arms the shared NAV capture; NAV lights with the active HDG until it captures', () => {
    const armed = pressGmc(s0, 'NAV', base);
    expect(armed.commands).toEqual([{ type: 'ap.armNav', on: true }]);
    expect(gmcLeds(armed.state, { ...base, lateralArmed: 'NAV' })).toMatchObject({ NAV: true, HDG: true, APR: false });
    expect(gmcLeds(armed.state, { ...base, lateral: 'NAV' })).toMatchObject({ NAV: true, HDG: false });
    expect(pressGmc(armed.state, 'NAV', { ...base, lateralArmed: 'NAV' }).commands).toEqual([{ type: 'ap.armNav', on: false }]);
  });

  it('APR takes over a coupled course; pressing it again returns to ROL', () => {
    const coupled = { ...base, lateral: 'NAV' as const };
    const apr = pressGmc(s0, 'APR', coupled);
    expect(apr.commands).toEqual([]);
    expect(gmcLeds(apr.state, coupled)).toMatchObject({ APR: true, NAV: false });
    expect(pressGmc(apr.state, 'APR', coupled).commands).toEqual([{ type: 'ap.lateral', mode: 'ROL' }]);
  });

  it('turns the director on for NAV only when there is a course', () => {
    const off = { ...base, engaged: false, flightDirector: false };
    expect(pressGmc(s0, 'NAV', { ...off, cdiFlag: true }).commands).toEqual([]);
    expect(pressGmc(s0, 'NAV', off).commands).toEqual([
      { type: 'ap.flightDirector', on: true },
      { type: 'ap.armAltitude', on: true },
      { type: 'ap.armNav', on: true },
    ]);
  });

  it('TRK puts the bug on the ground track and flies it in the HDG mode', () => {
    const r = pressGmc(s0, 'TRK', { ...base, lateral: 'ROL' });
    expect(r.commands).toEqual([
      { type: 'bug.heading', mag: 306 },
      { type: 'ap.lateral', mode: 'HDG' },
    ]);
    expect(gmcLeds(r.state, base)).toMatchObject({ TRK: true, HDG: false });
    expect(syncHeading(r.state, base)).toEqual({ type: 'bug.heading', mag: 306 });
    expect(syncHeading(s0, base)).toEqual({ type: 'bug.heading', mag: 300 });
  });

  it('VNAV only arms, and only with the director on', () => {
    const off = { ...base, engaged: false, flightDirector: false };
    expect(pressGmc(s0, 'VNAV', off).state.vnavArmed).toBe(false);
    const on = pressGmc(s0, 'VNAV', base);
    expect(on.commands).toEqual([]);
    expect(gmcLeds(on.state, base).VNAV).toBe(true);
  });

  it('syncs the selected altitude to the nearest 10 ft', () => {
    expect(syncAltitude({ ...base, altitudeFt: 3487 })).toEqual({ type: 'bug.altitude', ft: 3490 });
  });

  it('intercepts a GPS course in HDG with NAV armed, then the core captures it', () => {
    const r = rig();
    r.sim.dispatch({ type: 'bug.heading', mag: 20 });
    r.press('AP', 'HDG', 'NAV');
    expect(r.sim.getState().ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    r.fly(300);
    expect(r.sim.getState().ap).toMatchObject({ lateral: 'NAV', lateralArmed: null });
    expect(lit(r.leds())).toEqual(['ALT', 'AP', 'FD', 'NAV', 'YD']);
  });

  it('turns to the heading bug with the autopilot', () => {
    const r = rig();
    r.sim.dispatch({ type: 'bug.heading', mag: 90 });
    r.press('AP', 'HDG');
    r.fly(120);
    expect(Math.abs(r.sim.getDerived().headingMag - 90)).toBeLessThan(3);
  });
});
