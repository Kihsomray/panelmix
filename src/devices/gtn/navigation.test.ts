import { describe, expect, it } from 'vitest';
import type { Page } from './model';
import { HOME, initialNav, navReducer, nextShortcut, topPage, type NavAction, type NavState } from './navigation';
import { GTN_RANGES, initialSettings, settingsReducer } from './settings';
import { startSquawk } from './squawk';

const run = (model: '650' | '750', ...actions: NavAction[]) =>
  actions.reduce((s: NavState, a) => navReducer(model, s, a), initialNav());

const fpl: Page = { kind: 'flightPlan', cursor: null };

describe('page navigation', () => {
  it('stacks pages over Home; Back pops and HOME clears', () => {
    let s = run('750', { type: 'open', page: { kind: 'nearest' } }, { type: 'open', page: { kind: 'nearestList', category: 'vor', cursor: null } });
    expect(s.stack.map((p) => p.kind)).toEqual(['home', 'nearest', 'nearestList']);
    s = navReducer('750', s, { type: 'back' });
    expect(topPage(s).kind).toBe('nearest');
    s = navReducer('750', s, { type: 'home' });
    expect(s.stack).toEqual([HOME]);
    expect(navReducer('750', s, { type: 'back' })).toBe(s);
  });

  it('closes a pop-up before leaving the page', () => {
    let s = run('650', { type: 'open', page: fpl }, { type: 'modal', modal: { kind: 'fplMenu' } });
    s = navReducer('650', s, { type: 'back' });
    expect(s.modal).toBeNull();
    expect(topPage(s).kind).toBe('flightPlan');
  });

  it('replaces instead of stacking the same page twice', () => {
    const s = run('750', { type: 'open', page: fpl }, { type: 'open', page: { ...fpl, cursor: 2 } });
    expect(s.stack).toHaveLength(2);
    expect(topPage(s)).toEqual({ kind: 'flightPlan', cursor: 2 });
  });

  it('updates only the page on screen', () => {
    const s = run('750', { type: 'open', page: fpl });
    expect(navReducer('750', s, { type: 'update', page: { kind: 'map' } })).toBe(s);
    expect(topPage(navReducer('750', s, { type: 'update', page: { ...fpl, cursor: 1 } }))).toEqual({ ...fpl, cursor: 1 });
  });

  it('holding HOME opens the map on the 750Xi and Default Navigation on the 650Xi', () => {
    expect(topPage(run('750', { type: 'homeHold' })).kind).toBe('map');
    expect(topPage(run('650', { type: 'homeHold' })).kind).toBe('defaultNav');
  });
});

describe('dual knob', () => {
  it('push cycles page navigation, COM standby, NAV standby', () => {
    const s = run('650', { type: 'knobPush' });
    expect(s.focus).toBe('com');
    expect(navReducer('650', s, { type: 'knobPush' }).focus).toBe('nav');
    expect(run('650', { type: 'knobPush' }, { type: 'knobPush' }, { type: 'knobPush' }).focus).toBe('page');
  });

  it('gives the knob back to page navigation when a data entry page opens', () => {
    const s = run('750', { type: 'knobPush' }, { type: 'open', page: { kind: 'xpdr', entry: startSquawk('1200') } });
    expect(s.focus).toBe('page');
  });

  it('steps the locater bar from Home and between slots', () => {
    expect(nextShortcut('750', HOME, 1)).toBe('map');
    expect(nextShortcut('650', HOME, 1)).toBe('nav');
    expect(nextShortcut('750', HOME, -1)).toBe('nrst');
    expect(nextShortcut('750', { kind: 'map' }, 1)).toBe('fpl');
    expect(nextShortcut('750', { kind: 'map' }, -3)).toBe('map');
    let s = run('750', { type: 'shortcut', steps: 1 });
    expect(topPage(s).kind).toBe('map');
    s = navReducer('750', s, { type: 'shortcut', steps: 1 });
    expect(s.stack.map((p) => p.kind)).toEqual(['home', 'flightPlan']);
    s = navReducer('750', s, { type: 'shortcut', steps: 20 });
    expect(topPage(s)).toEqual({ kind: 'nearestList', category: 'airport', cursor: null });
  });
});

describe('settings', () => {
  it('zooms through the GTN ranges and stops at the ends', () => {
    let s = initialSettings('750');
    s = settingsReducer(s, { type: 'zoom', steps: -1 });
    expect(s.rangeNm).toBe(3);
    s = settingsReducer(s, { type: 'zoom', steps: -50 });
    expect(s.rangeNm).toBe(GTN_RANGES[0]);
    s = settingsReducer(s, { type: 'zoom', steps: 50 });
    expect(s.rangeNm).toBe(GTN_RANGES[GTN_RANGES.length - 1]);
  });

  it('keeps recent lists unique, newest first', () => {
    let s = initialSettings('650');
    for (const khz of [121500, 118300, 121500]) s = settingsReducer(s, { type: 'recentFreq', band: 'com', khz });
    expect(s.recentFreqs.com).toEqual([121500, 118300]);
    const w = { kind: 'vor' as const, ident: 'MRB', name: 'Martinsburg', lat: 39, lon: -77 };
    s = settingsReducer(settingsReducer(s, { type: 'recentWaypoint', waypoint: w }), { type: 'recentWaypoint', waypoint: w });
    expect(s.recentWaypoints).toHaveLength(1);
  });

  it('edits the user fields of one page at a time', () => {
    let s = settingsReducer(initialSettings('650'), { type: 'editFields', page: 'nav' });
    expect(s.editingFields).toBe('nav');
    s = settingsReducer(s, { type: 'navField', index: 5, field: 'ETE' });
    expect(s.navFields[5]).toBe('ETE');
    const same = settingsReducer(s, { type: 'editFields', page: 'nav' });
    expect(same).toBe(s);
    expect(settingsReducer(s, { type: 'editFields', page: null }).editingFields).toBeNull();
  });

  it('changes and restores user fields, clamps volume', () => {
    let s = settingsReducer(initialSettings('750'), { type: 'mapField', index: 1, field: 'ETE' });
    expect(s.mapFields).toEqual(['DTK', 'ETE', 'GS', 'DIS']);
    s = settingsReducer(s, { type: 'restoreMapFields' });
    expect(s.mapFields[1]).toBe('TRK');
    s = settingsReducer(s, { type: 'volume', band: 'com', steps: 100 });
    expect(s.volume.com).toBe(100);
  });
});
