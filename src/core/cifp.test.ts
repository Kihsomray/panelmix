import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { distanceNm } from './geo';
import { NavDatabase, type RawAirway, type RawFix, type RawLocalizer, type RawNavdata } from './navdb';
import { createProcedureSource, PROC_RETRY_MS, type ProcFetch } from './procdb';
import {
  shortApproachName,
  type AirportProcedures,
  type Approach,
  type ApproachMinima,
  type ApproachType,
  type PathTerminator,
  type ProcLeg,
  type ProcTransition,
  type TerminalProcedure,
} from './procedures';

// Reading the generated procedure files is disk-bound on a small machine.
vi.setConfig({ testTimeout: 30_000 });

/*
 * Checks the files scripts/build-cifp.mjs writes from the FAA CIFP (cycle
 * 2611) against the procedures as charted. Rebuild with
 * `node scripts/build-cifp.mjs` when the cycle changes.
 */

const DATA = 'public/data';
const readJson = <T>(file: string): T => JSON.parse(readFileSync(`${DATA}/${file}`, 'utf8')) as T;
const airport = (ident: string) => readJson<AirportProcedures>(`proc/${ident}.json`);

function find<T>(list: readonly T[], match: (item: T) => boolean, what: string): T {
  const hit = list.find(match);
  if (!hit) throw new Error(`missing ${what}`);
  return hit;
}

const approach = (apt: AirportProcedures, id: string): Approach => find(apt.approaches, (a) => a.id === id, `${apt.airport} ${id}`);
const transition = (list: readonly ProcTransition[], name: string) => find(list, (t) => t.name === name, `transition ${name}`);
const route = (legs: readonly ProcLeg[]) => legs.map((l) => `${l.path}${l.fix ? ` ${l.fix.ident}` : ''}`);

const fixes = readJson<{ v: 1; cycle: string; fixes: RawFix[] }>('fixes.json');
const localizers = readJson<{ v: 1; cycle: string; items: RawLocalizer[] }>('localizers.json');
const airways = readJson<{ v: 1; cycle: string; items: RawAirway[] }>('airways.json');
const db = new NavDatabase(readJson<RawNavdata>('navdata.json'), {
  fixes: fixes.fixes,
  localizers: localizers.items,
  airways: airways.items,
});

const KJYO = airport('KJYO');

describe('KJYO RNAV (GPS) RWY 17', () => {
  const rnav = approach(KJYO, 'R17');

  it('is named like the chart and lists its transitions and minima', () => {
    expect(rnav.type).toBe('RNAV');
    expect(rnav.name).toBe('RNAV (GPS) RWY 17');
    expect(rnav.runway).toBe('17');
    expect(shortApproachName(rnav)).toBe('RNAV 17');
    expect(rnav.transitions.map((t) => t.name)).toEqual(['CACAS', 'HOAGE', 'MRB', 'ZAXEN']);
    expect(rnav.minima).toEqual(['LPV', 'LNAV/VNAV', 'LNAV']);
  });

  it('feeds from the IAFs to CACAS, with a hold in lieu of a procedure turn there', () => {
    expect(route(transition(rnav.transitions, 'HOAGE').legs)).toEqual(['IF HOAGE', 'TF KORNY', 'TF CACAS']);
    expect(transition(rnav.transitions, 'HOAGE').legs[1]).toMatchObject({ iaf: true, altitude: { kind: 'atOrAbove', ft: 4000 } });
    expect(transition(rnav.transitions, 'MRB').legs[0]).toMatchObject({ path: 'IF', fix: { ident: 'MRB', kind: 'vor' }, iaf: true });
    const [hold] = transition(rnav.transitions, 'CACAS').legs;
    expect(hold).toMatchObject({ path: 'HF', fix: { ident: 'CACAS' }, turn: 'R', courseMag: 171.2, distanceNm: 4, iaf: true });
    expect(hold?.altitude).toEqual({ kind: 'atOrAbove', ft: 3000 });
  });

  it('flies the final from CACAS through DANMO at 2,100 ft to the MAP at the threshold', () => {
    expect(route(rnav.final)).toEqual(['IF CACAS', 'TF DANMO', 'TF CEYAC', 'TF RW17']);
    expect(rnav.final[0]).toMatchObject({ if: true, altitude: { kind: 'atOrAbove', ft: 3000 } });
    expect(rnav.final[1]).toMatchObject({ faf: true, altitude: { kind: 'atOrAbove', ft: 2100 } });
    expect(rnav.final[2]).toMatchObject({ altitude: { kind: 'atOrAbove', ft: 1280 }, verticalAngleDeg: -3 });
    const map = rnav.final[3];
    expect(map).toMatchObject({ map: true, flyover: true, verticalAngleDeg: -3, fix: { kind: 'runway' } });
    expect(map?.fix?.lat).toBeCloseTo(39.08512, 4);
    expect(map?.fix?.lon).toBeCloseTo(-77.56061, 4);
  });

  it('climbs to 1,100 ft on the missed approach, then goes direct KORNY and holds', () => {
    expect(route(rnav.missed)).toEqual(['CA', 'DF KORNY', 'HM KORNY']);
    expect(rnav.missed[0]).toMatchObject({ courseMag: 171.3, altitude: { kind: 'atOrAbove', ft: 1100 } });
    expect(rnav.missed[1]).toMatchObject({ turn: 'R', altitude: { kind: 'atOrAbove', ft: 4000 } });
    expect(rnav.missed[2]).toMatchObject({ turn: 'R', courseMag: 81.1, distanceNm: 4, altitude: { kind: 'atOrAbove', ft: 4000 } });
  });

  it('carries the LPV glidepath from the FAS data block', () => {
    const path = rnav.path;
    expect(path).toBeDefined();
    expect(path?.angleDeg).toBe(3);
    expect(path?.tchFt).toBeCloseTo(44.8, 1);
    expect(path?.thresholdElevationFt).toBe(378);
    expect(path?.courseMag).toBeCloseTo(171, 0);
    expect(distanceNm({ lat: path?.thresholdLat ?? 0, lon: path?.thresholdLon ?? 0 }, { lat: 39.08512, lon: -77.56061 })).toBeLessThan(0.01);
  });

  it('has its runways from the PG records', () => {
    expect(KJYO.runways.map((r) => r.ident)).toEqual(['17', '35']);
    expect(KJYO.runways[0]).toMatchObject({ elevationFt: 378, tchFt: 45, courseMag: 171, lengthFt: 5500 });
  });
});

describe('KJYO ILS RWY 17', () => {
  const ils = approach(KJYO, 'I17');

  it('flies the IJYO localizer with a 3.00 degree glideslope', () => {
    expect(ils.type).toBe('ILS');
    expect(ils.name).toBe('ILS RWY 17');
    expect(ils.localizer).toBe('IJYO');
    expect(ils.path).toMatchObject({ angleDeg: 3, tchFt: 45, courseMag: 171.3, thresholdElevationFt: 378 });
    expect(route(ils.final)).toEqual(['IF STILL', 'CF JOTUP', 'CF DANMO', 'CF RW17']);
    // The glideslope intercept at the FAF; the FACF keeps its own 3,000 ft restriction.
    expect(ils.final[2]).toMatchObject({ faf: true, altitude: { kind: 'glideslope', ft: 2100 } });
    expect(ils.final[0]?.altitude).toEqual({ kind: 'atOrAbove', ft: 3000 });
    for (const leg of ils.final.slice(1)) expect(leg).toMatchObject({ courseMag: 171, recommendedNavaid: { ident: 'IJYO', kind: 'loc' } });
    expect(route(ils.missed)).toEqual(['CA', 'VI', 'CF GAWDD', 'HM GAWDD']);
    expect(ils.missed[3]).toMatchObject({ turn: 'R', courseMag: 157.6, legTimeMin: 1 });
  });

  it('is tunable on 111.75 with its glideslope and threshold', () => {
    const loc = db.localizer('IJYO');
    expect(loc).toMatchObject({ airport: 'KJYO', runway: '17', freqKhz: 111750, courseMag: 171.3, widthDeg: 6, magVar: -10 });
    expect(loc?.glideslope).toMatchObject({ angleDeg: 3, elevationFt: 372 });
    expect(loc?.threshold).toMatchObject({ elevationFt: 378, tchFt: 45 });
    expect(db.tuneLocalizer(111750, { lat: 39.2, lon: -77.6 })?.ident).toBe('IJYO');
  });

  it('has the LOC-only approach on the same localizer', () => {
    const loc = approach(KJYO, 'L17');
    expect(loc).toMatchObject({ type: 'LOC', name: 'LOC RWY 17', localizer: 'IJYO' });
    expect(loc.final[2]?.altitude).toEqual({ kind: 'atOrAbove', ft: 2100 });
  });
});

describe('arcs and holds', () => {
  it('codes a DME arc as an AF leg around the VOR (KSNS ILS RWY 31 via ARTYY)', () => {
    const ils = approach(airport('KSNS'), 'I31');
    const legs = transition(ils.transitions, 'SNS2').legs;
    expect(route(legs)).toEqual(['IF SNS', 'TF ARTYY', 'AF AANNE']);
    const arc = legs[2];
    expect(arc).toMatchObject({ turn: 'R', arcRadiusNm: 22, rhoNm: 22, thetaDeg: 131.2, courseMag: 107, recommendedNavaid: { ident: 'SNS', kind: 'vor' } });
    const center = arc?.arcCenter ?? { lat: 0, lon: 0 };
    expect(distanceNm(center, legs[0]?.fix ?? center)).toBeLessThan(0.01);
    // Both ends of the arc sit on the 22 DME circle.
    for (const end of [legs[1]?.fix, arc?.fix]) expect(distanceNm(center, end ?? center)).toBeCloseTo(22, 0);
  });

  it('codes radius-to-fix turns with a center and radius (KDCA RNAV (RNP) Z RWY 19)', () => {
    const rnp = approach(airport('KDCA'), 'H19-Z');
    expect(rnp).toMatchObject({ type: 'RNP', name: 'RNAV (RNP) Z RWY 19', runway: '19' });
    expect(shortApproachName(rnp)).toBe('RNP Z 19');
    const rf = rnp.final.filter((l) => l.path === 'RF');
    expect(rf.map((l) => l.fix?.ident)).toEqual(['FONVI', 'JUBOL', 'FIROP']);
    for (const leg of rf) {
      expect(leg.arcCenter).toBeDefined();
      expect(distanceNm(leg.arcCenter ?? { lat: 0, lon: 0 }, leg.fix ?? { lat: 0, lon: 0 })).toBeCloseTo(leg.arcRadiusNm ?? 0, 1);
    }
    expect(rf[0]).toMatchObject({ turn: 'L', arcRadiusNm: 1.5 });
    // The vertical path runs along the last segment into the runway, after the turns.
    expect(rnp.path).toMatchObject({ angleDeg: 3, tchFt: 50 });
    expect(rnp.path?.courseMag).toBeCloseTo(186.5, 0);
  });

  it('marks holds in lieu of a procedure turn and course reversals', () => {
    const cacas = transition(approach(KJYO, 'R17').transitions, 'CACAS').legs[0];
    expect(cacas?.path).toBe('HF');
    const vorA = approach(airport('1G1'), 'VOR-A');
    expect(vorA.name).toBe('VOR-A');
    expect(vorA.runway).toBeNull();
    expect(transition(vorA.transitions, 'DJB').legs[0]).toMatchObject({ path: 'PI', turn: 'R', courseMag: 260, distanceNm: 10 });
  });
});

describe('SIDs and STARs', () => {
  const findProc = (list: readonly TerminalProcedure[], id: string) => find(list, (p) => p.id === id, id);

  it('splits a SID into runway transitions, the common route and enroute transitions (KIAD JCOBY4)', () => {
    const sid = findProc(airport('KIAD').departures, 'JCOBY4');
    expect(sid).toMatchObject({ kind: 'SID', name: 'JCOBY4' });
    expect(sid.runwayTransitions.map((t) => t.name)).toEqual(['RW01B', 'RW19B', 'RW30']);
    expect(route(transition(sid.runwayTransitions, 'RW30').legs)).toEqual(['VA', 'VM', 'DF RIGNZ']);
    expect(transition(sid.runwayTransitions, 'RW30').legs[0]?.altitude?.kind).toBe('atOrAbove');
    expect(route(sid.common)).toEqual(['IF RIGNZ', 'TF JCOBY']);
    expect(sid.enrouteTransitions.map((t) => t.name)).toEqual(['AGARD', 'COLIN', 'SCOOB', 'SWANN']);
    expect(route(transition(sid.enrouteTransitions, 'SWANN').legs)).toEqual(['IF JCOBY', 'TF GRIIM', 'TF SOOKI', 'TF SWANN']);
  });

  it('splits a STAR into enroute transitions and the common route (KJYO GIBBZ6)', () => {
    const star = findProc(KJYO.arrivals, 'GIBBZ6');
    expect(star.kind).toBe('STAR');
    expect(star.enrouteTransitions.map((t) => t.name)).toEqual(['BURTT', 'HVQ', 'MGW', 'SITTR']);
    const hesee = find(transition(star.enrouteTransitions, 'BURTT').legs, (l) => l.fix?.ident === 'HESEE', 'HESEE');
    expect(hesee).toMatchObject({ altitude: { kind: 'between', aboveFt: 24000, belowFt: 30000 }, speedKt: 280 });
    expect(route(star.common)).toEqual(['IF GIBBZ', 'TF SUNYJ', 'TF TATAA', 'FM TATAA']);
    expect(star.common[3]).toMatchObject({ courseMag: 9.4, recommendedNavaid: { ident: 'ADW' } });
  });

  it('has runway transitions on STARs too (KDCA CAPSS4)', () => {
    const star = findProc(airport('KDCA').arrivals, 'CAPSS4');
    expect(star.runwayTransitions.map((t) => t.name)).toEqual(['RW01', 'RW04', 'RW15', 'RW19', 'RW22', 'RW33']);
    expect(star.enrouteTransitions.length).toBe(2);
  });
});

describe('fixes, localizers and airways', () => {
  it('keeps fixes.json inside its 2 MB budget with the approach fixes', () => {
    expect(statSync(`${DATA}/fixes.json`).size).toBeLessThan(2_000_000);
    expect(fixes.cycle).toBe('2611');
    const cacas = db.find('CACAS')[0];
    expect(cacas).toMatchObject({ kind: 'fix', region: 'KJYO' });
    expect(cacas?.lat).toBeCloseTo(39.27896, 4);
    expect(db.find('HOAGE')[0]).toMatchObject({ kind: 'fix', region: 'ENRT' });
    // Missed approach holding fixes are kept as well.
    expect(db.find('GAWDD')[0]).toMatchObject({ kind: 'fix', region: 'KJYO' });
  });

  it('decodes localizers with and without glideslopes', () => {
    expect(localizers.items.length).toBeGreaterThan(1000);
    const withGs = localizers.items.filter((l) => l[10] !== null);
    expect(withGs.length).toBeGreaterThan(1000);
    for (const l of localizers.items) {
      expect(l[3] >= 108000 && l[3] <= 112000).toBe(true);
      expect(l[6] >= 0 && l[6] < 360).toBe(true);
    }
  });

  it('orders V3 fixes along the airway and finds airways at a fix', () => {
    const v3 = db.airway('V3');
    expect(v3?.level).toBe('L');
    expect(v3?.fixes[0]?.ident).toBe('EYW'); // the mainland V3 first, not the one on Hawaii
    const north = find(airways.items, (w) => w[0] === 'V3' && w[2].some((f) => f[0] === 'MRB'), 'V3 through MRB');
    const idents = north[2].map((f) => f[0]);
    const at = idents.indexOf('HOAGE');
    expect(idents.slice(at, at + 4)).toEqual(['HOAGE', 'MRB', 'RUANE', 'EMI']);
    expect(idents.at(-1)).toBe('BOS');
    expect(db.airwaysAt('MRB').map((w) => w.name)).toContain('V3');
    // Consecutive fixes of a segment are never far apart: segments split where the airway has a gap.
    for (const [, , list] of airways.items) {
      for (let i = 1; i < list.length; i++) {
        const [, lat0, lon0] = list[i - 1] ?? ['', 0, 0];
        const [, lat1, lon1] = list[i] ?? ['', 0, 0];
        expect(distanceNm({ lat: lat0, lon: lon0 }, { lat: lat1, lon: lon1 })).toBeLessThan(700);
      }
    }
  });
});

/** The exact keys of each contract type: the files must not carry anything else. */
const sameKeys = (o: object, keys: readonly string[]) => Object.keys(o).sort().join() === [...keys].sort().join();
const hasKeys = (o: object, required: readonly string[], optional: readonly string[] = []) =>
  required.every((k) => k in o) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));
const LEG_OPTIONAL = [
  'fix', 'turn', 'courseMag', 'distanceNm', 'legTimeMin', 'altitude', 'speedKt', 'verticalAngleDeg', 'arcCenter',
  'arcRadiusNm', 'recommendedNavaid', 'thetaDeg', 'rhoNm', 'iaf', 'if', 'faf', 'map', 'flyover',
];
const PATH_TERMINATORS = new Set<PathTerminator>([
  'IF', 'TF', 'CF', 'DF', 'FA', 'FC', 'FD', 'FM', 'CA', 'CD', 'CI', 'CR', 'RF', 'AF', 'VA', 'VD', 'VI', 'VM', 'VR', 'PI', 'HA', 'HF', 'HM',
]);
const APPROACH_TYPES = new Set<ApproachType>([
  'RNAV', 'RNP', 'GPS', 'ILS', 'LOC', 'LOC BC', 'LDA', 'SDF', 'VOR', 'VOR/DME', 'NDB', 'NDB/DME', 'TACAN', 'GLS', 'IGS',
]);
const MINIMA = new Set<ApproachMinima>(['LPV', 'LP', 'LNAV/VNAV', 'LNAV']);
const FIX_KINDS = new Set(['fix', 'vor', 'ndb', 'runway', 'airport', 'loc']);

function legShapeProblems(leg: ProcLeg): string[] {
  const out: string[] = [];
  if (!hasKeys(leg, ['path'], LEG_OPTIONAL)) out.push(`keys ${Object.keys(leg).join(',')}`);
  if (!PATH_TERMINATORS.has(leg.path)) out.push(`path ${leg.path}`);
  for (const f of [leg.fix, leg.recommendedNavaid]) {
    if (f && (!sameKeys(f, ['ident', 'lat', 'lon', 'kind']) || !FIX_KINDS.has(f.kind))) out.push('fix shape');
  }
  if (leg.arcCenter && !sameKeys(leg.arcCenter, ['lat', 'lon'])) out.push('arc center shape');
  if (leg.turn !== undefined && leg.turn !== 'L' && leg.turn !== 'R') out.push('turn');
  for (const flag of ['iaf', 'if', 'faf', 'map', 'flyover'] as const) if (leg[flag] !== undefined && leg[flag] !== true) out.push(flag);
  for (const angle of [leg.courseMag, leg.thetaDeg]) if (angle !== undefined && !(angle >= 0 && angle < 360)) out.push('angle');
  const alt = leg.altitude;
  if (alt) {
    const ok =
      alt.kind === 'between'
        ? sameKeys(alt, ['kind', 'aboveFt', 'belowFt']) && alt.aboveFt <= alt.belowFt
        : sameKeys(alt, ['kind', 'ft']) && Number.isFinite(alt.ft);
    if (!ok) out.push('altitude');
  }
  return out;
}

describe('every procedure file', () => {
  const index = readJson<{ v: 1; cycle: string; airports: string[] }>('proc/index.json');
  const files = readdirSync(`${DATA}/proc`).filter((f) => f !== 'index.json');
  const all = index.airports.map(airport);
  const everyLeg = (apt: AirportProcedures, visit: (where: string, leg: ProcLeg) => void) => {
    for (const a of apt.approaches) {
      for (const t of a.transitions) for (const l of t.legs) visit(`${a.id} ${t.name}`, l);
      for (const l of a.final) visit(`${a.id} final`, l);
      for (const l of a.missed) visit(`${a.id} missed`, l);
    }
    for (const p of [...apt.departures, ...apt.arrivals]) {
      for (const t of [...p.runwayTransitions, ...p.enrouteTransitions]) for (const l of t.legs) visit(`${p.id} ${t.name}`, l);
      for (const l of p.common) visit(`${p.id} common`, l);
    }
  };

  it('is listed in the index', () => {
    expect(index.cycle).toBe('2611');
    expect(index.airports.length).toBeGreaterThan(3000);
    expect(new Set(files)).toEqual(new Set(index.airports.map((a) => `${a}.json`)));
  });

  it('matches the AirportProcedures types exactly', () => {
    const problems: string[] = [];
    for (const apt of all) {
      const at = (what: string) => problems.push(`${apt.airport} ${what}`);
      if (!sameKeys(apt, ['v', 'airport', 'cycle', 'runways', 'approaches', 'departures', 'arrivals']) || apt.v !== 1 || apt.cycle !== '2611') at('header');
      for (const r of apt.runways) if (!sameKeys(r, ['ident', 'lat', 'lon', 'elevationFt', 'tchFt', 'courseMag', 'lengthFt'])) at(`runway ${r.ident}`);
      const ids = new Set<string>();
      for (const a of apt.approaches) {
        if (ids.has(a.id)) at(`duplicate ${a.id}`);
        ids.add(a.id);
        if (!hasKeys(a, ['id', 'type', 'name', 'runway', 'minima', 'transitions', 'final', 'missed'], ['localizer', 'path'])) at(`${a.id} keys`);
        if (!APPROACH_TYPES.has(a.type) || !a.minima.every((m) => MINIMA.has(m))) at(`${a.id} type/minima`);
        if (a.path && !sameKeys(a.path, ['thresholdLat', 'thresholdLon', 'thresholdElevationFt', 'tchFt', 'angleDeg', 'courseMag'])) at(`${a.id} path`);
        for (const t of a.transitions) if (!sameKeys(t, ['name', 'legs']) || !t.name) at(`${a.id} transition`);
      }
      for (const p of [...apt.departures, ...apt.arrivals]) {
        if (!sameKeys(p, ['id', 'kind', 'name', 'runwayTransitions', 'common', 'enrouteTransitions'])) at(`${p.id} keys`);
      }
      everyLeg(apt, (where, leg) => {
        for (const p of legShapeProblems(leg)) at(`${where}: ${p}`);
      });
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('resolves every leg fix, arc and threshold to coordinates', () => {
    const NEEDS_FIX = new Set(['IF', 'TF', 'CF', 'DF', 'RF', 'AF', 'HF', 'HM', 'HA', 'FC', 'FD', 'FA', 'FM', 'PI']);
    const onEarth = (p: { lat: number; lon: number } | undefined) =>
      p === undefined || (Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    const problems: string[] = [];
    let legs = 0;
    for (const apt of all) {
      const ident = apt.airport;
      everyLeg(apt, (where, leg) => {
        legs++;
        if (NEEDS_FIX.has(leg.path) && !leg.fix) problems.push(`${ident} ${where} ${leg.path}: no fix`);
        if ((leg.path === 'RF' || leg.path === 'AF') && !(leg.arcCenter && leg.arcRadiusNm)) problems.push(`${ident} ${where} ${leg.path}: no arc`);
        if (!onEarth(leg.fix) || !onEarth(leg.arcCenter) || !onEarth(leg.recommendedNavaid)) problems.push(`${ident} ${where}: bad position`);
      });
      for (const a of apt.approaches) {
        // Through the MAP, with a FAF, then a missed approach: what the FMS sequences on.
        if (!a.final.at(-1)?.map || !a.final.some((l) => l.faf) || a.missed.length === 0) problems.push(`${ident} ${a.id}: FAF/MAP/missed`);
        if (a.path && !(a.path.angleDeg > 2 && a.path.angleDeg < 7 && a.path.tchFt > 0)) problems.push(`${ident} ${a.id}: path`);
      }
      for (const r of apt.runways) if (!onEarth(r)) problems.push(`${ident} RW${r.ident}: bad position`);
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(legs).toBeGreaterThan(150_000);
  });
});

describe('procedure source', () => {
  /** Serves public/ from disk the way the dev server would. */
  const fromDisk: ProcFetch = async (url) => {
    try {
      const text = readFileSync(`public/${url.replace(/^\.\//, '')}`, 'utf8');
      return { ok: true, json: async () => JSON.parse(text) as unknown };
    } catch {
      return { ok: false, json: async () => null };
    }
  };

  it('loads an airport on demand, caches it and tells subscribers', async () => {
    const source = await createProcedureSource('./', fromDisk);
    expect(source.cycle).toBe('2611');
    expect(source.has('kjyo')).toBe(true);
    expect(source.has('KXYZ')).toBe(false);
    let calls = 0;
    const stop = source.subscribe(() => calls++);
    expect(source.get('KJYO')).toBeUndefined();
    const loaded = await source.load('KJYO');
    expect(loaded?.approaches.map((a) => a.id)).toContain('R17');
    expect(source.get('KJYO')).toBe(loaded);
    expect(calls).toBe(1);
    stop();
    await source.load('KIAD');
    expect(calls).toBe(1);
    expect(source.get('KXYZ')).toBeNull();
    expect(await source.load('KXYZ')).toBeNull();
  });

  it('retries an airport whose file failed to download', async () => {
    let offline = true;
    let clock = 0;
    const flaky: ProcFetch = (url) => (offline && url.endsWith('KJYO.json') ? Promise.reject(new Error('offline')) : fromDisk(url));
    const source = await createProcedureSource('./', flaky, () => clock);
    expect(await source.load('KJYO')).toBeNull();
    expect(source.get('KJYO')).toBeNull(); // not hammering the network every frame
    offline = false;
    clock += PROC_RETRY_MS;
    expect(source.get('KJYO')).toBeUndefined(); // retrying
    expect((await source.load('KJYO'))?.airport).toBe('KJYO');
  });

  it('treats a missing index as an empty database', async () => {
    const source = await createProcedureSource('./nowhere/', fromDisk);
    expect(source.has('KJYO')).toBe(false);
    expect(source.get('KJYO')).toBeNull();
  });
});
