import { describe, expect, it } from 'vitest';
import type { SoftkeyRow } from '../shared/softkeys';
import { checkItem, isChecked, moveChecklist, toggleEmergency } from './checklists';
import { cylinderEgts, vacuumInHg } from './Eis';
import { findPage, fplKey, goTo, MFD_PAGES_START, PAGE_GROUPS, pageId, pageTitle, pickerVisible, procKey, selectGroup, selectPage } from './mfdPages';
import { fuelRemaining, fuelUsed, mfdKeysStart, mfdSoftkeys, pressMfdSoftkey, type MfdKeys } from './mfdSoftkeys';
import { mfdUiStart, NRST_START, nrstMove, nrstPush, nrstSection, WPT_START, wptClr, wptEnt, wptInner, wptOuter, wptPush } from './mfdState';

const labels = (row: SoftkeyRow) => row.map((k) => k?.label ?? '');

describe('MFD page groups', () => {
  it('the first click opens the page selection window without changing the page', () => {
    const p = selectGroup(MFD_PAGES_START, 1, 0);
    expect(pageId(p)).toBe('navMap');
    expect(pickerVisible(p, 10)).toBe(true);
    expect(pageId(selectPage(p, 1, 10))).toBe('trafficMap');
  });

  it('large knob picks the group, small knob the page, and each group remembers its page', () => {
    let p = selectGroup(selectGroup(MFD_PAGES_START, 1, 0), 1, 0);
    expect(pageId(p)).toBe('airportInfo');
    p = selectPage(p, 3, 0);
    expect(pageId(p)).toBe('vorInfo');
    p = selectGroup(p, 4, 0);
    expect(pageId(p)).toBe('nrstAirports');
    expect(pageTitle(p)).toBe('NRST - NEAREST AIRPORTS');
    p = selectGroup(p, -4, 0);
    expect(pageId(p)).toBe('vorInfo');
    expect(pageId(selectGroup(p, 99, 0))).toBe('nrstAirports');
  });

  it('shows the page list while selecting, then hides it', () => {
    const p = selectPage(MFD_PAGES_START, 1, 1000);
    expect(pickerVisible(p, 1500)).toBe(true);
    expect(pickerVisible(p, 5000)).toBe(false);
  });

  it('FPL opens the active flight plan and a second press returns', () => {
    const start = selectGroup(selectGroup(MFD_PAGES_START, 2, 0), 2, 0);
    const fpl = fplKey(start);
    expect(pageId(fpl)).toBe('activeFpl');
    expect(pageId(fplKey(fpl))).toBe('tripPlanning');
  });

  it('PROC shows the procedures page over the current page; CLR held goes to the map', () => {
    const proc = procKey(MFD_PAGES_START);
    expect(pageId(proc)).toBe('procedures');
    expect(pageTitle(proc)).toBe('PROC - PROCEDURES');
    expect(pageId(procKey(proc))).toBe('navMap');
    expect(pageId(goTo(selectGroup(selectGroup(MFD_PAGES_START, 5, 0), 5, 0), 'navMap'))).toBe('navMap');
    expect(findPage('nrstVor')).toEqual({ group: PAGE_GROUPS.findIndex((g) => g.id === 'NRST'), page: 3 });
  });
});

describe('MFD softkeys', () => {
  const k0 = mfdKeysStart(48);
  const press = (k: MfdKeys, label: string, page = pageId(MFD_PAGES_START), tanks = 48) => {
    const i = labels(mfdSoftkeys(k, page)).indexOf(label);
    if (i < 0) throw new Error(`no ${label}`);
    return pressMfdSoftkey(k, i, page, tanks);
  };

  it('map page: ENGINE, MAP, DCLTR, CHKLIST in their keys; DCLTR cycles', () => {
    expect(labels(mfdSoftkeys(k0, 'navMap'))).toEqual(['ENGINE', '', 'MAP', '', '', '', '', '', '', 'DCLTR', '', 'CHKLIST']);
    const d1 = press(k0, 'DCLTR').keys;
    expect(d1.map.declutter).toBe(1);
    expect(labels(mfdSoftkeys(d1, 'navMap'))[9]).toBe('DCLTR-1');
    expect(press(k0, 'CHKLIST').goTo).toBe('checklist');
  });

  it('MAP keys toggle overlays; BACK returns to the page keys', () => {
    const map = press(k0, 'MAP').keys;
    expect(labels(mfdSoftkeys(map, 'navMap')).slice(0, 5)).toEqual(['TRAFFIC', 'PROFILE', 'TOPO', 'TERRAIN', 'AIRWAYS']);
    const topo = press(map, 'TOPO').keys;
    expect(topo.map.topo).toBe(true);
    expect(press(topo, 'BACK').keys.menu).toBe('page');
  });

  it('ENGINE leads to LEAN and SYSTEM, with the fuel totalizer', () => {
    const eng = press(k0, 'ENGINE').keys;
    expect(labels(mfdSoftkeys(eng, 'navMap')).slice(0, 4)).toEqual(['ENGINE', 'LEAN', 'SYSTEM', 'BACK']);
    const lean = press(eng, 'LEAN').keys;
    expect(lean.eis).toBe('lean');
    expect(press(lean, 'CYL SLCT').keys.cylinder).toBe(2);
    const sys = press(lean, 'SYSTEM').keys;
    const gal = press(sys, 'GAL REM').keys;
    const minus = press(gal, '-10 GAL').keys;
    expect(fuelRemaining(minus.fuel, 48)).toBe(38);
    // Burning 2 gallons afterwards is subtracted from the setting.
    expect(fuelRemaining(minus.fuel, 46)).toBe(36);
    expect(fuelUsed(minus.fuel, 46)).toBe(2);
    expect(fuelRemaining(press(gal, '53 GAL').keys.fuel, 48)).toBe(53);
    expect(press(gal, 'BACK').keys.menu).toBe('system');
    expect(press(sys, 'BACK').keys).toMatchObject({ menu: 'page', eis: 'engine' });
  });

  it('flight plan page: ACT LEG acts, VNV keys are unavailable', () => {
    const row = mfdSoftkeys(k0, 'activeFpl');
    expect(row[9]?.label).toBe('ACT LEG');
    expect(row[5]?.disabled).toBe(true);
    expect(press(k0, 'ACT LEG', 'activeFpl').action).toBe('actLeg');
  });

  it('nearest airports page: APT, RNWY, FREQ move the cursor', () => {
    expect(labels(mfdSoftkeys(k0, 'nrstAirports')).slice(4, 8)).toEqual(['APT', 'RNWY', 'FREQ', 'APR']);
    expect(press(k0, 'FREQ', 'nrstAirports').action).toBe('freq');
  });
});

describe('waypoint and nearest page cursors', () => {
  const complete = (p: string) => (p.startsWith('K') ? 'KHGR'.slice(0, Math.max(p.length, 4)) : undefined);
  const counts = { runways: 2, freqs: 3 };

  it('edits the identifier and accepts it with ENT', () => {
    let w = wptPush(WPT_START);
    expect(w.cursor).toBe('ident');
    for (let i = 0; i < 11; i++) w = wptInner(w, 1, complete, '', counts);
    expect(w.entry?.text).toBe('KHGR');
    w = wptEnt(w, 'airport', (id) => id === 'KHGR');
    expect(w.idents.airport).toBe('KHGR');
    expect(w.entry).toBeNull();
  });

  it('the large knob moves between the airport boxes; the small knob steps runways and frequencies', () => {
    let w = wptOuter(wptPush(WPT_START), 1, true);
    expect(w.cursor).toBe('runway');
    w = wptInner(w, 1, complete, 'KHGR', counts);
    expect(w.runway).toBe(1);
    w = wptInner(w, 1, complete, 'KHGR', counts);
    expect(w.runway).toBe(0);
    w = wptOuter(w, 1, true);
    w = wptInner(w, 5, complete, 'KHGR', counts);
    expect(w).toMatchObject({ cursor: 'freq', freq: 2 });
    expect(wptClr(w).cursor).toBe('off');
  });

  it('nearest lists: push selects the nearest item, softkeys pick the box', () => {
    let n = nrstPush(NRST_START);
    expect(n.item).toBe(0);
    n = nrstMove(n, 3, 10, counts);
    expect(n.item).toBe(3);
    n = nrstSection(n, 'freq');
    n = nrstMove(n, 1, 10, counts);
    expect(n).toMatchObject({ section: 'freq', freq: 1, item: 3 });
    expect(nrstPush(n)).toEqual(NRST_START);
  });

  it('starts on the navigation map with the totalizer set to the tanks', () => {
    const ui = mfdUiStart(48);
    expect(pageId(ui.pages)).toBe('navMap');
    expect(fuelRemaining(ui.keys.fuel, 48)).toBe(48);
  });
});

describe('checklists and engine helpers', () => {
  it('checks items and moves on; the emergency group is separate', () => {
    let c = mfdUiStart(48).checklist;
    c = checkItem(c);
    expect(isChecked(c, 0, 0)).toBe(true);
    expect(c.item).toBe(1);
    c = moveChecklist(c, 'outer', 1);
    expect(c).toMatchObject({ list: 1, item: 0 });
    const e = toggleEmergency(c);
    expect(e.emergency).toBe(true);
    expect(isChecked(e, 0, 0)).toBe(false);
  });

  it('vacuum and cylinder EGTs are plausible', () => {
    expect(vacuumInHg(2300)).toBeCloseTo(5, 1);
    const egts = cylinderEgts(1350);
    expect(Math.max(...egts)).toBe(1350);
    expect(egts).toHaveLength(4);
  });
});
