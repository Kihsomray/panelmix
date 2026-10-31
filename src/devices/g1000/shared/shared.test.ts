import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MagneticModel, type MagvarGrid } from '../../../core/magvar';
import { NavDatabase, type RawNavdata, type Waypoint } from '../../../core/navdb';
import { applyCommand, type SimCommand } from '../../../sim/commands';
import { initialSimState } from '../../../sim/defaults';
import { Simulator } from '../../../sim/simulator';
import type { AutopilotState, SimState } from '../../../sim/types';
import { afcsAnnunciation, afcsPress, type AfcsContext } from './afcs';
import { baroStep, centeredCourse } from './commonControls';
import { directToClr, directToEnt, directToIdent, directToInner, directToOuter, listSelection, openDirectTo, planIndexFor } from './directTo';
import { FPL_CURSOR_OFF, fplClamp, fplClr, fplCursorOn, fplEnt, fplInner, fplOuter, scrollToShow } from './flightPlan';
import { confirmCommands, fplMenuConfirm, fplMenuItems, planComment, removeConfirm } from './fplActions';
import { confirmMove, menuMove, menuSelection, openMenu } from './menu';
import { nearestAirports, primaryCom } from './nearest';
import { adjustVolume, INITIAL_RADIO_PANEL, shownVolume, toggleSquelch, toggleTuning, tuneStandby, VOLUME_SHOW_MS } from './radioPanel';
import { codeBackspace, codeDigit, codeDisplay, codeDue, codeFinish, codeKnobInner, codeKnobOuter, startCode, CODE_COMMIT_MS, CODE_IDLE_MS } from './xpdrCode';

const db = new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata);
const mag = new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid);
const complete = (prefix: string) => db.complete(prefix)?.ident;
const resolves = (ident: string) => db.find(ident).length > 0;
const wp = (ident: string): Waypoint => NavDatabase.toWaypoint(db.get(ident)!);

/** Applies a key's commands to the shared reducer, as a display would. */
function run(state: SimState, cmds: readonly SimCommand[]): SimState {
  return cmds.reduce((s, c) => applyCommand(s, c, { mag }), state);
}

describe('GFC 700 mode keys', () => {
  const s0 = initialSimState();
  /** On course (needle centred) unless a context says otherwise. */
  const onCourse: AfcsContext = { navValid: true, needle: 0, source: 'GPS', approach: false };
  const press = (state: SimState, key: Parameters<typeof afcsPress>[0], ctx: AfcsContext = onCourse) =>
    run(state, afcsPress(key, state.ap, ctx).commands);

  it('AP engages in ROL and PIT with Selected Altitude Capture armed, and a second press disengages', () => {
    const on = press(s0, 'AP');
    expect(on.ap).toMatchObject({ engaged: true, lateral: 'ROL', vertical: 'PIT', altitudeArmed: true });
    expect(press(on, 'AP').ap.engaged).toBe(false);
  });

  it('FD toggles the director, clears its armed modes when turned off, and is disabled while the autopilot flies', () => {
    const fd = press(s0, 'FD');
    expect(fd.ap.flightDirector).toBe(true);
    const armed = press(press(fd, 'HDG'), 'NAV', { ...onCourse, needle: 0.9 });
    expect(armed.ap.lateralArmed).toBe('NAV');
    const off = press(armed, 'FD');
    expect(off.ap).toMatchObject({ flightDirector: false, lateralArmed: null, altitudeArmed: false });
    const ap = press(s0, 'AP');
    expect(afcsPress('FD', ap.ap, onCourse).commands).toEqual([]);
  });

  it('mode keys are alternate action: pressing the active mode reverts to the default', () => {
    const hdg = press(press(s0, 'AP'), 'HDG');
    expect(hdg.ap.lateral).toBe('HDG');
    expect(press(hdg, 'HDG').ap.lateral).toBe('ROL');
    const vs = press(hdg, 'VS');
    expect(vs.ap.vertical).toBe('VS');
    const pit = press(vs, 'VS');
    expect(pit.ap.vertical).toBe('PIT');
    expect(pit.ap.altitudeArmed).toBe(true);
  });

  it('a mode key with the director off turns it on in that mode', () => {
    const hdg = press(s0, 'HDG');
    expect(hdg.ap).toMatchObject({ flightDirector: true, engaged: false, lateral: 'HDG', vertical: 'PIT' });
  });

  it('NAV within one dot captures at once', () => {
    const nav = press(press(s0, 'AP'), 'NAV', { ...onCourse, needle: 0.3 });
    expect(nav.ap).toMatchObject({ lateral: 'NAV', lateralArmed: null });
    expect(press(nav, 'NAV').ap.lateral).toBe('ROL');
  });

  it('NAV further out arms while HDG keeps flying; NAV again cancels the arm', () => {
    const far = { ...onCourse, needle: -0.8 };
    const armed = press(press(press(s0, 'AP'), 'HDG'), 'NAV', far);
    expect(armed.ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    expect(press(armed, 'NAV', far).ap).toMatchObject({ lateral: 'HDG', lateralArmed: null });
    // HDG pressed again reverts to ROL and leaves NAV armed.
    expect(press(armed, 'HDG', far).ap).toMatchObject({ lateral: 'ROL', lateralArmed: 'NAV' });
  });

  it('NAV with the director off turns it on in ROL with NAV armed', () => {
    const armed = press(s0, 'NAV', { ...onCourse, needle: 1 });
    expect(armed.ap).toMatchObject({ flightDirector: true, lateral: 'ROL', lateralArmed: 'NAV', vertical: 'PIT', altitudeArmed: true });
  });

  it('NAV needs a valid course', () => {
    expect(afcsPress('NAV', s0.ap, { ...onCourse, navValid: false }).commands).toEqual([]);
  });

  it('APR with a VOR is the VOR approach mode; with GPS or a localizer the trainer has no approach to fly', () => {
    const vor: AfcsContext = { ...onCourse, source: 'VOR', needle: 0.7 };
    const r = afcsPress('APR', s0.ap, vor);
    expect(r.approach).toBe(true);
    const armed = run(s0, r.commands);
    expect(armed.ap.lateralArmed).toBe('NAV');
    // NAV switches the same course to plain VOR navigation; APR again cancels.
    expect(afcsPress('NAV', armed.ap, { ...vor, approach: true })).toEqual({ commands: [], approach: false });
    expect(run(armed, afcsPress('APR', armed.ap, { ...vor, approach: true }).commands).ap.lateralArmed).toBeNull();
    expect(afcsPress('APR', s0.ap, onCourse).unavailable?.message).toMatch(/GPS approach/);
    expect(afcsPress('APR', s0.ap, { ...onCourse, source: 'LOC' }).unavailable?.message).toMatch(/localizers/);
  });

  it('FLC selects the airspeed mode; NOSE UP/DN change the PIT, VS or FLC reference only', () => {
    expect(press(press(s0, 'AP'), 'FLC').ap.vertical).toBe('IAS');
    const vs = press(press(s0, 'AP'), 'VS');
    const up = press(vs, 'NOSE_UP');
    expect(up.bugs.verticalSpeedFpm).toBe(vs.bugs.verticalSpeedFpm + 100);
    const alt = press(press(s0, 'AP'), 'ALT');
    expect(afcsPress('NOSE_UP', alt.ap, onCourse).commands).toEqual([]);
  });

  it('VNV and BC have no data in the trainer and say so', () => {
    for (const key of ['VNV', 'BC'] as const) {
      const r = afcsPress(key, s0.ap, onCourse);
      expect(r.commands).toEqual([]);
      expect(r.unavailable?.message).toMatch(/trainer|localizers/);
    }
  });

  it('annunciates active modes, references, ALTS and the armed lateral mode by CDI source', () => {
    const ap: AutopilotState = { ...s0.ap, engaged: true, lateral: 'NAV', vertical: 'VS', altitudeArmed: true };
    expect(afcsAnnunciation(ap, { verticalSpeedFpm: 500, airspeedKt: 90 }, 'VOR1', false)).toEqual({
      lateralArmed: '',
      lateralActive: 'VOR',
      verticalActive: 'VS',
      verticalRef: '↑500FPM',
      verticalArmed: 'ALTS',
    });
    const armed = { ...ap, lateral: 'HDG' as const, lateralArmed: 'NAV' as const };
    expect(afcsAnnunciation(armed, { verticalSpeedFpm: 0, airspeedKt: 90 }, 'GPS', false)).toMatchObject({ lateralArmed: 'GPS', lateralActive: 'HDG' });
    expect(afcsAnnunciation(armed, { verticalSpeedFpm: 0, airspeedKt: 90 }, 'VOR2', true)).toMatchObject({ lateralArmed: 'VAPP' });
    const flc = afcsAnnunciation({ ...ap, vertical: 'IAS' }, { verticalSpeedFpm: 0, airspeedKt: 85 }, 'GPS', false);
    expect(flc).toMatchObject({ lateralActive: 'GPS', verticalActive: 'FLC', verticalRef: '85KT' });
    expect(afcsAnnunciation({ ...ap, engaged: false, flightDirector: false }, { verticalSpeedFpm: 0, airspeedKt: 0 }, 'GPS', false)).toBeNull();
  });

  it('an armed NAV captures in the simulator as the needle comes in, and HDG keeps flying until then', () => {
    const s = new Simulator(db, mag, initialSimState());
    const dispatchAll = (cmds: readonly SimCommand[]) => cmds.forEach((c) => s.dispatch(c));
    // Turn 60 degrees off the leg so the needle walks out past one dot.
    s.dispatch({ type: 'bug.heading', mag: s.getDerived().gps.dtkMag! + 60 });
    dispatchAll(afcsPress('AP', s.getState().ap, onCourse).commands);
    dispatchAll(afcsPress('HDG', s.getState().ap, onCourse).commands);
    s.step(150);
    const cdi = s.getDerived().cdi;
    expect(Math.abs(cdi.needle)).toBeGreaterThan(0.5);
    dispatchAll(afcsPress('NAV', s.getState().ap, { ...onCourse, needle: cdi.needle }).commands);
    expect(s.getState().ap).toMatchObject({ lateral: 'HDG', lateralArmed: 'NAV' });
    // Back toward the course at a 30 degree intercept.
    s.dispatch({ type: 'bug.heading', mag: s.getDerived().gps.dtkMag! - 30 * Math.sign(-cdi.needle) });
    s.step(400);
    expect(s.getState().ap).toMatchObject({ lateral: 'NAV', lateralArmed: null });
  });
});

describe('radio tuning boxes', () => {
  it('push moves the tuning box between radio 1 and 2', () => {
    const p = toggleTuning(INITIAL_RADIO_PANEL, 'nav');
    expect(p.navTuned).toBe(1);
    expect(p.comTuned).toBe(0);
    expect(toggleTuning(p, 'nav').navTuned).toBe(0);
  });

  it('the large knob steps MHz and the small knob channels, each wrapping on its own', () => {
    expect(tuneStandby('com', 0, 118000, 'outer', -1)).toEqual({ type: 'com.setStandby', radio: 0, khz: 136000 });
    expect(tuneStandby('com', 1, 118975, 'inner', 1)).toEqual({ type: 'com.setStandby', radio: 1, khz: 118000 });
    expect(tuneStandby('nav', 0, 117950, 'inner', 1)).toEqual({ type: 'nav.setStandby', radio: 0, khz: 117000 });
  });

  it('volume shows in place of the standby frequency for two seconds', () => {
    const p = adjustVolume(INITIAL_RADIO_PANEL, 'com', 3, 1000);
    expect(p.comVolume[0]).toBe(85);
    expect(shownVolume(p, 'com', 0, 1000 + VOLUME_SHOW_MS - 1)).toBe(85);
    expect(shownVolume(p, 'com', 0, 1000 + VOLUME_SHOW_MS)).toBeNull();
    expect(shownVolume(p, 'nav', 0, 1000)).toBeNull();
    expect(adjustVolume(p, 'com', 10, 0).comVolume[0]).toBe(100);
  });

  it('squelch override applies to the COM with the tuning box', () => {
    const p = toggleSquelch(toggleTuning(INITIAL_RADIO_PANEL, 'com'));
    expect(p.squelchOff).toEqual([false, true]);
  });
});

describe('CRS/BARO knob', () => {
  it('steps the altimeter 0.01 inHg, or 1 hPa when the PFD shows hPa', () => {
    expect(baroStep(29.92, 1, false)).toBeCloseTo(29.93, 5);
    expect(Math.round(baroStep(29.92, 1, true) * 33.8639)).toBe(1014);
  });

  it('push centers the needle on the bearing to the VOR', () => {
    const s = new Simulator(db, mag, initialSimState());
    s.dispatch({ type: 'nav.setActive', radio: 0, khz: 112100 });
    s.dispatch({ type: 'cdi.source', source: 'NAV1' });
    const cmd = centeredCourse(s.getState(), s.getDerived());
    expect(cmd?.type).toBe('obs.set');
    if (cmd) s.dispatch(cmd);
    expect(Math.abs(s.getDerived().vor[0].needle)).toBeLessThan(0.1);
    expect(s.getDerived().vor[0].toFrom).toBe('TO');
  });

  it('push in GPS leg mode does nothing (the course is the desired track)', () => {
    const s = new Simulator(db, mag, initialSimState());
    expect(centeredCourse(s.getState(), s.getDerived())).toBeNull();
  });
});

describe('Direct-to window', () => {
  it('pre-fills, spells ahead on the small knob and needs ENT twice to activate', () => {
    expect(directToIdent(openDirectTo('MRB'))).toBe('MRB');
    // Clockwise turns step the first character (blank, A, B... K); spell-ahead fills the rest.
    let d = openDirectTo('');
    for (let i = 0; i < 11; i++) d = directToInner(d, 1, complete);
    expect(d.editing).toBe(true);
    expect(directToIdent(d).startsWith('K')).toBe(true);
    expect(resolves(directToIdent(d))).toBe(true);
    const ent1 = directToEnt(d, resolves);
    expect(ent1.activate).toBeUndefined();
    expect(ent1.state?.field).toBe('activate');
    const ent2 = directToEnt(ent1.state!, resolves);
    expect(ent2.activate).toBe(directToIdent(d));
    expect(ent2.state).toBeNull();
  });

  it('CLR abandons an edit first, then closes the window', () => {
    const d = directToInner(openDirectTo('MRB'), 3, complete);
    const back = directToClr(d).state!;
    expect(directToIdent(back)).toBe('MRB');
    expect(back.editing).toBe(false);
    expect(directToClr(back).state).toBeNull();
  });

  it('turning the small knob counter-clockwise opens the flight plan and nearest lists', () => {
    const lists = { FPL: ['KJYO', 'MRB', 'KHGR'], NRST: ['KJYO', 'KIAD'] };
    let d = directToInner(openDirectTo('MRB'), -1, complete, lists);
    expect(d.list).toEqual({ kind: 'FPL', index: 0 });
    d = directToOuter(d, 2, resolves, lists);
    expect(listSelection(d, lists)).toBe('KHGR');
    expect(directToInner(d, 1, complete, lists).list).toEqual({ kind: 'NRST', index: 0 });
    const picked = directToEnt(d, resolves, lists).state!;
    expect(directToIdent(picked)).toBe('KHGR');
    expect(picked.field).toBe('activate');
    expect(directToClr(d).state?.list).toBeNull();
    // Without a flight plan the submenu opens on the nearest list.
    expect(directToInner(openDirectTo(''), -1, complete, { FPL: [], NRST: ['KJYO'] }).list?.kind).toBe('NRST');
  });

  it('the large knob reaches ACTIVATE? only for a known identifier', () => {
    expect(directToOuter(openDirectTo('MRB'), 1, resolves).field).toBe('activate');
    expect(directToOuter(openDirectTo('ZZZZZ'), 1, resolves).field).toBe('ident');
  });

  it('a direct-to a plan waypoint resumes the plan there', () => {
    const plan = [wp('KJYO'), wp('MRB'), wp('KHGR')];
    expect(planIndexFor(plan, 'KHGR', null, 1)).toBe(2);
    expect(planIndexFor(plan, 'MRB', 1, 1)).toBe(1);
    expect(planIndexFor(plan, 'KIAD', null, 1)).toBeNull();
  });
});

describe('flight plan cursor', () => {
  it('turns on at the active waypoint and moves within the plan plus the empty row', () => {
    const c = fplCursorOn(3, 1);
    expect(c.index).toBe(1);
    expect(fplOuter(c, 5, 3).index).toBe(3);
    expect(fplOuter(c, -5, 3).index).toBe(0);
    expect(fplCursorOn(0, null).index).toBe(0);
  });

  it('inserts the entered identifier above the cursor row', () => {
    let c = fplCursorOn(3, 1);
    for (let i = 0; i < 11; i++) c = fplInner(c, 1, complete);
    const r = fplEnt(c, resolves);
    expect(r.insert?.index).toBe(1);
    expect(r.insert?.ident.startsWith('K')).toBe(true);
    expect(r.cursor).toEqual({ index: 2, entry: null });
  });

  it('CLR cancels an entry, else asks to remove the waypoint under the cursor', () => {
    const entering = fplInner(fplCursorOn(3, 1), 1, complete);
    expect(fplClr(entering, 3)).toEqual({ cursor: { index: 1, entry: null } });
    expect(fplClr(fplCursorOn(3, 2), 3).remove).toBe(2);
    expect(fplClr({ index: 3, entry: null }, 3).remove).toBeUndefined();
  });

  it('keeps the cursor on the list when the plan shrinks, and scrolls to show it', () => {
    expect(fplClamp({ index: 5, entry: null }, 2).index).toBe(2);
    expect(fplClamp(FPL_CURSOR_OFF, 2)).toBe(FPL_CURSOR_OFF);
    expect(scrollToShow(0, 7, 5, 10)).toBe(3);
    expect(scrollToShow(4, 2, 5, 10)).toBe(2);
    expect(scrollToShow(9, null, 5, 6)).toBe(1);
  });
});

describe('flight plan menu and confirmations', () => {
  const plan = [wp('KJYO'), wp('MRB'), wp('KHGR')];

  it('offers Activate Leg only with the cursor on a waypoint', () => {
    const items = fplMenuItems(3, 3);
    expect(items.find((i) => i.id === 'activateLeg')?.enabled).toBe(false);
    expect(fplMenuItems(3, 1).find((i) => i.id === 'activateLeg')?.enabled).toBe(true);
    expect(fplMenuItems(0, null).find((i) => i.id === 'delete')?.enabled).toBe(false);
  });

  it('uses the Garmin prompts and turns OK into simulator commands', () => {
    const act = fplMenuConfirm('activateLeg', plan, 2)!;
    expect(act.leg).toBe('MRB ➔ KHGR');
    expect(confirmCommands(act)).toEqual([{ type: 'fms.activateLeg', index: 2 }]);
    expect(fplMenuConfirm('invert', plan, null)?.message).toBe('Invert Active Flight Plan?');
    expect(fplMenuConfirm('delete', plan, null)?.message).toBe('Delete all waypoints in flight plan?');
    const remove = removeConfirm(plan, 1)!;
    expect(remove.message).toBe('Remove MRB?');
    expect(confirmCommands(remove)).toEqual([{ type: 'fms.remove', index: 1 }]);
    expect(confirmCommands(confirmMove(remove, 1))).toEqual([]);
    expect(planComment(plan)).toBe('KJYO / KHGR');
  });
});

describe('page menu', () => {
  it('skips unavailable items', () => {
    const m = openMenu([
      { id: 'a', label: 'A', enabled: false },
      { id: 'b', label: 'B', enabled: true },
      { id: 'c', label: 'C', enabled: false },
      { id: 'd', label: 'D', enabled: true },
    ]);
    expect(menuSelection(m)).toBe('b');
    expect(menuSelection(menuMove(m, 1))).toBe('d');
    expect(menuSelection(menuMove(menuMove(m, 1), 5))).toBe('d');
    expect(menuSelection(menuMove(m, -1))).toBe('b');
    expect(openMenu([]).cursor).toBe(-1);
  });
});

describe('transponder code entry', () => {
  it('enters four digits with the softkeys, steps back with BKSP and commits five seconds later', () => {
    let e = startCode(0);
    for (const d of [4, 5, 2, 1]) e = codeDigit(e, d, 1000);
    expect(e.digits).toBe('4521');
    expect(codeDigit(e, 3, 1100).digits).toBe('4521');
    expect(codeDue(e, 1000 + CODE_COMMIT_MS - 1)).toBeNull();
    expect(codeDue(e, 1000 + CODE_COMMIT_MS)).toBe('commit');
    expect(codeBackspace(e, 1200).digits).toBe('452');
    expect(codeDigit(startCode(0), 8, 0).digits).toBe('');
  });

  it('abandons a partial entry after ten idle seconds', () => {
    const e = codeDigit(startCode(0), 7, 0);
    expect(codeDisplay(e)).toBe('7___');
    expect(codeDue(e, CODE_IDLE_MS - 1)).toBeNull();
    expect(codeDue(e, CODE_IDLE_MS)).toBe('expire');
  });

  it('the FMS knob sets the code two octal digits at a time', () => {
    let e = startCode(0);
    e = codeKnobInner(e, 12, 0);
    expect(e.digits).toBe('14');
    e = codeKnobOuter(e, 1, 0);
    e = codeKnobInner(e, -1, 0);
    expect(e.digits).toBe('1477');
    expect(codeFinish(codeDigit(startCode(0), 7, 0))).toBe('7000');
  });
});

describe('nearest lists', () => {
  it('lists the nearest airports in distance order with a frequency to tune', () => {
    const pos = { lat: 39.075, lon: -77.62 };
    const list = nearestAirports(db, pos);
    expect(list.length).toBeGreaterThan(5);
    expect(list[0]!.item.ident).toBe('KJYO');
    for (let i = 1; i < list.length; i++) expect(list[i]!.distanceNm).toBeGreaterThanOrEqual(list[i - 1]!.distanceNm);
    const iad = list.find((n) => n.item.ident === 'KIAD')!.item;
    expect(primaryCom(iad)?.type).toBe('TWR');
    // A second call near the same spot reuses the search.
    expect(nearestAirports(db, { lat: 39.0751, lon: -77.6201 })[0]!.item).toBe(list[0]!.item);
  });
});
