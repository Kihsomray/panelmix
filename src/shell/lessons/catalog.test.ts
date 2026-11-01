import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, distanceNm } from '../../core/geo';
import type { SimCommand } from '../../sim/commands';
import { G1000_PANEL, G5_PANEL, GTN_PANEL, KJYO_SOURCE, live, navData, STEAM_PANEL, stateWith } from '../testFixtures';
import { LESSONS } from './catalog';
import { COM1_SWAP, HEADING_BUG } from './catalog/hints';
import { familiesOf, hintsFor, stepsFor } from './families';
import { snapshot, textOf } from './runner';
import { attitudeFailure, resolveSetup, setupAirports } from './setup';
import type { CheckContext, LessonEnv, StepHints } from './types';

const PANELS = [G5_PANEL, STEAM_PANEL, G1000_PANEL, GTN_PANEL];
const env = (panel = G5_PANEL): LessonEnv => ({ ...navData(), procedures: KJYO_SOURCE, panel });
const ctxFor = (panel = G5_PANEL): CheckContext => {
  const input = live(stateWith(), {}, panel);
  return { ...input, stepStart: snapshot(input) };
};

describe('device families', () => {
  it('maps each panel to the families hints are written for', () => {
    expect(familiesOf(G5_PANEL)).toEqual({ pfd: 'g5', nav: 'gns', xpdr: 'gtx345', ap: 'gfc500' });
    expect(familiesOf(STEAM_PANEL)).toEqual({ pfd: 'steam', nav: 'gns', xpdr: 'kt76a', ap: 'kap140' });
    expect(familiesOf(G1000_PANEL)).toEqual({ pfd: 'g1000', nav: 'g1000', xpdr: 'g1000', ap: 'gfc700' });
    expect(familiesOf(GTN_PANEL)).toEqual({ pfd: 'aspen', nav: 'gtn', xpdr: 'gtn', ap: 'sim' });
  });

  it('shows the hint for each installed unit, labelled with its name', () => {
    expect(hintsFor(COM1_SWAP, G5_PANEL)).toEqual([{ unit: 'GNS 430W', text: COM1_SWAP.nav!.gns! }]);
    expect(hintsFor(COM1_SWAP, GTN_PANEL)).toEqual([{ unit: 'GTN 750Xi', text: COM1_SWAP.nav!.gtn! }]);
    expect(hintsFor(HEADING_BUG, G5_PANEL).map((h) => h.unit)).toEqual(['G5 (attitude + HSI)', 'GFC 500 (GMC 507)']);
    expect(hintsFor(HEADING_BUG, GTN_PANEL).map((h) => h.unit)).toEqual(['Evolution E1000 PFD', 'Sim autopilot (Fly)']);
    expect(hintsFor(HEADING_BUG, STEAM_PANEL).map((h) => h.unit)).toEqual(['Six-pack + CDI']);
    expect(hintsFor(undefined, G5_PANEL)).toEqual([]);
  });

  it('shows a G1000 hint once when it is written for both of its roles', () => {
    const both: StepHints = { pfd: { g1000: 'Same text.' }, nav: { g1000: 'Same text.' }, any: 'Fly the airplane.' };
    expect(hintsFor(both, G1000_PANEL)).toEqual([
      { unit: 'G1000 MFD', text: 'Same text.' },
      { unit: 'Technique', text: 'Fly the airplane.' },
    ]);
  });
});

describe('the syllabus', () => {
  it('has the required lessons', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['radios', 'direct-fpl', 'autopilot', 'vor', 'rnav17', 'ils17', 'hold-missed', 'hold-pilot', 'partial-panel']);
  });

  it('every lesson has unique step ids, steps on every panel, tips and a setup', () => {
    for (const l of LESSONS) {
      const ids = l.steps.map((s) => s.id);
      expect(new Set(ids).size, l.id).toBe(ids.length);
      for (const p of PANELS) expect(stepsFor(l.steps, p).length, `${l.id} on ${p.pfd}`).toBeGreaterThan(3);
      expect(l.tips.length, l.id).toBeGreaterThan(0);
      expect(l.setup.length, l.id).toBeGreaterThan(0);
      for (const m of l.monitors ?? []) for (const d of m.during ?? []) expect(ids, `${l.id} monitor ${m.id}`).toContain(d);
    }
  });

  it('every step has a hint for each family of the unit that does it', () => {
    // A step done on the navigator covers every navigator, and so on. Autopilot hints that only
    // add to the flight instruments' (the KAP 140's own BARO, say) may name just the units concerned.
    const families = { nav: ['gns', 'gtn', 'g1000'], xpdr: ['gtx345', 'kt76a', 'gtn', 'g1000'], ap: ['kap140', 'gfc500', 'gfc700', 'sim'] };
    for (const l of LESSONS) {
      for (const s of l.steps) {
        for (const role of ['nav', 'xpdr', 'ap'] as const) {
          const table = s.hints?.[role];
          if (!table || (role === 'ap' && s.hints?.pfd)) continue;
          expect(Object.keys(table).sort(), `${l.id}/${s.id} ${role}`).toEqual([...families[role]].sort());
        }
      }
    }
  });

  it('uses no em or en dashes in anything the pilot reads', () => {
    const ctx = ctxFor();
    const texts: string[] = [];
    for (const l of LESSONS) {
      texts.push(l.title, l.summary, ...l.tips, ...l.setup.map((a) => a.label));
      for (const s of l.steps) {
        texts.push(textOf(s.title, ctx), textOf(s.detail, ctx));
        for (const p of PANELS) texts.push(...hintsFor(s.hints, p).map((h) => h.text));
      }
      for (const m of l.monitors ?? []) texts.push(m.label, m.format(1.23));
    }
    const bad = texts.filter((t) => /[\u2013\u2014]/.test(t));
    expect(bad).toEqual([]);
    expect(texts.every((t) => !t.includes('undefined'))).toBe(true);
  });

  it('every set-up resolves with the real database and the KJYO procedures', () => {
    for (const l of LESSONS) {
      for (const p of PANELS) {
        const r = resolveSetup(l.setup, env(p), stateWith(), () => 0.5);
        expect(r.problems, `${l.id} on ${p.pfd}`).toEqual([]);
        expect(r.commands.length + r.failures.length, l.id).toBeGreaterThan(0);
      }
    }
    expect(setupAirports(LESSONS.flatMap((l) => l.setup))).toEqual(['KJYO']);
  });

  it('every "do it for me" either makes commands or declines, without throwing', () => {
    for (const l of LESSONS) {
      for (const s of l.steps) {
        const cmds = s.assist?.(ctxFor(), env());
        if (cmds) for (const cmd of cmds) expect(typeof cmd.type, `${l.id}/${s.id}`).toBe('string');
      }
    }
  });

  it('the KJYO lessons say so when the procedures are missing', () => {
    const none: LessonEnv = { ...env(), procedures: null };
    const rnav = LESSONS.find((l) => l.id === 'rnav17')!;
    expect(rnav.unavailable?.(none)).toMatch(/KJYO instrument procedures/);
    expect(rnav.unavailable?.(env())).toBeNull();
  });
});

describe('lesson set-up', () => {
  const findCmd = <T extends SimCommand['type']>(cmds: readonly SimCommand[], type: T) =>
    cmds.find((c): c is Extract<SimCommand, { type: T }> => c.type === type);

  it('places the airplane on a radial of the station, heading for it, with the altimeter set', () => {
    const { db } = navData();
    const mrb = db.get('MRB')!;
    const r = resolveSetup(
      [{ kind: 'position', label: '', from: 'MRB', radialMag: 120, distanceNm: 8, altitudeFt: 4000, headingMag: 'toward' }],
      env(),
      stateWith(),
    );
    const pos = findCmd(r.commands, 'sim.reposition')!;
    expect(distanceNm(pos, mrb)).toBeCloseTo(8, 2);
    // Radials use the station's declination (MRB: 10.2 W).
    expect(angleDiff(bearing(mrb, pos), 120 - 10.2)).toBeCloseTo(0, 1);
    expect(Math.abs(angleDiff(pos.headingTrue, bearing(pos, mrb)))).toBeLessThan(0.01);
    expect(pos.altitudeFt).toBe(4000);
    expect(findCmd(r.commands, 'baro.set')?.inHg).toBe(stateWith().env.qnhInHg);
  });

  it('fails the vacuum pump on steam gauges and the AHRS on glass, at a random moment in the window', () => {
    expect(attitudeFailure(STEAM_PANEL)).toBe('vacuum');
    expect(attitudeFailure(G5_PANEL)).toBe('ahrs');
    const action = { kind: 'failure' as const, label: '', failure: 'attitude' as const, delaySec: [20, 90] as const };
    const steam = resolveSetup([action], env(STEAM_PANEL), stateWith(), () => 0.5);
    expect(steam.failures).toEqual([{ action: { kind: 'fail', failure: 'vacuum', failed: true }, delaySec: 55, withinSec: 90 }]);
    const now = resolveSetup([{ ...action, delaySec: [0, 0] }], env(G5_PANEL), stateWith());
    expect(now.commands).toEqual([{ type: 'failure.set', failure: 'ahrs', failed: true }]);
  });

  it('builds plans and direct-to legs on the new plan', () => {
    const r = resolveSetup(
      [
        { kind: 'plan', label: '', idents: ['KJYO', 'MRB', 'KHGR'] },
        { kind: 'directTo', label: '', ident: 'KHGR' },
      ],
      env(),
      stateWith(),
    );
    expect(findCmd(r.commands, 'fms.replacePlan')?.plan.map((w) => w.ident)).toEqual(['KJYO', 'MRB', 'KHGR']);
    expect(findCmd(r.commands, 'fms.directTo')).toMatchObject({ planIndex: 2, waypoint: { ident: 'KHGR' } });
    expect(resolveSetup([{ kind: 'directTo', label: '', ident: 'NOSUCH' }], env(), stateWith()).problems).toEqual(['NOSUCH is not in the database.']);
  });

  it('starts approach scenarios from the procedure database', () => {
    const r = resolveSetup(
      [{ kind: 'scenario', label: '', airport: 'KJYO', approach: 'RNAV 17', transition: 'MRB', start: { kind: 'transition', distanceNm: 6 }, load: 'none', autopilot: true }],
      env(),
      stateWith(),
    );
    expect(r.problems).toEqual([]);
    expect(findCmd(r.commands, 'sim.reposition')?.altitudeFt).toBe(3000);
    expect(findCmd(r.commands, 'fms.directTo')?.waypoint.ident).toBe('MRB');
    const missing = resolveSetup(
      [{ kind: 'scenario', label: '', airport: 'KJYO', approach: 'VOR-A', transition: null, start: { kind: 'final' }, load: 'activate', autopilot: false }],
      env(),
      stateWith(),
    );
    expect(missing.problems).toEqual(['The VOR-A approach at KJYO is not in the procedure database.']);
  });
});
