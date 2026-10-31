/*
 * MFD page groups and pages (Pilot's Guide 1.7, Figures 1-22 to 1-27). With
 * no cursor on the page, the first click of the FMS knob opens the page
 * selection window; then the large knob steps through the groups and the
 * small knob through the pages of the group. Each group remembers the page
 * last shown. The FPL and PROC keys jump to their pages and a second
 * press goes back to where the pilot was. Holding CLR shows the
 * Navigation Map. Optional pages for equipment this 172S lacks (Stormscope,
 * weather datalink, satellite radio and phone) are not listed.
 */

export type PageId =
  | 'navMap'
  | 'trafficMap'
  | 'terrain'
  | 'airportInfo'
  | 'intersectionInfo'
  | 'ndbInfo'
  | 'vorInfo'
  | 'userWptInfo'
  | 'tripPlanning'
  | 'gpsStatus'
  | 'systemStatus'
  | 'activeFpl'
  | 'fplCatalog'
  | 'checklist'
  | 'nrstAirports'
  | 'nrstIntersections'
  | 'nrstNdb'
  | 'nrstVor'
  | 'nrstUser'
  | 'nrstFreq'
  | 'nrstAirspaces'
  | 'procedures';

export interface PageGroup {
  readonly id: string;
  /** Tab label at the bottom right. */
  readonly tab: string;
  readonly pages: readonly { readonly id: PageId; readonly title: string }[];
}

export const PAGE_GROUPS: readonly PageGroup[] = [
  {
    id: 'MAP',
    tab: 'MAP',
    pages: [
      { id: 'navMap', title: 'NAVIGATION MAP' },
      { id: 'trafficMap', title: 'TRAFFIC MAP' },
      { id: 'terrain', title: 'TERRAIN PROXIMITY' },
    ],
  },
  {
    id: 'WPT',
    tab: 'WPT',
    pages: [
      { id: 'airportInfo', title: 'AIRPORT INFORMATION' },
      { id: 'intersectionInfo', title: 'INTERSECTION INFORMATION' },
      { id: 'ndbInfo', title: 'NDB INFORMATION' },
      { id: 'vorInfo', title: 'VOR INFORMATION' },
      { id: 'userWptInfo', title: 'USER WPT INFORMATION' },
    ],
  },
  {
    id: 'AUX',
    tab: 'AUX',
    pages: [
      { id: 'tripPlanning', title: 'TRIP PLANNING' },
      { id: 'gpsStatus', title: 'GPS STATUS' },
      { id: 'systemStatus', title: 'SYSTEM STATUS' },
    ],
  },
  {
    id: 'FPL',
    tab: 'FPL',
    pages: [
      { id: 'activeFpl', title: 'ACTIVE FLIGHT PLAN' },
      { id: 'fplCatalog', title: 'FLIGHT PLAN CATALOG' },
    ],
  },
  { id: 'CHKLIST', tab: '✓LST', pages: [{ id: 'checklist', title: 'CHECKLIST' }] },
  {
    id: 'NRST',
    tab: 'NRST',
    pages: [
      { id: 'nrstAirports', title: 'NEAREST AIRPORTS' },
      { id: 'nrstIntersections', title: 'NEAREST INTERSECTIONS' },
      { id: 'nrstNdb', title: 'NEAREST NDB' },
      { id: 'nrstVor', title: 'NEAREST VOR' },
      { id: 'nrstUser', title: 'NEAREST USER WAYPOINTS' },
      { id: 'nrstFreq', title: 'NEAREST FREQUENCIES' },
      { id: 'nrstAirspaces', title: 'NEAREST AIRSPACES' },
    ],
  },
];

/** The procedures page is reached with the PROC key only, not through the groups. */
const PROC_PAGE = { group: 'PROC', title: 'PROCEDURES' } as const;

export interface PageRef {
  readonly group: number;
  readonly page: number;
}

export interface MfdPages {
  readonly current: PageRef;
  /** Page last shown in each group. */
  readonly last: readonly number[];
  /** PROC page shown over the current page. */
  readonly proc: boolean;
  /** Where FPL or PROC was pressed from, for the second press. */
  readonly back: PageRef | null;
  /** The page selection window stays up until this time (ms). */
  readonly pickerUntil: number;
}

export const PICKER_MS = 3000;

export const MFD_PAGES_START: MfdPages = {
  current: { group: 0, page: 0 },
  last: PAGE_GROUPS.map(() => 0),
  proc: false,
  back: null,
  pickerUntil: 0,
};

export function pageId(p: MfdPages): PageId {
  if (p.proc) return 'procedures';
  return PAGE_GROUPS[p.current.group]?.pages[p.current.page]?.id ?? 'navMap';
}

export function pageTitle(p: MfdPages): string {
  if (p.proc) return `PROC - ${PROC_PAGE.title}`;
  const g = PAGE_GROUPS[p.current.group]!;
  return `${g.id === 'CHKLIST' ? 'CHKLIST' : g.id} - ${g.pages[p.current.page]?.title ?? ''}`;
}

const show = (p: MfdPages, current: PageRef, now: number): MfdPages => {
  const last = [...p.last];
  last[current.group] = current.page;
  return { ...p, current, last, proc: false, pickerUntil: now + PICKER_MS };
};

/** The first click of either FMS knob only opens the page selection window (Pilot's Guide 1.7). */
const openPicker = (p: MfdPages, now: number): MfdPages => ({ ...p, pickerUntil: now + PICKER_MS });

/** Large FMS knob: the next or previous group, on the page last used there. Stops at the ends. */
export function selectGroup(p: MfdPages, steps: number, now: number): MfdPages {
  if (!pickerVisible(p, now)) return openPicker(p, now);
  const group = Math.min(Math.max(p.current.group + steps, 0), PAGE_GROUPS.length - 1);
  return show({ ...p, back: null }, { group, page: p.last[group] ?? 0 }, now);
}

/** Small FMS knob: the next or previous page in the group. */
export function selectPage(p: MfdPages, steps: number, now: number): MfdPages {
  if (!pickerVisible(p, now)) return openPicker(p, now);
  const count = PAGE_GROUPS[p.current.group]!.pages.length;
  const page = Math.min(Math.max(p.current.page + steps, 0), count - 1);
  return show({ ...p, back: null }, { group: p.current.group, page }, now);
}

export function findPage(id: PageId): PageRef | null {
  for (let group = 0; group < PAGE_GROUPS.length; group++) {
    const page = PAGE_GROUPS[group]!.pages.findIndex((x) => x.id === id);
    if (page >= 0) return { group, page };
  }
  return null;
}

/** Shows a page directly (softkeys, CLR held); the picker is not shown. */
export function goTo(p: MfdPages, id: PageId): MfdPages {
  const ref = findPage(id);
  if (!ref) return p;
  return { ...show(p, ref, 0), back: null, pickerUntil: 0 };
}

/** FPL key: the Active Flight Plan page, or back to the previous page on a second press. */
export function fplKey(p: MfdPages): MfdPages {
  if (!p.proc && pageId(p) === 'activeFpl' && p.back) return { ...goToRef(p, p.back), back: null };
  const back = p.proc ? p.back : p.current;
  return { ...goTo(p, 'activeFpl'), back };
}

/** PROC key: the procedures page over the current one, or back on a second press. */
export function procKey(p: MfdPages): MfdPages {
  if (p.proc) return { ...p, proc: false };
  return { ...p, proc: true, pickerUntil: 0 };
}

function goToRef(p: MfdPages, ref: PageRef): MfdPages {
  return { ...show(p, ref, 0), pickerUntil: 0 };
}

export function pickerVisible(p: MfdPages, now: number): boolean {
  return now < p.pickerUntil;
}
