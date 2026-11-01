import { describe, expect, it } from 'vitest';
import { bearing, destination } from '../../../core/geo';
import { NavDatabase } from '../../../core/navdb';
import { approach, KJYO } from '../../../sim/fms/testkit';
import { initialSimState } from '../../../sim/defaults';
import type { SimMessage } from '../../../sim/types';
import { bestApproach, nearestFixes } from './data';
import { fplRows } from './fpl';
import { legView } from './legView';
import { unitMessages } from './messages';
import { TERRAIN_RANGES_NM } from './navPages';
import { procItems } from './proc';
import { advisory } from './advisory';
import { CRSR, db, key, large, mag, rig, small, type Rig } from './testRig';
import type { ChoiceOption } from './types';
import { INITIAL_WATCH, MESSAGES, watch } from './watch';

/*
 * The v2 workflows against the shared simulator: instrument procedures from
 * the CIFP (KJYO RNAV 17 with LPV, ILS 17 on IJYO 111.75), the approach in
 * the flight plan, SUSP and the missed approach, the automatic ILS CDI
 * switch, intersections, arrivals and departures, terrain and messages.
 */

/** A fix of a KJYO approach, where the procedure puts it (step-down fixes are only in the procedure records). */
function fix(ident: string, id = 'I17'): { lat: number; lon: number } {
  const a = approach(id);
  const leg = [...a.transitions.flatMap((t) => t.legs), ...a.final, ...a.missed].find((l) => l.fix?.ident === ident);
  if (!leg?.fix) throw new Error(`${ident} not in KJYO ${id}`);
  return leg.fix;
}

/** About 15 nm northwest of KJYO, inbound, with KJYO as the destination. */
function nearKjyo(model: '430' | '530' = '430'): Rig {
  const r = rig(model);
  const at = destination(KJYO, 315, 15);
  r.sim.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt: 4000, headingTrue: bearing(at, KJYO), iasKt: 100 });
  r.sim.dispatch({ type: 'fms.replacePlan', plan: [KJYO] });
  r.sim.dispatch({ type: 'fms.directTo', waypoint: KJYO, planIndex: 0 });
  return r;
}

/** Turns the small knob to the window entry labelled `label` and presses ENT. */
function pick(r: Rig, label: string) {
  const p = r.ui.popup;
  if (p?.kind !== 'choice') throw new Error(`no window open (${p?.kind})`);
  const i = p.options.findIndex((o: ChoiceOption) => o.label === label);
  expect(i, `${label} in ${p.options.map((o) => o.label).join(', ')}`).toBeGreaterThanOrEqual(0);
  r.send(small(i - p.index), key('ENT'));
}

const labels = (r: Rig) => (r.ui.popup?.kind === 'choice' ? r.ui.popup.options.map((o) => (o.tag ? `${o.label} ${o.tag}` : o.label)) : []);

describe('PROC: selecting, loading and activating approaches', () => {
  it('flies the PROC flow for KJYO RNAV 17 from the MRB transition, as the guide describes', () => {
    const r = nearKjyo();
    r.send(key('PROC'), key('ENT')); // "Select Approach?"
    expect(r.page).toBe('wpt.apr');
    expect(r.ui.wpt.airport?.ident).toBe('KJYO');
    expect(labels(r)).toEqual(['ILS 17', 'LOC 17', 'RNAV 17']);
    expect(r.ui.popup?.kind === 'choice' && r.ui.popup.options[2]?.gps).toBe(true);
    pick(r, 'RNAV 17');
    // The TRANS window opens by itself: VECTORS and the IAFs.
    expect(labels(r)).toEqual(['VECTORS', 'CACAS IA', 'HOAGE IA', 'MRB IA', 'ZAXEN IA']);
    pick(r, 'MRB');
    // "Load?" is highlighted; the large knob moves to "Activate?".
    expect(r.ui.cursor).toBe(3);
    r.send(large(1), key('ENT'));
    const fms = r.sim.getState().fms;
    expect(fms.approach).toMatchObject({ transition: 'MRB', activated: true });
    expect(fms.approach?.approach.id).toBe('R17');
    expect(fms.activeLeg?.to.ident).toBe('MRB');
    // "Once you activate the approach, the active flight plan page will appear."
    expect(r.page).toBe('fpl.active');
    expect(r.sim.getDerived().approach?.mode).toBe('LPV');
  });

  it('asks for the monitoring-only reminder before loading the ILS, and tunes IJYO into the VLOC standby', () => {
    const r = nearKjyo();
    r.send(key('PROC'), key('ENT'));
    pick(r, 'ILS 17');
    pick(r, 'MRB');
    r.send(key('ENT')); // Load?
    expect(r.ui.popup).toMatchObject({ kind: 'procConfirm', reason: 'monitor', yes: true });
    r.send(key('ENT'));
    const s = r.sim.getState();
    expect(s.fms.approach?.approach.id).toBe('I17');
    expect(s.fms.approach?.activated).toBe(false);
    expect(s.radios.nav[0].standbyKhz).toBe(111750);
    // "No?" leaves everything as it was.
    r.send(key('PROC'));
    expect(procItems(s.fms)).toEqual(['vtf', 'activate', 'approach', 'arrival', 'departure']);
    expect(r.ui.cursor).toBe(1); // "Activate Approach?" with an approach loaded
  });

  it('activates vectors to final from the PROC page', () => {
    const r = nearKjyo();
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'MRB', activate: 'load' });
    r.send(key('PROC'));
    r.send(large(-1), key('ENT')); // "Activate Vector-To-Final?"
    const leg = r.sim.getState().fms.activeLeg!;
    expect(leg.from.ident).toBe('VTF');
    expect(leg.to.ident).toBe('DANMO');
    expect(r.ui.fn).toBe(null);
  });

  it('asks before discontinuing the approach being flown, and VECTORS activates vectors to final', () => {
    const r = nearKjyo();
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'MRB', activate: 'activate' });
    r.send(key('PROC'), key('ENT')); // Activate Approach?
    expect(r.ui.popup).toMatchObject({ kind: 'procConfirm', reason: 'restart' });
    r.send(large(1), key('ENT')); // No?
    expect(r.ui.popup).toBe(null);
    expect(r.page).toBe('proc');
    r.send(large(1), key('ENT')); // Select Approach?
    pick(r, 'RNAV 17');
    pick(r, 'VECTORS');
    r.send(large(1), key('ENT')); // Activate? (the same approach, restarted with vectors)
    expect(r.ui.popup).toMatchObject({ kind: 'procConfirm', reason: 'restart' });
    r.send(key('ENT'));
    const fms = r.sim.getState().fms;
    expect(fms.approach?.transition).toBe(null);
    expect(fms.approach?.vectorsToFinal).toBe(true);
  });

  it('shows the arrival and departure pages and adds a procedure\'s fixes to the enroute plan', () => {
    const r = nearKjyo();
    r.sim.dispatch({ type: 'fms.replacePlan', plan: [NavDatabase.toWaypoint(db.airport('KHGR')!), KJYO] });
    r.send(key('PROC'), large(1), key('ENT')); // Select Arrival?
    expect(r.page).toBe('wpt.arvl');
    expect(labels(r)).toContain('GIBBZ6');
    pick(r, 'GIBBZ6');
    pick(r, 'HVQ'); // transition, then RUNWAY
    pick(r, 'ALL');
    expect(r.ui.cursor).toBe(4);
    r.send(key('ENT')); // Load?
    const plan = r.sim.getState().fms.plan.map((w) => w.ident);
    expect(plan[0]).toBe('KHGR');
    expect(plan.at(-1)).toBe('KJYO');
    expect(plan.length).toBeGreaterThan(3);
    expect(r.page).toBe('fpl.active');
  });
});

describe('the approach in the flight plan', () => {
  function loaded(id = 'R17', transition: string | null = 'MRB') {
    const r = nearKjyo();
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach(id), transition, activate: 'load' });
    r.send(key('FPL'));
    return r;
  }

  it('lists the approach under its header and flies direct to an approach fix with D->', () => {
    const r = loaded();
    const rows = fplRows(r.sim.getState().fms);
    expect(rows.map((x) => x.kind)).toEqual(['blank', 'header', 'leg', 'leg', 'leg', 'leg', 'leg', 'leg', 'leg', 'leg']);
    r.send(CRSR);
    const danmo = rows.findIndex((x) => x.kind === 'leg' && r.sim.getState().fms.approach!.legs[x.index]!.to?.ident === 'DANMO');
    r.send(large(danmo - r.ui.cursor!), key('DTO'));
    expect(r.ui.dto.wp?.ident).toBe('DANMO');
    r.send(key('ENT'), key('ENT'));
    const s = r.sim.getState().fms;
    expect(s.activeLeg).toMatchObject({ isDirectTo: true });
    expect(s.activeLeg?.to.ident).toBe('DANMO');
    expect(s.approach?.activated).toBe(true);
  });

  it('activates an approach leg from the page menu and removes the approach with CLR on its header', () => {
    const r = loaded();
    r.send(CRSR, large(4)); // the DANMO leg (blank, header, MRB, CACAS, DANMO)
    r.send(key('MENU'), key('ENT')); // Activate Leg?
    expect(r.ui.popup).toMatchObject({ kind: 'activateLeg', target: 'approach' });
    r.send(key('ENT'));
    const s = r.sim.getState().fms;
    expect(s.activeLeg?.to.ident).toBe('DANMO');
    expect(s.activeLeg?.from.ident).toBe('CACAS');
    r.send(CRSR, large(-20), large(1), key('CLR'));
    expect(r.ui.popup).toMatchObject({ kind: 'confirm', action: 'fpl.removeApproach' });
    r.send(key('ENT'));
    expect(r.sim.getState().fms.approach).toBe(null);
  });

  it('offers the approach fixes in the D-> page FPL window', () => {
    const r = loaded();
    r.send(key('DTO'), large(1), small(1));
    const p = r.ui.popup;
    expect(p?.kind === 'list' && p.items.map((w) => w.ident)).toEqual(['MRB', 'CACAS', 'DANMO', 'CEYAC', 'RW17', 'KORNY']);
  });
});

describe('SUSP and the missed approach', () => {
  it('suspends at the MAP and resumes into the missed approach with OBS', () => {
    const r = rig('430', initialSimState());
    const rw17 = { lat: 39.08512, lon: -77.56061 };
    const ceyac = fix('CEYAC', 'R17');
    // On final between CEYAC and the runway, flying the MAP leg with the autopilot.
    const at = destination(rw17, bearing(rw17, ceyac), 1.2);
    r.sim.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt: 800, headingTrue: bearing(ceyac, rw17), iasKt: 90 });
    r.sim.dispatch({ type: 'fms.replacePlan', plan: [KJYO] });
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: null, activate: 'activate' });
    const map = r.sim.getState().fms.approach!.legs.findIndex((l) => l.role === 'MAP');
    r.sim.dispatch({ type: 'fms.activateApproachLeg', index: map });
    r.sim.dispatch({ type: 'ap.engage', on: true });
    r.sim.dispatch({ type: 'ap.lateral', mode: 'NAV' });
    r.sim.dispatch({ type: 'ap.vertical', mode: 'ALT' });
    for (let t = 0; t < 120 && !r.sim.getState().fms.suspended; t++) r.sim.step(1);
    expect(r.sim.getState().fms.suspended).toBe(true);
    r.send(key('OBS'));
    const s = r.sim.getState().fms;
    expect(s.suspended).toBe(false);
    expect(s.obsMode).toBe(false);
    expect(s.approach!.legs[s.activeLeg!.approachIndex!]!.segment).toBe('missed');
  });
});

describe('what the unit does by itself', () => {
  /** ILS 17 vectors to final, the airplane on the final course `nm` before DANMO. */
  function onFinal(nm: number, tune: boolean) {
    const r = rig('430', initialSimState());
    const danmo = fix('DANMO');
    const course = bearing(fix('JOTUP'), danmo);
    const at = destination(danmo, course + 180, nm);
    r.sim.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt: 2500, headingTrue: course, iasKt: 90 });
    r.sim.dispatch({ type: 'fms.replacePlan', plan: [KJYO] });
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('I17'), transition: null, activate: 'vtf' });
    if (tune) r.sim.dispatch({ type: 'nav.setActive', radio: 0, khz: 111750 });
    return r;
  }

  it('switches the CDI to VLOC once established on the ILS final, and only once', () => {
    const r = onFinal(6, true);
    expect(r.sim.getState().nav.cdiSource).toBe('GPS');
    r.watch();
    expect(r.sim.getState().nav.cdiSource).toBe('NAV1');
    r.sim.dispatch({ type: 'cdi.source', source: 'GPS' });
    r.watch();
    expect(r.sim.getState().nav.cdiSource).toBe('GPS');
  });

  it('leaves the CDI alone with ILS CDI set to Manual (AUX Setup 1), and says to select VLOC near the FAF', () => {
    const r = onFinal(1.5, true);
    r.send(large(2), small(2)); // AUX, Setup 1
    expect(r.page).toBe('aux.setup1');
    r.send(CRSR, large(1), key('ENT'), small(1)); // CDI / Alarms, ILS CDI -> Manual
    expect(r.ui.settings.ilsCdi).toBe('manual');
    r.watch();
    expect(r.sim.getState().nav.cdiSource).toBe('GPS');
    expect(r.sim.getState().messages.map((m) => m.text)).toContain(MESSAGES.vloc);
  });

  it('asks for the approach frequency inside 3 nm of the FAF when the localizer is not tuned, once', () => {
    const r = onFinal(2.5, false);
    r.watch();
    r.watch();
    expect(r.sim.getState().messages.filter((m) => m.text === MESSAGES.frequency)).toHaveLength(1);
  });

  it('announces the arrival at a waypoint when the alarm is on', () => {
    const r = nearKjyo();
    r.send(large(2), small(2), CRSR, large(1), key('ENT'), large(1), small(1), large(1), small(200));
    expect(r.ui.settings).toMatchObject({ arrivalAlarm: true, arrivalNm: 9.9 });
    r.sim.dispatch({ type: 'fms.directTo', waypoint: KJYO });
    const at = destination(KJYO, 300, 9);
    r.sim.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt: 3000, headingTrue: 120, iasKt: 100 });
    r.watch();
    expect(r.sim.getState().messages.at(-1)?.text).toBe(MESSAGES.arrival('KJYO'));
  });

  it('pops up the TERRAIN alert when a caution begins; ENT shows the TERRAIN page', () => {
    const r = nearKjyo();
    const d = r.sim.getDerived();
    const caution = { ...d, systems: { ...d.systems, terrain: { ...d.systems.terrain, alert: 'caution' as const, suppressed: false } } };
    const ctx = { state: r.sim.getState(), derived: caution, db, cdiSources: ['GPS', 'NAV1'] as const, procedures: r.procedures, nearest: r.nearest() };
    const first = watch(INITIAL_WATCH, r.ui, ctx);
    expect(first.ui.popup).toEqual({ kind: 'terrainAlert', text: 'TERRAIN ADVISORY' });
    // The same caution next frame doesn't pop up again.
    const again = watch(first.memo, { ...first.ui, popup: null }, ctx);
    expect(again.ui.popup).toBe(null);
    // Inhibited (TER INHB): no pop-up.
    const inhibited = watch(INITIAL_WATCH, { ...r.ui, terrain: { ...r.ui.terrain, inhibited: true } }, ctx);
    expect(inhibited.ui.popup).toBe(null);
  });
});

describe('turn advisories on approaches', () => {
  it('recommends the entry before the missed approach hold, and says ARRIVING WPT at the MAP', () => {
    const r = rig('430', initialSimState());
    const korny = fix('KORNY', 'R17');
    r.sim.dispatch({ type: 'fms.replacePlan', plan: [KJYO] });
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: null, activate: 'activate' });
    const legs = r.sim.getState().fms.approach!.legs;
    // Direct to KORNY (the MAHP), 0.3 nm out, arriving from the southeast.
    const at = destination(korny, 120, 0.3);
    r.sim.dispatch({ type: 'sim.reposition', lat: at.lat, lon: at.lon, altitudeFt: 4000, headingTrue: 300, iasKt: 90 });
    r.sim.dispatch({ type: 'fms.activateApproachLeg', index: legs.findIndex((l) => l.role === 'MAHP') });
    const s = r.sim.getState();
    expect(advisory(r.sim.getDerived().gps, s.fms, 90, s.aircraft.trackTrue, mag)).toMatch(/^HOLD (DIRECT|TEARDROP|PARALLEL)$/);
    // On the MAP leg, a few seconds out.
    const rw17 = fix('RW17', 'R17');
    const close = destination(rw17, bearing(rw17, fix('CEYAC', 'R17')), 0.2);
    r.sim.dispatch({ type: 'sim.reposition', lat: close.lat, lon: close.lon, altitudeFt: 500, headingTrue: 171, iasKt: 90 });
    r.sim.dispatch({ type: 'fms.activateApproachLeg', index: legs.findIndex((l) => l.role === 'MAP') });
    const s2 = r.sim.getState();
    expect(advisory(r.sim.getDerived().gps, s2.fms, 90, s2.aircraft.trackTrue, mag)).toBe('ARRIVING WPT');
  });
});

describe('the active leg line', () => {
  it('shows designators, vectors to final and legs without a fix the way the default NAV page does', () => {
    const r = rig('430', initialSimState());
    r.sim.dispatch({ type: 'fms.replacePlan', plan: [KJYO] });
    r.sim.dispatch({ type: 'fms.loadApproach', airport: KJYO, approach: approach('R17'), transition: 'MRB', activate: 'vtf' });
    expect(legView(r.sim.getState(), r.sim.getDerived().gps)).toEqual({ kind: 'leg', from: { ident: 'VTF' }, to: { ident: 'DANMO', tag: 'FA' }, arc: false });
    const legs = r.sim.getState().fms.approach!.legs;
    r.sim.dispatch({ type: 'fms.activateApproachLeg', index: legs.findIndex((l) => l.role === 'MAP') });
    expect(legView(r.sim.getState(), r.sim.getDerived().gps)).toEqual({ kind: 'leg', from: { ident: 'CEYAC' }, to: { ident: 'RW17', tag: 'MA' }, arc: false });
    r.sim.dispatch({ type: 'fms.activateApproachLeg', index: legs.findIndex((l) => l.path === 'CA') });
    // Activated by hand the climb starts where the airplane is.
    expect(legView(r.sim.getState(), r.sim.getDerived().gps)).toMatchObject({ kind: 'leg', from: { ident: 'P.POS' }, to: { ident: '1100ft' } });
    r.sim.dispatch({ type: 'fms.directTo', waypoint: legs.find((l) => l.role === 'MAHP')!.to! });
    expect(legView(r.sim.getState(), r.sim.getDerived().gps)).toEqual({ kind: 'direct', to: { ident: 'KORNY', tag: 'MH' } });
  });
});

describe('intersections, nearest approaches, terrain page and messages', () => {
  it('spells an intersection on the INT page and lists the nearest ones', () => {
    const r = nearKjyo();
    r.send(large(1), small(6));
    expect(r.page).toBe('wpt.int');
    r.send(CRSR);
    // The page starts on the nearest intersection.
    r.spell('CACAS', r.nearest().fixes[0]!.ident);
    r.send(key('ENT'));
    expect(r.ui.wpt.int?.ident).toBe('CACAS');
    const near = nearestFixes(db, r.sim.getState().aircraft, 5, 200);
    expect(near).toHaveLength(5);
    const d = near.map((f) => Math.hypot(f.lat - r.sim.getState().aircraft.lat, f.lon - r.sim.getState().aircraft.lon));
    expect([...d].sort((a, b) => a - b)[0]).toBe(d[0]);
  });

  it('flies direct to a nearest intersection', () => {
    const r = nearKjyo();
    r.send(large(-1), small(1));
    expect(r.page).toBe('nrst.int');
    r.send(CRSR, key('DTO'), key('ENT'), key('ENT'));
    expect(r.sim.getState().fms.activeLeg?.to.ident).toBe(r.nearest().fixes[0]!.ident);
  });

  it('shows the best approach of each nearest airport', () => {
    const r = nearKjyo();
    expect(bestApproach(r.procedures, 'KJYO')).toBe('ILS');
    expect(bestApproach(r.procedures, 'ZZZZ')).toBe('VFR');
  });

  it('changes the TERRAIN page range, view and aviation data', () => {
    const r = nearKjyo();
    r.send(small(2));
    expect(r.page).toBe('nav.terrain');
    r.send(key('RNG_OUT'));
    expect(TERRAIN_RANGES_NM[r.ui.terrain.range]).toBe(25);
    r.send(key('CLR'));
    expect(r.ui.terrain.aviation).toBe(true);
    r.send(key('MENU'), key('ENT'));
    expect(r.ui.terrain.inhibited).toBe(true);
    r.send(key('MENU'), large(1), key('ENT'));
    expect(r.ui.terrain.view).toBe(120);
  });

  it('shows only the messages a GNS would, in its own words', () => {
    const msg = (id: number, text: string): SimMessage => ({ id, text, level: 'caution', at: 0, read: false });
    const shown = unitMessages([msg(1, 'LOW VOLTS'), msg(2, 'GPS NAVIGATION LOST'), msg(3, 'STALL'), msg(4, MESSAGES.frequency)]);
    expect(shown.map((m) => m.text)).toEqual(['Loss of GPS Navigation - Use other NAV if available', MESSAGES.frequency]);
  });
});
