import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, crossTrackNm, destination, distanceNm, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import type { RouteLeg } from '../../sim/fms/types';
import { approachPaths, arcPoints, cachedApproachPaths, DRAW_TURN_RADIUS_NM, holdLegNm, holdRacetrack } from './approachLayer';

const fix = (ident: string, p: LatLon): Waypoint => ({ kind: 'fix', ident, name: ident, lat: p.lat, lon: p.lon });
const leg = (l: Partial<RouteLeg> & Pick<RouteLeg, 'path'>): RouteLeg => ({ to: null, segment: 'final', label: l.to?.ident ?? l.path, ...l });

const HOLD_FIX: LatLon = { lat: 39.0, lon: -77.5 };
const r = DRAW_TURN_RADIUS_NM;

describe('hold racetrack', () => {
  it('is a closed loop through the fix, all on the holding side', () => {
    const inbound = 170;
    const before = destination(HOLD_FIX, inbound + 180, 5);
    const pts = holdRacetrack(HOLD_FIX, inbound, 'R', 1.5);
    expect(distanceNm(pts[0]!, HOLD_FIX)).toBeLessThan(1e-6);
    expect(distanceNm(pts[pts.length - 1]!, HOLD_FIX)).toBeLessThan(1e-6);
    // Cross track from the inbound course line: right turns hold on the right.
    const xt = pts.map((p) => crossTrackNm(before, HOLD_FIX, p));
    expect(Math.min(...xt)).toBeGreaterThan(-0.01);
    expect(Math.max(...xt)).toBeCloseTo(2 * r, 2);
  });

  it('spans the leg length plus a turn diameter, the turn at the fix overshooting it by one radius', () => {
    const inbound = 90;
    const pts = holdRacetrack(HOLD_FIX, inbound, 'L', 2);
    const before = destination(HOLD_FIX, inbound + 180, 5);
    // Along track of each point from the fix (positive beyond the fix).
    const along = pts.map((p) => distanceNm(before, p) * Math.cos(((bearing(before, p) - inbound) * Math.PI) / 180) - 5);
    expect(Math.max(...along)).toBeCloseTo(r, 2);
    expect(Math.min(...along)).toBeCloseTo(-2 - r, 2);
    const xt = pts.map((p) => crossTrackNm(before, HOLD_FIX, p));
    // Left turns hold on the left.
    expect(Math.max(...xt)).toBeLessThan(0.01);
    expect(Math.min(...xt)).toBeCloseTo(-2 * r, 2);
  });

  it('flies the outbound leg parallel to the inbound course', () => {
    const pts = holdRacetrack(HOLD_FIX, 0, 'R', 1.5);
    // The point after the first turn (abeam the fix) and before the second turn (end of the outbound leg).
    const half = (pts.length - 1) / 2;
    const abeam = pts[half - 1]!;
    const end = pts[half]!;
    expect(angleDiff(bearing(abeam, end), 180)).toBeCloseTo(0, 0);
    expect(distanceNm(abeam, end)).toBeCloseTo(1.5, 2);
  });

  it('sizes the legs from distance, time, or one minute (1.5 above 14,000 ft) at 90 kt', () => {
    expect(holdLegNm(leg({ path: 'HM', distanceNm: 4 }))).toBe(4);
    expect(holdLegNm(leg({ path: 'HM', legTimeMin: 1 }))).toBeCloseTo(1.5);
    expect(holdLegNm(leg({ path: 'HM' }))).toBeCloseTo(1.5);
    expect(holdLegNm(leg({ path: 'HA', altitude: { kind: 'atOrAbove', ft: 15000 } }))).toBeCloseTo(2.25);
  });
});

describe('arcs', () => {
  const center: LatLon = { lat: 39.2, lon: -77.4 };
  const a = destination(center, 300, 4);
  const b = destination(center, 30, 4);

  it('turns clockwise for R and counter-clockwise for L, at the radius', () => {
    const right = arcPoints(center, a, b, 'R', 4);
    expect(right[0]).toEqual(a);
    expect(right[right.length - 1]).toEqual(b);
    for (const p of right) expect(distanceNm(center, p)).toBeCloseTo(4, 2);
    // Clockwise from 300 through north to 030: every bearing in between is in that 90 degree sector.
    for (const p of right.slice(1, -1)) expect(angleDiff(bearing(center, p), 345)).toBeLessThan(45);
    const left = arcPoints(center, a, b, 'L', 4);
    // The long way round, through south.
    expect(left.length).toBeGreaterThan(right.length * 2);
    expect(left.some((p) => Math.abs(angleDiff(bearing(center, p), 165)) < 5)).toBe(true);
  });
});

describe('approach paths', () => {
  // A made-up RNAV approach: IAF, IF, FAF, an RF arc to the MAP, climb, intercept, then a hold.
  const iaf = fix('IAFIX', { lat: 39.3, lon: -77.7 });
  const ifx = fix('IFFIX', { lat: 39.3, lon: -77.55 });
  const faf = fix('FAFIX', destination(ifx, 170, 5));
  const center = destination(faf, 260, 2);
  const map = fix('RW17', destination(center, 120, 2));
  const mahp = fix('MAHPX', { lat: 39.05, lon: -77.4 });
  const legs: RouteLeg[] = [
    leg({ path: 'IF', to: iaf, segment: 'transition' }),
    leg({ path: 'TF', to: ifx, segment: 'transition' }),
    leg({ path: 'CF', to: faf, courseTrue: 170 }),
    leg({ path: 'RF', to: map, arcCenter: center, arcRadiusNm: 2, turn: 'L', altitude: { kind: 'at', ft: 440 } }),
    leg({ path: 'CA', courseTrue: 120, altitude: { kind: 'atOrAbove', ft: 1240 }, segment: 'missed' }),
    leg({ path: 'VI', courseTrue: 150, segment: 'missed' }),
    leg({ path: 'CF', to: mahp, courseTrue: 90, segment: 'missed' }),
    leg({ path: 'HM', to: mahp, courseTrue: 90, turn: 'R', legTimeMin: 1, segment: 'missed' }),
  ];
  const paths = approachPaths(legs);
  const byIndex = (i: number) => paths.find((p) => p.index === i)!;

  it('chains fix-to-fix legs', () => {
    expect(byIndex(0).points).toEqual([iaf]);
    expect(byIndex(1).points).toEqual([iaf, ifx]);
    expect(byIndex(2).points).toEqual([ifx, faf]);
  });

  it('draws the RF leg as an arc from the FAF to the MAP', () => {
    const arc = byIndex(3).points;
    expect(arc[0]).toEqual(faf);
    expect(arc[arc.length - 1]).toEqual(map);
    for (const p of arc) expect(distanceNm(center, p)).toBeCloseTo(2, 1);
  });

  it('sizes the climb from the last altitude at 400 ft per nm along the course', () => {
    const [start, end] = byIndex(4).points;
    expect(start).toEqual(map);
    expect(distanceNm(start!, end!)).toBeCloseTo((1240 - 440) / 400, 2);
    expect(angleDiff(bearing(start!, end!), 120)).toBeCloseTo(0, 1);
  });

  it('ends a heading-to-intercept leg on the next leg\'s course line', () => {
    const [start, end] = byIndex(5).points;
    // Heading 150 from the end of the climb until the line through the MAHP on course 090.
    expect(angleDiff(bearing(start!, end!), 150)).toBeCloseTo(0, 1);
    expect(Math.abs(crossTrackNm(destination(mahp, 270, 20), mahp, end!))).toBeLessThan(0.05);
    expect(byIndex(6).points[0]).toEqual(end);
  });

  it('holds as a racetrack at the missed approach fix', () => {
    const hold = byIndex(7);
    expect(hold.hold).toBe(true);
    expect(distanceNm(hold.points[0]!, mahp)).toBeLessThan(1e-6);
    expect(distanceNm(hold.points[hold.points.length - 1]!, mahp)).toBeLessThan(1e-6);
  });

  it('keeps a bounding box per leg and works the geometry out once per legs array', () => {
    for (const p of paths) {
      for (const q of p.points) {
        expect(q.lon).toBeGreaterThanOrEqual(p.bbox[0]);
        expect(q.lat).toBeGreaterThanOrEqual(p.bbox[1]);
        expect(q.lon).toBeLessThanOrEqual(p.bbox[2]);
        expect(q.lat).toBeLessThanOrEqual(p.bbox[3]);
      }
    }
    expect(cachedApproachPaths(legs)).toBe(cachedApproachPaths(legs));
  });

  it('draws a procedure turn as a barb off its fix, and the next leg from the fix', () => {
    const ptFix = fix('PTFIX', { lat: 39.0, lon: -77.0 });
    const fafFix = fix('FAFPT', destination(ptFix, 180, 5));
    const pt = approachPaths([
      leg({ path: 'IF', to: ptFix }),
      // The 45 degree leg goes out on 045 and the published 180 degree turn is to the left.
      leg({ path: 'PI', to: ptFix, courseTrue: 45, turn: 'L' }),
      leg({ path: 'CF', to: fafFix, courseTrue: 180 }),
    ]);
    const barb = pt.find((p) => p.leg.path === 'PI')!.points;
    expect(barb[0]).toEqual(ptFix);
    // Two miles out on 045, then a 180 degree turn to the left, then back on 225.
    expect(distanceNm(ptFix, barb[1]!)).toBeCloseTo(2, 2);
    expect(angleDiff(bearing(ptFix, barb[1]!), 45)).toBeCloseTo(0, 1);
    const end = barb[barb.length - 1]!;
    const back = barb[barb.length - 2]!;
    expect(angleDiff(bearing(back, end), 225)).toBeCloseTo(0, 0);
    expect(crossTrackNm(ptFix, barb[1]!, back)).toBeLessThan(0);
    expect(pt.find((p) => p.leg.path === 'CF')!.points[0]).toEqual(ptFix);
  });

  it('draws open legs as short vectors and a first leg without a start as a stub into its fix', () => {
    const vm = approachPaths([leg({ path: 'VM', courseTrue: 200 })]);
    expect(vm).toHaveLength(0);
    const stub = approachPaths([leg({ path: 'CF', to: faf, courseTrue: 170 }), leg({ path: 'VM', courseTrue: 200, segment: 'missed' })]);
    expect(distanceNm(stub[0]!.points[0]!, faf)).toBeCloseTo(3, 2);
    expect(distanceNm(stub[1]!.points[0]!, stub[1]!.points[1]!)).toBeCloseTo(4, 2);
  });
});
