import { describe, expect, it } from 'vitest';
import type { SimCommand } from '../../sim/commands';
import {
  BOOT_SECONDS,
  currentPage,
  digitsToSeconds,
  formatFlightLevel,
  formatTimer,
  gtxScreen,
  initialGtx,
  pressGtx,
  tickGtx,
  type GtxKey,
  type GtxState,
  type GtxView,
} from './gtx345Logic';

const baseView: GtxView = {
  simTime: 100,
  realTime: 1000,
  code: '1200',
  mode: 'ALT',
  identUntil: null,
  pressureAltFt: 3700,
  densityAltFt: 4100,
  oatC: 7.6,
  verticalSpeedFpm: 0,
  airborne: true,
};

/** Applies the transponder commands the unit sends, the way the sim would. */
function apply(view: GtxView, commands: readonly SimCommand[]): GtxView {
  let v = view;
  for (const c of commands) {
    if (c.type === 'xpdr.code') v = { ...v, code: c.code };
    if (c.type === 'xpdr.mode') v = { ...v, mode: c.mode };
    if (c.type === 'xpdr.ident') v = { ...v, identUntil: v.simTime + 18 };
  }
  return v;
}

function press(keys: GtxKey[], state: GtxState = initialGtx(), view: GtxView = baseView) {
  let s = state;
  let v = view;
  const sent: SimCommand[] = [];
  for (const k of keys) {
    const r = pressGtx(s, k, v);
    s = r.state;
    v = apply(v, r.commands);
    sent.push(...r.commands);
  }
  return { state: s, view: v, sent };
}

describe('GTX 345 code entry', () => {
  it('enters a code on the keypad and activates it on the fourth digit', () => {
    const partial = press(['4', '5', '2']);
    expect(gtxScreen(partial.state, partial.view).code).toBe('452_');
    expect(partial.view.code).toBe('1200');
    const full = press(['1'], partial.state, partial.view);
    expect(full.view.code).toBe('4521');
    expect(gtxScreen(full.state, full.view).entering).toBe(false);
  });

  it('backs up with CLR, cancels with CRSR, and completes with ENT', () => {
    const back = press(['4', '5', 'CLR', '6']);
    expect(gtxScreen(back.state, back.view).code).toBe('46__');
    const cancel = press(['CRSR'], back.state, back.view);
    expect(cancel.view.code).toBe('1200');
    expect(cancel.state.entry).toBeNull();
    const ent = press(['7', '7', 'ENT']);
    expect(ent.view.code).toBe('7700');
    expect(gtxScreen(ent.state, ent.view).special).toBe('EMERGENCY');
  });

  it('CLR on the first digit cancels; CLR held goes back to the first digit', () => {
    const held = press(['3', '4', 'CLR_HOLD']);
    expect(held.state.entry).toEqual({ digits: '' });
    const out = press(['CLR'], held.state, held.view);
    expect(out.state.entry).toBeNull();
    expect(out.view.code).toBe('1200');
  });

  it('VFR sets 1200 and restores the previous code', () => {
    const atc = press(['4', '5', '2', '1']);
    const vfr = press(['VFR'], atc.state, atc.view);
    expect(vfr.view.code).toBe('1200');
    const back = press(['VFR'], vfr.state, vfr.view);
    expect(back.view.code).toBe('4521');
  });
});

describe('GTX 345 modes', () => {
  it('maps the mode keys to the sim modes and idents', () => {
    expect(press(['SBY']).view.mode).toBe('STBY');
    expect(press(['ON']).view.mode).toBe('ON');
    const ident = press(['IDNT']);
    expect(ident.sent).toEqual([{ type: 'xpdr.ident' }]);
    expect(gtxScreen(ident.state, ident.view).ident).toBe(true);
  });

  it('shows a start-up screen after power on and ignores the keypad until ready', () => {
    const off = press(['OFF']);
    expect(gtxScreen(off.state, off.view).kind).toBe('off');
    expect(press(['4'], off.state, off.view).state.entry).toBeNull();
    const on = press(['ALT'], off.state, off.view);
    expect(on.view.mode).toBe('ALT');
    expect(gtxScreen(on.state, on.view).kind).toBe('boot');
    const later = { ...on.view, realTime: on.view.realTime + BOOT_SECONDS + 0.1 };
    expect(gtxScreen(on.state, later).kind).toBe('normal');
  });
});

describe('GTX 345 function pages', () => {
  it('starts on PRESSURE ALT in flight levels and cycles groups with FUNC', () => {
    const s = initialGtx();
    const screen = gtxScreen(s, baseView);
    expect(screen.page).toMatchObject({ kind: 'titled', title: 'PRESSURE ALT', value: 'FL037' });
    const sys = press(['FUNC']);
    expect(sys.state.group).toBe('SYS');
    expect(gtxScreen(sys.state, sys.view).groupName).toBe('SYS');
    expect(press(['FUNC', 'FUNC']).state.group).toBe('XPDR');
  });

  it('moves within a group with 8 and 9', () => {
    const r = press(['9', '9', '9', '8']);
    expect(currentPage(r.state)).toBe('ALT_MONITOR');
  });

  it('runs and resets the up counter with ENT and CLR', () => {
    // From ALT, FUNC goes SYS, XPDR, then TMR.
    const toTmr = press(['FUNC', 'FUNC', 'FUNC']);
    expect(toTmr.state.group).toBe('TMR');
    const started = press(['ENT'], toTmr.state, toTmr.view);
    const later = { ...started.view, simTime: started.view.simTime + 75 };
    expect(gtxScreen(started.state, later).page).toMatchObject({ value: '00:01:15' });
    const reset = press(['CLR'], started.state, later);
    expect(gtxScreen(reset.state, later).page).toMatchObject({ value: '00:00:00' });
  });

  it('sets a count-down time with the cursor and expires', () => {
    const tmr = press(['FUNC', 'FUNC', 'FUNC', '9', 'CRSR', '0', '0', '0', '1', '3', '0']);
    expect(tmr.state.cursor).toBeNull();
    expect(tmr.state.down.preset).toBe(90);
    const running = press(['ENT'], tmr.state, tmr.view);
    const mid = { ...running.view, simTime: running.view.simTime + 30 };
    expect(gtxScreen(running.state, mid).page).toMatchObject({ title: 'DOWN COUNTER', value: '00:01:00' });
    const over = { ...running.view, simTime: running.view.simTime + 95 };
    expect(gtxScreen(running.state, over).page).toMatchObject({ title: 'EXPIRED', value: '00:00:05', flash: 'title' });
  });

  it('starts the flight timer when airborne', () => {
    let s = tickGtx(initialGtx(), baseView);
    expect(s.flight.running).toBe(true);
    s = { ...s, group: 'TMR', pageIn: { ...s.pageIn, TMR: 2 } };
    expect(gtxScreen(s, { ...baseView, simTime: baseView.simTime + 3600 }).page).toMatchObject({
      title: 'FLIGHT TIMER',
      value: '01:00:00',
    });
  });

  it('alerts when leaving the monitored altitude', () => {
    const on = press(['9', 'CRSR', 'ENT']);
    expect(on.state.altMon).toMatchObject({ on: true, refFt: 3700 });
    const low = { ...on.view, pressureAltFt: 3400, realTime: on.view.realTime + 1 };
    const s = tickGtx(on.state, low);
    expect(gtxScreen(s, low).banner).toBe('LEAVING ALTITUDE');
    expect(gtxScreen(s, low).page).toMatchObject({ title: 'ALT MONITOR', value: '-300FT', flash: 'value' });
    const quiet = press(['CLR'], s, low);
    expect(gtxScreen(quiet.state, low).page).toMatchObject({ flash: null });
  });

  it('adjusts the backlight offset with the cursor', () => {
    const r = press(['FUNC', 'CRSR', '8', '8', '9', '8', 'CRSR']);
    expect(r.state.backlightOffset).toBe(2);
    expect(r.state.cursor).toBeNull();
  });
});

describe('formatting', () => {
  it('formats timers and flight levels', () => {
    expect(formatTimer(3 * 3600 + 25 * 60 + 9)).toBe('03:25:09');
    expect(formatFlightLevel(3690)).toBe('FL037');
    expect(formatFlightLevel(450)).toBe('FL005');
    expect(formatFlightLevel(-300)).toBe('FL-03');
    expect(digitsToSeconds('0130')).toBe(5400);
    expect(digitsToSeconds('009999')).toBe(59 * 60 + 59);
  });
});
