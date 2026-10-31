import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COM, formatCom, formatNav, isLocalizer, isValid, NAV, parseKeypad, stepChannel, stepMhz } from './frequency';
import {
  alongTrackNm,
  angleDiff,
  bearing,
  crossTrackNm,
  destination,
  distanceNm,
  formatLat,
  formatLon,
  norm360,
  windTriangle,
} from './geo';
import { MagneticModel, type MagvarGrid } from './magvar';
import { NavDatabase, type RawNavdata } from './navdb';

const db = new NavDatabase(JSON.parse(readFileSync('public/data/navdata.json', 'utf8')) as RawNavdata);
const mag = new MagneticModel(JSON.parse(readFileSync('public/data/magvar.json', 'utf8')) as MagvarGrid);

const IAD = { lat: 38.9445, lon: -77.4558 };
const JFK = { lat: 40.6398, lon: -73.7789 };

describe('geo', () => {
  it('wraps angles', () => {
    expect(norm360(-10)).toBe(350);
    expect(norm360(720)).toBe(0);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
  });

  it('measures great-circle distance and course', () => {
    // IAD to JFK: about 198 nm, initial great-circle course about 058 true (the rhumb line is 059).
    expect(distanceNm(IAD, JFK)).toBeGreaterThan(197);
    expect(distanceNm(IAD, JFK)).toBeLessThan(199);
    expect(bearing(IAD, JFK)).toBeCloseTo(57.9, 0);
  });

  it('round-trips destination with distance and bearing', () => {
    const p = destination(IAD, 123, 45);
    expect(distanceNm(IAD, p)).toBeCloseTo(45, 6);
    expect(bearing(IAD, p)).toBeCloseTo(123, 6);
  });

  it('signs cross-track distance right of course positive', () => {
    const from = { lat: 39, lon: -77 };
    const to = destination(from, 0, 60);
    const right = destination(destination(from, 0, 30), 90, 2);
    const left = destination(destination(from, 0, 30), 270, 2);
    expect(crossTrackNm(from, to, right)).toBeCloseTo(2, 2);
    expect(crossTrackNm(from, to, left)).toBeCloseTo(-2, 2);
    expect(alongTrackNm(from, to, right)).toBeCloseTo(30, 1);
    expect(alongTrackNm(from, to, destination(from, 180, 5))).toBeCloseTo(-5, 1);
  });

  it('solves the wind triangle', () => {
    // A 20 kt wind from the left pushes the track right of the heading.
    const w = windTriangle(0, 100, 270, 20);
    expect(w.trackTrue).toBeCloseTo(11.3, 1);
    expect(w.groundSpeedKt).toBeCloseTo(102, 0);
    const head = windTriangle(90, 100, 90, 30);
    expect(head.groundSpeedKt).toBeCloseTo(70, 6);
  });

  it('formats coordinates the Garmin way', () => {
    expect(formatLat(38.9346)).toBe("N38°56.08'");
    expect(formatLon(-77.4667)).toBe("W077°28.00'");
  });
});

describe('frequency', () => {
  it('steps MHz and channels independently with wrap-around', () => {
    expect(stepMhz(COM, 136975, 1)).toBe(118975);
    expect(stepMhz(COM, 118000, -1)).toBe(136000);
    expect(stepChannel(COM, 118975, 1)).toBe(118000);
    expect(stepChannel(COM, 118000, -1)).toBe(118975);
    expect(stepChannel(NAV, 113500, 1)).toBe(113550);
    expect(stepChannel(NAV, 117950, 1)).toBe(117000);
    expect(stepMhz(NAV, 117950, 1)).toBe(108950);
  });

  it('validates and formats', () => {
    expect(isValid(COM, 122975)).toBe(true);
    expect(isValid(COM, 122970)).toBe(false);
    expect(isValid(NAV, 108000)).toBe(true);
    expect(formatCom(122975)).toBe('122.975');
    expect(formatNav(113500)).toBe('113.50');
    expect(isLocalizer(110300)).toBe(true);
    expect(isLocalizer(110200)).toBe(false);
    expect(isLocalizer(113500)).toBe(false);
  });

  it('parses keypad entry', () => {
    expect(parseKeypad(COM, '1185')).toBe(118500);
    expect(parseKeypad(COM, '118.5')).toBe(118500);
    expect(parseKeypad(COM, '122975')).toBe(122975);
    expect(parseKeypad(COM, '12297')).toBe(122975);
    expect(parseKeypad(COM, '99')).toBeNull();
    expect(parseKeypad(COM, '1405')).toBeNull();
    expect(parseKeypad(NAV, '1135')).toBe(113500);
  });
});

describe('magnetic variation', () => {
  it('matches WMM-2025 around Washington (about 10.5 degrees west)', () => {
    expect(mag.variation(39, -77.5)).toBeGreaterThan(-11.5);
    expect(mag.variation(39, -77.5)).toBeLessThan(-9.5);
    expect(mag.toMagnetic(0, 39, -77.5)).toBeCloseTo(-mag.variation(39, -77.5), 6);
  });

  it('is east on the west coast', () => {
    expect(mag.variation(37.6, -122.4)).toBeGreaterThan(11);
  });
});

describe('navigation database', () => {
  it('finds airports and navaids by identifier', () => {
    expect(db.airport('KJYO')?.name).toMatch(/Leesburg/);
    expect(db.find('AML')[0]).toMatchObject({ kind: 'vor', freqKhz: 113500 });
    expect(db.find('W05')[0]?.kind).toBe('airport');
  });

  it('spells ahead to the first matching identifier', () => {
    // Alphabetically first: KJYG comes before KJYO, as on a real navigator.
    expect(db.complete('KJY')?.ident).toBe(db.search('KJY', 1)[0]?.ident);
    expect(db.complete('KJYO')?.ident).toBe('KJYO');
    expect(db.complete('ZZZZ')).toBeUndefined();
    const results = db.search('KJ', 5);
    expect(results.length).toBe(5);
    expect(results.every((w) => w.ident.startsWith('KJ'))).toBe(true);
  });

  it('lists the nearest airports in distance order', () => {
    const near = db.nearestAirports({ lat: 39.078, lon: -77.5575 }, 9);
    expect(near[0]?.item.ident).toBe('KJYO');
    expect(near).toHaveLength(9);
    for (let i = 1; i < near.length; i++) expect(near[i]!.distanceNm).toBeGreaterThanOrEqual(near[i - 1]!.distanceNm);
    // The grid search must agree with brute force.
    const brute = [...db.airports]
      .map((a) => ({ a, d: distanceNm({ lat: 39.078, lon: -77.5575 }, a) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 9)
      .map((x) => x.a.ident);
    expect(near.map((n) => n.item.ident)).toEqual(brute);
  });

  it('filters nearest airports by runway', () => {
    const long = db.nearestAirports({ lat: 39.078, lon: -77.5575 }, 5, { minRunwayFt: 8000 });
    expect(long.every((n) => n.item.runways[0]!.lengthFt >= 8000)).toBe(true);
  });

  it('tunes the station in range on a frequency', () => {
    const station = db.tune(113500, { lat: 39.1, lon: -77.6 }, 3500);
    expect(station?.ident).toBe('AML');
    // Far away and low, the same frequency is out of range.
    expect(db.tune(113500, { lat: 33, lon: -112 }, 1500)?.ident).not.toBe('AML');
  });
});
