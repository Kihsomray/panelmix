import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MagneticModel, type MagvarGrid } from '../../../core/magvar';
import { NavDatabase, type RawNavdata } from '../../../core/navdb';
import { initialSimState } from '../../../sim/defaults';
import { Simulator } from '../../../sim/simulator';
import { IDENT_CHARS } from '../../../ui/identEntry';
import { bearing, destination } from '../../../core/geo';
import { advisory } from './advisory';
import { timerSeconds } from './aux';
import { frequencyRows, nearestLists, trafficFrequency } from './data';
import { DTO_STOP } from './dto';
import { currentPage, MAP_RANGES_NM, pageIndicator, PAGES } from './pages';
import { tuningTarget, VLOC_CURSOR_TIMEOUT_S } from './radios';
import { initialUi, reduce } from './reducer';
import type { GnsInput, GnsKey, GnsUi, Model } from './types';

const db = new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata);
const mag = new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid);

const key = (k: GnsKey): GnsInput => ({ kind: 'key', key: k });
const small = (steps = 1): GnsInput => ({ kind: 'right', ring: 'inner', steps });
const large = (steps = 1): GnsInput => ({ kind: 'right', ring: 'outer', steps });
const CRSR: GnsInput = { kind: 'rightPush' };

/** A GNS wired to a real simulator: inputs go through the reducer, commands into the sim. */
function rig(model: Model = '430') {
  const sim = new Simulator(db, mag, initialSimState());
  let ui: GnsUi = initialUi(model);
  let now = 100;
  const ctx = () => ({
    state: sim.getState(),
    db,
    mag,
    nearest: nearestLists(db, sim.getState().aircraft, ui.aux.criteria),
    cdiSources: ['GPS', 'NAV1'] as const,
    now,
  });
  return {
    sim,
    get ui() {
      return ui;
    },
    get page() {
      return currentPage(ui);
    },
    nearest: () => ctx().nearest,
    send(...inputs: GnsInput[]) {
      for (const input of inputs) {
        const r = reduce(ui, input, ctx());
        ui = r.ui;
        for (const c of r.cmds) sim.dispatch(c);
      }
    },
    wait(seconds: number) {
      now += seconds;
    },
    /** Spells an identifier with the right knobs, starting from what the field shows. */
    spell(ident: string, shown = '') {
      for (let i = 0; i < ident.length; i++) {
        const e = ui.entry?.e;
        const current = e ? e.text[e.cursor] ?? ' ' : shown[0] ?? ' ';
        const steps = IDENT_CHARS.indexOf(ident[i]!) - IDENT_CHARS.indexOf(current);
        if (steps !== 0 || !ui.entry) this.send(small(steps === 0 ? IDENT_CHARS.length : steps));
        if (i < ident.length - 1) this.send(large(1));
      }
    },
  };
}

describe('COM and VLOC tuning (left side)', () => {
  it('tunes the COM standby MHz and kHz with the left knobs and flips it active', () => {
    const r = rig();
    r.send({ kind: 'left', ring: 'outer', steps: 2 }, { kind: 'left', ring: 'inner', steps: -3 });
    // 122.975 -> 124.975 -> 124.900
    expect(r.sim.getState().radios.com[0].standbyKhz).toBe(124900);
    r.send(key('COM_FLIP'));
    expect(r.sim.getState().radios.com[0]).toEqual({ activeKhz: 124900, standbyKhz: 126100 });
  });

  it('moves the tuning cursor to VLOC with a push and back to COM after 30 s idle', () => {
    const r = rig();
    r.send({ kind: 'leftPush' }, { kind: 'left', ring: 'inner', steps: 1 });
    expect(r.sim.getState().radios.nav[0].standbyKhz).toBe(113550);
    expect(tuningTarget(r.ui.radio, 100)).toBe('VLOC');
    r.wait(VLOC_CURSOR_TIMEOUT_S + 1);
    expect(tuningTarget(r.ui.radio, 100 + VLOC_CURSOR_TIMEOUT_S + 1)).toBe('COM');
    r.send({ kind: 'left', ring: 'outer', steps: 1 });
    expect(r.sim.getState().radios.com[0].standbyKhz).toBe(123975);
    r.send(key('VLOC_FLIP'));
    expect(r.sim.getState().radios.nav[0].activeKhz).toBe(113550);
  });

  it('puts 121.500 in the active COM when C is held, toggles squelch and ident with the volume knobs', () => {
    const r = rig();
    r.send({ kind: 'hold', key: 'COM_FLIP' });
    expect(r.sim.getState().radios.com[0].activeKhz).toBe(121500);
    r.send({ kind: 'volumePush', knob: 'com' });
    expect(r.ui.radio.squelchOff).toBe(true);
    r.send({ kind: 'volumePush', knob: 'vloc' });
    expect(r.sim.getState().radios.navIdent[0]).toBe(true);
    r.send({ kind: 'volume', knob: 'com', steps: 3 });
    expect(r.ui.radio.comVolume).toBe(65);
  });
});

describe('page groups and keys', () => {
  it('steps groups with the large knob and pages with the small knob, CLR held for default NAV', () => {
    const r = rig();
    expect(r.page).toBe('nav.default');
    r.send(small(1));
    expect(r.page).toBe('nav.map');
    r.send(large(1));
    expect(r.page).toBe('wpt.apt');
    r.send(large(2));
    expect(r.page).toBe('nrst.apt');
    expect(pageIndicator(r.ui)).toEqual({ name: 'NRST', count: 8, index: 0 });
    r.send(small(-1));
    expect(r.page).toBe('nrst.asp');
    r.send({ kind: 'hold', key: 'CLR' });
    expect(r.page).toBe('nav.default');
  });

  it('has the 530W page set: no Position page, VNAV on its own key', () => {
    const r = rig('530');
    expect(pageIndicator(r.ui).count).toBe(5);
    r.send(key('VNAV'));
    expect(r.page).toBe('vnav');
    r.send(key('VNAV'));
    expect(r.page).toBe('nav.default');
  });

  it('cycles the CDI source and toggles OBS mode in the simulator', () => {
    const r = rig();
    r.send(key('CDI'));
    expect(r.sim.getState().nav.cdiSource).toBe('NAV1');
    r.send(key('CDI'));
    expect(r.sim.getState().nav.cdiSource).toBe('GPS');
    r.send(key('OBS'));
    expect(r.sim.getState().fms.obsMode).toBe(true);
    r.send(key('OBS'));
    expect(r.sim.getState().fms.obsMode).toBe(false);
  });

  it('shows messages and marks them read; MSG again goes back', () => {
    const r = rig();
    r.sim.dispatch({ type: 'msg.post', text: 'Test message' });
    r.send(small(1), key('MSG'));
    expect(r.page).toBe('msg');
    expect(r.sim.getDerived().unreadMessages).toBe(0);
    r.send(key('MSG'));
    expect(r.page).toBe('nav.map');
  });

  it('pans the map pointer with the knobs and flies direct to what it points at', () => {
    const r = rig();
    r.send(small(1), CRSR);
    const start = r.ui.map.pointer!;
    expect(start.lat).toBeCloseTo(r.sim.getState().aircraft.lat, 6);
    r.send(small(2), large(-1));
    expect(r.ui.map.pointer!.lat).toBeGreaterThan(start.lat);
    expect(r.ui.map.pointer!.lon).toBeLessThan(start.lon);
    // Open water between airports: D-> makes a "+MAP" waypoint at the pointer.
    r.send(key('DTO'));
    expect(r.ui.dto.wp).toMatchObject({ ident: '+MAP', kind: 'user' });
    r.send(key('ENT'), key('ENT'));
    expect(r.sim.getState().fms.activeLeg?.to.ident).toBe('+MAP');
  });

  it('opens the WPT page of the airport under the map pointer', () => {
    const r = rig();
    r.send(small(1), CRSR);
    // KJYO is about 3 nm east-southeast of the start: click toward it while that gets closer.
    const kjyo = db.airport('KJYO')!;
    const toward = (axis: 'lat' | 'lon', turn: (steps: number) => GnsInput) => {
      for (let i = 0; i < 80; i++) {
        const before = Math.abs(r.ui.map.pointer![axis] - kjyo[axis]);
        const dir = Math.sign(kjyo[axis] - r.ui.map.pointer![axis]);
        r.send(turn(dir));
        if (Math.abs(r.ui.map.pointer![axis] - kjyo[axis]) >= before) {
          r.send(turn(-dir));
          break;
        }
      }
    };
    toward('lon', large);
    toward('lat', small);
    r.send(key('ENT'));
    expect(r.page).toBe('wpt.apt');
    expect(r.ui.wpt.airport?.ident).toBe('KJYO');
    r.send(key('CLR'));
    expect(r.page).toBe('nav.map');
  });

  it('zooms the map with RNG, declutters with CLR and toggles data fields from the menu', () => {
    const r = rig();
    r.send(small(1));
    const start = r.ui.map.range;
    r.send(key('RNG_OUT'));
    expect(MAP_RANGES_NM[r.ui.map.range]).toBeGreaterThan(MAP_RANGES_NM[start]!);
    r.send(key('CLR'), key('CLR'));
    expect(r.ui.map.declutter).toBe(2);
    r.send(key('MENU'));
    expect(r.ui.popup?.kind).toBe('menu');
    r.send(key('ENT'));
    expect(r.ui.map.fields).toBe(false);
  });
});

describe('direct-to', () => {
  it('spells an identifier, confirms it and activates a direct course', () => {
    const r = rig();
    r.send(key('DTO'));
    expect(r.page).toBe('dto');
    // Pre-filled with the active waypoint (MRB).
    expect(r.ui.dto.wp?.ident).toBe('MRB');
    r.spell('KFDK', 'MRB');
    expect(r.ui.entry?.e.text).toBe('KFDK');
    r.send(key('ENT'));
    expect(r.ui.dto.wp?.ident).toBe('KFDK');
    expect(r.ui.cursor).toBe(DTO_STOP.activate);
    r.send(key('ENT'));
    const leg = r.sim.getState().fms.activeLeg!;
    expect(leg.isDirectTo).toBe(true);
    expect(leg.to.ident).toBe('KFDK');
    expect(r.page).toBe('nav.default');
  });

  it('spells ahead from the database as the first letter changes', () => {
    const r = rig();
    r.send(key('DTO'));
    r.send(small(-2)); // M -> K
    expect(r.ui.entry?.e.text).toBe(db.complete('K')!.ident);
  });

  it('picks up the highlighted nearest airport and can cancel the direct-to from the menu', () => {
    const r = rig();
    r.send(large(-1)); // NRST
    r.send(CRSR, large(2)); // second airport identifier
    const second = r.nearest().airports[1]!;
    r.send(key('DTO'));
    expect(r.ui.dto.wp?.ident).toBe(second.ident);
    r.send(key('ENT'), key('ENT'));
    expect(r.sim.getState().fms.activeLeg?.to.ident).toBe(second.ident);
    expect(r.page).toBe('nrst.apt');
    r.send(key('DTO'), key('MENU'));
    expect(r.ui.popup?.kind === 'menu' && r.ui.popup.items[0]?.enabled).toBe(true);
    r.send(key('ENT'));
    expect(r.sim.getState().fms.activeLeg?.isDirectTo ?? false).toBe(false);
  });

  it('chooses from the flight plan and nearest pop-up lists', () => {
    const r = rig();
    r.send(key('DTO'), large(1), small(1));
    expect(r.ui.popup?.kind).toBe('list');
    r.send(small(1), key('ENT'));
    expect(r.ui.dto).toEqual({ wp: r.sim.getState().fms.plan[2], planIndex: 2 });
    r.send(key('ENT'));
    expect(r.sim.getState().fms.activeLeg).toMatchObject({ planIndex: 2, isDirectTo: true });
  });
});

describe('active flight plan', () => {
  it('inserts a waypoint in front of the highlighted one', () => {
    const r = rig();
    r.send(key('FPL'), CRSR);
    expect(r.ui.cursor).toBe(1); // the active waypoint, MRB
    r.spell('KFDK');
    r.send(key('ENT'));
    expect(r.sim.getState().fms.plan.map((w) => w.ident)).toEqual(['KJYO', 'KFDK', 'MRB', 'KHGR']);
    expect(r.ui.cursor).toBe(2);
  });

  it('appends on the empty row and removes a waypoint after "Yes?"', () => {
    const r = rig();
    r.send(key('FPL'), CRSR, large(5));
    expect(r.ui.cursor).toBe(3);
    r.spell('KFDK');
    r.send(key('ENT'));
    expect(r.sim.getState().fms.plan.at(-1)?.ident).toBe('KFDK');
    r.send(large(-1), key('CLR'));
    expect(r.ui.popup).toMatchObject({ kind: 'confirm', action: 'fpl.remove', index: 3 });
    r.send(key('ENT'));
    expect(r.sim.getState().fms.plan.map((w) => w.ident)).toEqual(['KJYO', 'MRB', 'KHGR']);
  });

  it('activates the highlighted leg, inverts and deletes from the page menu', () => {
    const r = rig();
    r.send(key('FPL'), CRSR, large(1), key('MENU'));
    expect(r.ui.popup?.kind).toBe('menu');
    r.send(key('ENT'));
    expect(r.ui.popup).toEqual({ kind: 'activateLeg', index: 2 });
    r.send(key('ENT'));
    expect(r.sim.getState().fms.activeLeg).toMatchObject({ planIndex: 2, isDirectTo: false });

    // With the cursor off "Activate Leg?" is unavailable: the menu opens on "Invert Flight Plan?".
    r.send(key('MENU'));
    expect(r.ui.popup?.kind === 'menu' && r.ui.popup.items[r.ui.popup.index]?.label).toBe('Invert Flight Plan?');
    r.send(key('ENT'));
    expect(r.sim.getState().fms.plan.map((w) => w.ident)).toEqual(['KHGR', 'MRB', 'KJYO']);

    r.send(key('MENU'), large(1), key('ENT'));
    expect(r.ui.popup).toMatchObject({ kind: 'confirm', action: 'fpl.delete', yes: true });
    r.send(large(1), key('ENT'));
    expect(r.sim.getState().fms.plan).toHaveLength(3); // "No?"
    r.send(key('MENU'), large(1), key('ENT'), key('ENT'));
    expect(r.sim.getState().fms.plan).toHaveLength(0);
  });

  it('flies direct to a highlighted flight plan waypoint', () => {
    const r = rig();
    r.send(key('FPL'), CRSR, large(1), key('DTO'));
    expect(r.ui.dto).toEqual({ wp: r.sim.getState().fms.plan[2], planIndex: 2 });
    r.send(key('ENT'), key('ENT'));
    expect(r.sim.getState().fms.activeLeg).toMatchObject({ planIndex: 2, isDirectTo: true });
    expect(r.page).toBe('fpl.active');
  });
});

describe('nearest and waypoint pages', () => {
  it('loads the traffic frequency of a nearest airport into the COM standby', () => {
    const r = rig();
    r.send(large(-1), CRSR, large(1), key('ENT'));
    const f = trafficFrequency(r.nearest().airports[0]!);
    expect(r.sim.getState().radios.com[0].standbyKhz).toBe(f!.khz);
  });

  it('opens the airport pages from the list and returns with "Done?"', () => {
    const r = rig();
    r.send(large(-1), CRSR, large(2), key('ENT'));
    expect(r.page).toBe('wpt.apt');
    expect(r.ui.wpt.airport?.ident).toBe(r.nearest().airports[1]!.ident);
    r.send(CRSR, small(2));
    expect(r.page).toBe('wpt.freq');
    r.send(key('CLR'));
    expect(r.page).toBe('nrst.apt');
    expect(r.ui.cursor).toBe(2);
  });

  it('tunes a nearest VOR into the VLOC standby', () => {
    const r = rig();
    r.send(large(-1), small(3));
    expect(r.page).toBe('nrst.vor');
    r.send(CRSR, large(1), key('ENT'));
    expect(r.sim.getState().radios.nav[0].standbyKhz).toBe(r.nearest().vors[0]!.freqKhz);
  });

  it('spells only VOR identifiers on the VOR page and tunes its frequency', () => {
    const r = rig();
    r.send(large(1), small(-2));
    expect(r.page).toBe('wpt.vor');
    // The active waypoint, the MRB VORTAC, is shown first.
    expect(r.ui.wpt.vor).toBe(null);
    r.send(CRSR, small(-10)); // M -> C
    const first = db.find(r.ui.entry!.e.text);
    expect(first.some((w) => w.kind === 'vor')).toBe(true);
    r.send({ kind: 'key', key: 'CLR' });
    r.spell('CSN', 'MRB');
    r.send(key('ENT'));
    expect(r.ui.wpt.vor?.ident).toBe('CSN');
    r.send(large(1), key('ENT'));
    expect(r.sim.getState().radios.nav[0].standbyKhz).toBe(116300);
  });

  it('loads an airport frequency from the WPT frequency page', () => {
    const r = rig();
    r.send(large(1), small(2), CRSR);
    r.spell('KHGR', 'KHGR');
    r.send(key('ENT'));
    const rows = frequencyRows(db.airport('KHGR')!);
    const ground = rows.findIndex((x) => x.label === 'Ground');
    r.send(large(ground + 1), key('ENT'));
    expect(r.sim.getState().radios.com[0].standbyKhz).toBe(121900);
  });
});

describe('PROC, AUX and VNAV', () => {
  it('answers honestly that procedures are not in the trainer database', () => {
    const r = rig();
    r.send(key('PROC'));
    expect(r.page).toBe('proc');
    expect(r.ui.cursor).toBe(0);
    r.send(key('ENT'));
    expect(r.ui.popup).toMatchObject({ kind: 'notice', lines: ['KHGR', 'Approaches are not in the', 'trainer database.'] });
    r.send(key('CLR'), key('PROC'));
    expect(r.page).toBe('nav.default');
  });

  it('runs the generic timer on the Utility page', () => {
    const r = rig();
    r.send(large(2), small(1));
    expect(r.page).toBe('aux.util');
    r.send(CRSR, large(1), key('ENT'));
    expect(r.ui.aux.sub).toBe('timers');
    r.send(key('ENT'));
    r.sim.step(5);
    const t = r.sim.getState().time;
    expect(timerSeconds(r.ui.aux.timer, t)).toBeCloseTo(5, 3);
    r.send(key('ENT'));
    expect(r.ui.aux.timer.running).toBe(false);
    r.send(key('CLR'));
    expect(r.ui.aux.sub).toBe(null);
  });

  it('filters the nearest airports by runway length', () => {
    const r = rig();
    r.send(large(2), small(-1));
    expect(r.page).toBe('aux.setup2');
    r.send(CRSR, large(1), key('ENT'), large(1), small(50));
    expect(r.ui.aux.criteria.minLengthFt).toBe(5000);
    expect(r.nearest().airports.every((a) => a.runways[0]!.lengthFt >= 5000)).toBe(true);
  });

  it('edits the VNAV target altitude with the small knob', () => {
    const r = rig();
    r.send(small(-1));
    expect(r.page).toBe('nav.vnav');
    r.send(CRSR, small(5));
    expect(r.ui.vnav.altitudeFt).toBe(1500);
  });
});

describe('turn advisories', () => {
  it('announces the turn onto the next leg a few seconds ahead, and the arrival at the last waypoint', () => {
    const s = new Simulator(db, mag, initialSimState());
    const mrb = db.get('MRB')!;
    const kjyo = db.airport('KJYO')!;
    const at = (from: { lat: number; lon: number }, nm: number) => {
      const p = destination(mrb, bearing(mrb, from), nm);
      s.dispatch({ type: 'sim.reposition', lat: p.lat, lon: p.lon, altitudeFt: 3500, headingTrue: bearing(p, mrb), iasKt: 100 });
      return advisory(s.getDerived().gps, 100, mag);
    };
    expect(at(kjyo, 10)).toBe(null);
    // KJYO -> MRB -> KHGR turns right about 50 degrees: the lead starts about 0.8 nm out.
    expect(at(kjyo, 0.95)).toMatch(/^RT TO 02\d° \d+ S$/);
    s.dispatch({ type: 'fms.directTo', waypoint: NavDatabase.toWaypoint(db.airport('KHGR')!), planIndex: 2 });
    const khgr = db.airport('KHGR')!;
    const p = destination(khgr, bearing(khgr, mrb), 0.2);
    s.dispatch({ type: 'sim.reposition', lat: p.lat, lon: p.lon, altitudeFt: 3500, headingTrue: bearing(p, khgr), iasKt: 100 });
    expect(advisory(s.getDerived().gps, 100, mag)).toBe('ARRIVING WPT');
  });
});

describe('every page', () => {
  const keys: GnsKey[] = ['MENU', 'CLR', 'RNG_IN', 'RNG_OUT'];
  it.each(['430', '530'] as const)('handles every control on every %sW page without failing', (model) => {
    const r = rig(model);
    const visited = new Set<string>();
    const workPage = () => {
      visited.add(r.page);
      const at = r.page;
      // Cursor on, move and edit, then back off; windows closed with CLR.
      r.send(CRSR, large(1), small(1), large(-1), small(-1), key('ENT'));
      r.send(key('CLR'), key('CLR'), key('CLR'));
      for (const k of keys) r.send(key(k), key('CLR'));
      r.send({ kind: 'hold', key: 'CLR' });
      return at;
    };
    for (const [group, count] of Object.entries(PAGES[model])) {
      for (let i = 0; i < count.length; i++) {
        r.send({ kind: 'hold', key: 'CLR' });
        r.send(large(['NAV', 'WPT', 'AUX', 'NRST'].indexOf(group)));
        // Each group remembers the page it was left on.
        r.send(small(i - r.ui.pages[group as keyof GnsUi['pages']]));
        expect(currentPage(r.ui)).toBe(PAGES[model][group as keyof (typeof PAGES)[typeof model]][i]);
        workPage();
      }
    }
    for (const fn of ['FPL', 'PROC', 'DTO', 'MSG', ...(model === '530' ? ['VNAV'] : [])] as GnsKey[]) {
      r.send({ kind: 'hold', key: 'CLR' }, key(fn));
      workPage();
    }
    expect(visited.size).toBe(Object.values(PAGES[model]).flat().length + (model === '530' ? 5 : 4));
  });
});
