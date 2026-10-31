import { describe, expect, it } from 'vitest';
import type { SoftkeyRow } from '../shared/softkeys';
import { bearingChoice, nextBearing, PFD_DEFAULTS, PFD_KEYS_START, pfdSoftkeys, pressPfdSoftkey, endCodeEntry, type PfdKeyContext, type PfdKeys } from './pfdSoftkeys';
import { moveListCursor } from './pfdState';
import {
  DEFAULT_REFERENCES,
  formatTimer,
  openTimerRef,
  referencesMenu,
  timerRefEnt,
  timerRefInner,
  timerRefOuter,
  timerShown,
  TMR_FIELDS,
  type References,
  type TimerRefWindow,
} from './timerRef';

const ctx: PfdKeyContext = {
  xpdrMode: 'ALT',
  bearing1: 'OFF',
  bearing2: 'OFF',
  cdiSource: 'GPS',
  cdiSources: ['GPS', 'NAV1', 'NAV2'],
  obsAvailable: true,
  obsMode: false,
  baroStd: false,
  alert: null,
  now: 0,
};

const labels = (row: SoftkeyRow) => row.map((k) => k?.label ?? '');
/** Presses the softkey labelled `label` (1-based position found from the row). */
function press(keys: PfdKeys, label: string, c: PfdKeyContext = ctx) {
  const index = labels(pfdSoftkeys(keys, c)).indexOf(label);
  if (index < 0) throw new Error(`no ${label} softkey in ${labels(pfdSoftkeys(keys, c)).join(',')}`);
  return pressPfdSoftkey(keys, index, c);
}

describe('PFD softkeys', () => {
  it('top level matches the Nav III layout, ALERTS in key 12', () => {
    expect(labels(pfdSoftkeys(PFD_KEYS_START, ctx))).toEqual([
      '',
      'INSET',
      '',
      'PFD',
      'OBS',
      'CDI',
      'DME',
      'XPDR',
      'IDENT',
      'TMR/REF',
      'NRST',
      'ALERTS',
    ]);
  });

  it('PFD menu: WIND options, BRG1/BRG2, HSI FRMT, STD BARO, BACK', () => {
    const pfd = press(PFD_KEYS_START, 'PFD').keys;
    expect(labels(pfdSoftkeys(pfd, ctx))).toEqual(['', 'DFLTS', 'WIND', 'DME', 'BRG1', 'HSI FRMT', 'BRG2', '', 'ALT UNIT', 'STD BARO', 'BACK', 'ALERTS']);
    const wind = press(pfd, 'WIND').keys;
    const optn2 = press(wind, 'OPTN 2').keys;
    expect(optn2.settings.wind).toBe(2);
    expect(pfdSoftkeys(optn2, ctx)[3]?.on).toBe(true);
    expect(press(optn2, 'OFF').keys.settings.wind).toBe(0);
    expect(press(wind, 'BACK').keys.menu).toBe('pfd');
    expect(press(pfd, 'BACK').keys.menu).toBe('root');
    expect(press(pfd, 'STD BARO').commands).toEqual([{ type: 'baro.std', on: true }]);
  });

  it('BRG1 cycles OFF, NAV1, GPS, ADF and back to OFF', () => {
    expect(nextBearing(1, 'OFF')).toBe('NAV1');
    expect(nextBearing(1, 'NAV1')).toBe('GPS');
    expect(nextBearing(1, 'GPS')).toBe('ADF');
    expect(nextBearing(1, 'ADF')).toBe('OFF');
    expect(nextBearing(2, 'OFF')).toBe('NAV2');
    const pfd = press(PFD_KEYS_START, 'PFD').keys;
    expect(press(pfd, 'BRG1').commands).toEqual([{ type: 'bearing.set', pointer: 1, source: 'NAV1' }]);
    const adf = press(pfd, 'BRG1', { ...ctx, bearing1: 'GPS' });
    expect(adf.commands).toEqual([{ type: 'bearing.set', pointer: 1, source: 'OFF' }]);
    expect(bearingChoice(1, 'OFF', adf.keys.settings)).toBe('ADF');
  });

  it('HSI FRMT selects the arc and disables the bearing pointers', () => {
    const fmt = press(press(PFD_KEYS_START, 'PFD').keys, 'HSI FRMT').keys;
    const arc = press(fmt, 'ARC HSI').keys;
    expect(arc.settings.hsiArc).toBe(true);
    const pfd = press(arc, 'BACK').keys;
    expect(pfdSoftkeys(pfd, ctx)[4]?.disabled).toBe(true);
  });

  it('DFLTS turns off the inset map, wind and bearing pointers', () => {
    const out = press(press(PFD_KEYS_START, 'PFD').keys, 'DFLTS');
    expect(out.keys.settings).toEqual(PFD_DEFAULTS);
    expect(out.commands).toContainEqual({ type: 'bearing.set', pointer: 1, source: 'OFF' });
  });

  it('INSET opens the map with its own keys; OFF removes it', () => {
    const inset = press({ ...PFD_KEYS_START, settings: PFD_DEFAULTS }, 'INSET').keys;
    expect(inset.settings.inset).toBe(true);
    const dcltr = press(inset, 'DCLTR').keys;
    expect(pfdSoftkeys(dcltr, ctx)[1]?.label).toBe('DCLTR-1');
    const off = press(inset, 'OFF').keys;
    expect(off.settings.inset).toBe(false);
    expect(off.menu).toBe('root');
  });

  it('CDI cycles the panel sources and moves the NAV tuning box with it', () => {
    const out = press(PFD_KEYS_START, 'CDI');
    expect(out.commands).toEqual([{ type: 'cdi.cycle', sources: ctx.cdiSources }]);
    expect(out.tuneNav).toBe(0);
    expect(press(PFD_KEYS_START, 'CDI', { ...ctx, cdiSource: 'NAV2' }).tuneNav).toBeUndefined();
  });

  it('OBS is only available with GPS and an active leg', () => {
    expect(press(PFD_KEYS_START, 'OBS').commands).toEqual([{ type: 'fms.obs', on: true }]);
    const noLeg = { ...ctx, obsAvailable: false };
    expect(pfdSoftkeys(PFD_KEYS_START, noLeg)[4]?.disabled).toBe(true);
    expect(pressPfdSoftkey(PFD_KEYS_START, 4, noLeg).commands).toEqual([]);
  });

  it('XPDR: modes, VFR, IDENT, and CODE entry with the digit softkeys', () => {
    const xpdr = press(PFD_KEYS_START, 'XPDR').keys;
    expect(labels(pfdSoftkeys(xpdr, ctx))).toEqual(['', '', 'STBY', 'ON', 'ALT', 'GND', 'VFR', 'CODE', 'IDENT', '', 'BACK', 'ALERTS']);
    expect(press(xpdr, 'STBY').commands).toEqual([{ type: 'xpdr.mode', mode: 'STBY' }]);
    expect(press(xpdr, 'VFR').commands).toEqual([{ type: 'xpdr.code', code: '1200' }]);
    expect(press(xpdr, 'IDENT').commands).toEqual([{ type: 'xpdr.ident' }]);
    let code = press(xpdr, 'CODE').keys;
    expect(labels(pfdSoftkeys(code, ctx)).slice(0, 8)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    for (const d of ['4', '5', '2', '1']) code = press(code, d).keys;
    expect(code.code?.digits).toBe('4521');
    code = press(code, 'BKSP').keys;
    expect(code.code?.digits).toBe('452');
    expect(press(code, 'BACK').keys).toMatchObject({ menu: 'xpdr', code: null });
    expect(endCodeEntry(code)).toMatchObject({ menu: 'root', code: null });
  });

  it('an alert turns ALERTS into the flashing level; the first press acknowledges it', () => {
    const c = { ...ctx, alert: 'caution' as const };
    expect(pfdSoftkeys(PFD_KEYS_START, c)[11]).toMatchObject({ label: 'CAUTION', alert: 'caution' });
    expect(pressPfdSoftkey(PFD_KEYS_START, 11, c)).toMatchObject({ commands: [{ type: 'msg.readAll' }] });
    expect(pressPfdSoftkey(PFD_KEYS_START, 11, ctx).toggleWindow).toBe('alerts');
  });

  it('TMR/REF and NRST open their windows', () => {
    expect(press(PFD_KEYS_START, 'TMR/REF').toggleWindow).toBe('tmrRef');
    expect(press(PFD_KEYS_START, 'NRST').toggleWindow).toBe('nrst');
    expect(press(PFD_KEYS_START, 'DME').toggleWindow).toBe('dme');
  });

  it('list cursors start on the first item', () => {
    expect(moveListCursor(null, 3, 10)).toBe(0);
    expect(moveListCursor(2, 30, 10)).toBe(9);
    expect(moveListCursor(2, 1, 0)).toBeNull();
  });
});

describe('Timer/References window', () => {
  const at = (w: TimerRefWindow, field: (typeof TMR_FIELDS)[number]): TimerRefWindow => ({ ...w, field: TMR_FIELDS.indexOf(field) });

  it('starts, stops and resets the count-up timer on sim time', () => {
    let refs: References = DEFAULT_REFERENCES;
    let w = at(openTimerRef(refs), 'ctl');
    ({ window: w, refs } = timerRefEnt(w, refs, 100));
    expect(w.ctl).toBe('stop');
    expect(timerShown(refs.timer, 190)).toBe(90);
    ({ window: w, refs } = timerRefEnt(w, refs, 190));
    expect(timerShown(refs.timer, 500)).toBe(90);
    expect(w.ctl).toBe('reset');
    ({ window: w, refs } = timerRefEnt(w, refs, 500));
    expect(timerShown(refs.timer, 600)).toBe(0);
    expect(formatTimer(3725)).toBe('01:02:05');
  });

  it('counts down from a preset', () => {
    let refs: References = DEFAULT_REFERENCES;
    let w = openTimerRef(refs);
    ({ refs } = timerRefInner(at(w, 'dir'), refs, 1, 0));
    expect(refs.timer.up).toBe(false);
    ({ refs } = timerRefInner(at(w, 'time'), refs, 2, 0));
    expect(timerShown(refs.timer, 0)).toBe(120);
    ({ window: w, refs } = timerRefEnt(at(w, 'ctl'), refs, 10));
    expect(timerShown(refs.timer, 40)).toBe(90);
    expect(timerShown(refs.timer, 1000)).toBe(0);
  });

  it('edits V-speeds and their flags, minimums, and the page menu', () => {
    const w = openTimerRef(DEFAULT_REFERENCES);
    let refs = timerRefInner(at(w, 'vy'), DEFAULT_REFERENCES, 2, 0).refs;
    expect(refs.vspeeds.find((v) => v.id === 'vy')?.kt).toBe(76);
    refs = timerRefInner(at(w, 'vyOn'), refs, 1, 0).refs;
    expect(refs.vspeeds.find((v) => v.id === 'vy')?.on).toBe(true);
    refs = timerRefInner(at(w, 'minMode'), refs, 1, 0).refs;
    refs = timerRefInner(at(w, 'minFt'), refs, -5, 0).refs;
    expect(refs).toMatchObject({ minimumsOn: true, minimumsFt: 950 });
    expect(referencesMenu(refs, 'allOn').vspeeds.every((v) => v.on)).toBe(true);
    expect(referencesMenu(refs, 'defaults').vspeeds.find((v) => v.id === 'vy')?.kt).toBe(74);
    expect(timerRefOuter(w, 99).field).toBe(TMR_FIELDS.length - 1);
  });
});
