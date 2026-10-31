import { describe, expect, it } from 'vitest';
import { project, queryBox, visibleGroups, type BasemapView } from './basemap';
import { DEFAULT_SETTINGS } from './settings';

const view: BasemapView = { cx: 200, cy: 566, pxPerNm: 10, upTrue: 0, ownship: { lat: 39, lon: -77.5 }, rangeNm: 15 };

describe('Aspen basemap', () => {
  it('puts the ownship at the compass center and turns the map heading-up', () => {
    expect(project(view, view.ownship)).toEqual({ x: 200, y: 566 });
    // 6 nm north, north-up: straight up the screen.
    const north = project(view, { lat: 39.1, lon: -77.5 });
    expect(north.x).toBeCloseTo(200, 3);
    expect(north.y).toBeCloseTo(566 - 60, 0);
    // Heading east (090 true): the same point is now to the left.
    const east = project({ ...view, upTrue: 90 }, { lat: 39.1, lon: -77.5 });
    expect(east.x).toBeCloseTo(200 - 60, 0);
    expect(east.y).toBeCloseTo(566, 0);
  });

  it('drops feature groups by declutter level, menu switch and range', () => {
    const m = DEFAULT_SETTINGS.map360;
    expect(visibleGroups(m, 10)).toEqual({ fpl: true, apt: true, vor: true, ndb: true });
    expect(visibleGroups(m, 30)).toEqual({ fpl: true, apt: true, vor: true, ndb: false });
    expect(visibleGroups(m, 200)).toEqual({ fpl: true, apt: false, vor: true, ndb: false });
    expect(visibleGroups({ ...m, declutter: 1 }, 10)).toEqual({ fpl: true, apt: false, vor: false, ndb: false });
    expect(visibleGroups({ ...m, declutter: 0 }, 10)).toEqual({ fpl: false, apt: false, vor: false, ndb: false });
    expect(visibleGroups({ ...m, show: { ...m.show, vor: false } }, 10).vor).toBe(false);
  });

  it('queries a box wide enough for any rotation', () => {
    const box = queryBox({ lat: 39, lon: -77.5 }, 15);
    expect(box.north - 39).toBeCloseTo((15 * 1.9 + 8) / 60, 6);
    expect(box.east - -77.5).toBeGreaterThan(box.north - 39);
  });
});
