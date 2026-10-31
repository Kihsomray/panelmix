import type { FnPage, GnsUi, Group, Model, PageId } from './types';

/*
 * The page structure of the 400W/500W series (Pilot's Guides 190-00356-00
 * and 190-00357-00, "Page Groups"). The large right knob steps through the
 * groups, the small right knob through the pages of a group. The 530W has no
 * Position page (its satellite page shows the position) and a VNAV key
 * instead of a VNAV page in the NAV group.
 */

const GROUPS: readonly Group[] = ['NAV', 'WPT', 'AUX', 'NRST'];

const WPT_PAGES: readonly PageId[] = ['wpt.apt', 'wpt.rwy', 'wpt.freq', 'wpt.apr', 'wpt.arvl', 'wpt.dep', 'wpt.int', 'wpt.ndb', 'wpt.vor', 'wpt.usr'];
const AUX_PAGES: readonly PageId[] = ['aux.fplan', 'aux.util', 'aux.setup1', 'aux.setup2'];
const NRST_PAGES: readonly PageId[] = ['nrst.apt', 'nrst.int', 'nrst.ndb', 'nrst.vor', 'nrst.usr', 'nrst.artcc', 'nrst.fss', 'nrst.asp'];

export const PAGES: Readonly<Record<Model, Readonly<Record<Group, readonly PageId[]>>>> = {
  '430': {
    NAV: ['nav.default', 'nav.map', 'nav.terrain', 'nav.navcom', 'nav.position', 'nav.satellite', 'nav.vnav'],
    WPT: WPT_PAGES,
    AUX: AUX_PAGES,
    NRST: NRST_PAGES,
  },
  '530': {
    NAV: ['nav.default', 'nav.map', 'nav.terrain', 'nav.navcom', 'nav.satellite'],
    WPT: WPT_PAGES,
    AUX: AUX_PAGES,
    NRST: NRST_PAGES,
  },
};

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** The page on screen. */
export function currentPage(ui: GnsUi): PageId {
  switch (ui.fn) {
    case 'fpl':
      return ui.fplPage === 0 ? 'fpl.active' : 'fpl.catalog';
    case 'proc':
    case 'dto':
    case 'msg':
    case 'vnav':
      return ui.fn;
    case null:
      return PAGES[ui.model][ui.group][ui.pages[ui.group]] ?? 'nav.default';
  }
}

/** Large right knob without the cursor: next or previous page group. */
export function stepGroup(ui: GnsUi, steps: number): GnsUi {
  const i = GROUPS.indexOf(ui.group);
  const group = GROUPS[wrap(i + Math.sign(steps) * Math.min(Math.abs(steps), GROUPS.length), GROUPS.length)]!;
  return { ...ui, group, fn: null, cursor: null, scroll: 0, wptReturn: null };
}

/** Small right knob without the cursor: next or previous page in the group. */
export function stepPage(ui: GnsUi, steps: number): GnsUi {
  if (ui.fn === 'fpl') return { ...ui, fplPage: wrap(ui.fplPage + steps, 2) as 0 | 1, cursor: null, scroll: 0 };
  if (ui.fn !== null) return ui;
  const n = PAGES[ui.model][ui.group].length;
  return { ...ui, pages: { ...ui.pages, [ui.group]: wrap(ui.pages[ui.group] + steps, n) }, cursor: null, scroll: 0 };
}

/** The page-group indicator in the lower right corner: a name and a row of squares. */
export function pageIndicator(ui: GnsUi): { name: string; count: number; index: number } {
  const fnNames: Record<FnPage, string> = { fpl: 'FPL', proc: 'PROC', dto: 'DRCT', msg: 'MSG', vnav: 'VNAV' };
  if (ui.fn === 'fpl') return { name: 'FPL', count: 2, index: ui.fplPage };
  if (ui.fn !== null) return { name: fnNames[ui.fn], count: 1, index: 0 };
  return { name: ui.group, count: PAGES[ui.model][ui.group].length, index: ui.pages[ui.group] };
}

/**
 * Map scales, the top-to-bottom distance of the map (Section 2, "Map Range":
 * 500 ft to 2000 nm). The last eleven match the steps seen in the guide.
 */
export const MAP_RANGES_NM: readonly number[] = [
  500 / 6076, 800 / 6076, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3.5, 5, 7.5, 10, 15, 20, 35, 50, 100, 200, 350, 500, 1000, 2000,
];

/** The 530W default NAV page look-ahead map: nine scales from 5 to 200 nm. */
export const NAV_MAP_RANGES_NM: readonly number[] = [5, 7.5, 10, 15, 20, 35, 50, 100, 200];

export function formatMapRange(nm: number): { value: string; unit: 'ft' | 'nm' } {
  if (nm < 0.15) return { value: String(Math.round((nm * 6076) / 100) * 100), unit: 'ft' };
  return { value: nm < 10 && !Number.isInteger(nm) ? String(nm) : String(Math.round(nm)), unit: 'nm' };
}
