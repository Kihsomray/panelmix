import { ENTRY_PAGES, type KnobFocus, type Modal, type Model, type Page } from './model';

/*
 * Page navigation for the GTN: a stack of pages over Home (Back pops it, the
 * HOME key empties it), one pop-up menu at a time, the knob focus that a push
 * of the dual knob cycles (page navigation, COM standby, NAV standby) and the
 * locater bar of page shortcuts that the large knob steps through.
 */

export interface NavState {
  /** stack[0] is always Home; the last page is the one on screen. */
  readonly stack: readonly Page[];
  readonly modal: Modal | null;
  readonly focus: KnobFocus;
}

export type NavAction =
  | { readonly type: 'home' }
  /** HOME held: the moving map on the 750Xi, Default Navigation on the 650Xi. */
  | { readonly type: 'homeHold' }
  | { readonly type: 'open'; readonly page: Page }
  /** Opens a page straight from Home, e.g. a page shortcut. */
  | { readonly type: 'goto'; readonly page: Page }
  /** Replaces the page on screen with an updated copy of itself (tabs, cursors, entries). */
  | { readonly type: 'update'; readonly page: Page }
  | { readonly type: 'back' }
  | { readonly type: 'modal'; readonly modal: Modal | null }
  | { readonly type: 'knobPush' }
  | { readonly type: 'focus'; readonly focus: KnobFocus }
  /** Large knob in page navigation: moves along the locater bar and opens that page. */
  | { readonly type: 'shortcut'; readonly steps: number };

export const HOME: Page = { kind: 'home', pane: 0 };

export function initialNav(): NavState {
  return { stack: [HOME], modal: null, focus: 'page' };
}

export function topPage(s: NavState): Page {
  return s.stack[s.stack.length - 1] ?? HOME;
}

// Page shortcuts -------------------------------------------------------------

export type ShortcutId = 'nav' | 'map' | 'fpl' | 'apt' | 'vor' | 'trfc' | 'terr' | 'nrst';

/**
 * Locater bar slots. Slot 1 is fixed (Map on the 750Xi, Default Navigation on
 * the 650Xi) and the last is always Nearest Airport; the ones between are the
 * pilot-customisable slots, here set to pages the trainer has data for.
 */
export const SHORTCUTS: Record<Model, readonly ShortcutId[]> = {
  '650': ['nav', 'map', 'fpl', 'terr', 'trfc', 'apt', 'vor', 'nrst'],
  '750': ['map', 'fpl', 'terr', 'trfc', 'apt', 'vor', 'nrst'],
};

export const SHORTCUT_LABEL: Record<ShortcutId, string> = {
  nav: 'NAV',
  map: 'MAP',
  fpl: 'FPL',
  apt: 'APT',
  vor: 'VOR',
  trfc: 'TRFC',
  terr: 'TERR',
  nrst: 'NRST',
};

function shortcutPage(id: ShortcutId): Page {
  switch (id) {
    case 'nav':
      return { kind: 'defaultNav' };
    case 'map':
      return { kind: 'map' };
    case 'fpl':
      return { kind: 'flightPlan', cursor: null };
    case 'apt':
      return { kind: 'wpt', category: 'airport', waypoint: null, tab: 'info', runway: 0 };
    case 'vor':
      return { kind: 'wpt', category: 'vor', waypoint: null, tab: 'info', runway: 0 };
    case 'trfc':
      return { kind: 'app', app: 'traffic' };
    case 'terr':
      return { kind: 'app', app: 'terrain' };
    case 'nrst':
      return { kind: 'nearestList', category: 'airport', cursor: null };
  }
}

/** The locater slot showing this page, if any. */
export function shortcutOf(page: Page): ShortcutId | null {
  switch (page.kind) {
    case 'defaultNav':
      return 'nav';
    case 'map':
      return 'map';
    case 'flightPlan':
      return 'fpl';
    case 'wpt':
      return page.category === 'airport' ? 'apt' : page.category === 'vor' ? 'vor' : null;
    case 'app':
      return page.app === 'traffic' ? 'trfc' : page.app === 'terrain' ? 'terr' : null;
    case 'nearestList':
      return page.category === 'airport' ? 'nrst' : null;
    default:
      return null;
  }
}

/** The slot the large knob lands on from `page`, `steps` detents away. */
export function nextShortcut(model: Model, page: Page, steps: number): ShortcutId {
  const slots = SHORTCUTS[model];
  const here = shortcutOf(page);
  const i = here ? slots.indexOf(here) : -1;
  // Off the bar (Home, a menu page), the first detent picks the first or last slot.
  const start = i < 0 ? (steps > 0 ? -1 : slots.length) : i;
  const j = Math.min(Math.max(start + steps, 0), slots.length - 1);
  return slots[j]!;
}

// Reducer ----------------------------------------------------------------------

const FOCUS_CYCLE: Record<KnobFocus, KnobFocus> = { page: 'com', com: 'nav', nav: 'page' };

/** Data-entry pages take the knob over; it comes back to page navigation. */
const withPage = (s: NavState, stack: readonly Page[]): NavState => {
  const top = stack[stack.length - 1] ?? HOME;
  return { ...s, stack, modal: null, focus: ENTRY_PAGES.has(top.kind) ? 'page' : s.focus };
};

export function navReducer(model: Model, s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case 'home':
      return { ...s, stack: [HOME], modal: null };
    case 'homeHold':
      return withPage(s, [HOME, model === '750' ? { kind: 'map' } : { kind: 'defaultNav' }]);
    case 'open': {
      // Re-opening the page already on screen replaces it instead of stacking a copy.
      const top = topPage(s);
      const base = top.kind === a.page.kind && top.kind !== 'home' ? s.stack.slice(0, -1) : s.stack;
      return withPage(s, [...base, a.page]);
    }
    case 'goto':
      return withPage(s, a.page.kind === 'home' ? [HOME] : [HOME, a.page]);
    case 'update': {
      const top = topPage(s);
      if (top.kind !== a.page.kind) return s;
      return { ...s, stack: [...s.stack.slice(0, -1), a.page] };
    }
    case 'back':
      if (s.modal) return { ...s, modal: null };
      return s.stack.length > 1 ? withPage(s, s.stack.slice(0, -1)) : s;
    case 'modal':
      return { ...s, modal: a.modal };
    case 'knobPush':
      return { ...s, focus: FOCUS_CYCLE[s.focus] };
    case 'focus':
      return s.focus === a.focus ? s : { ...s, focus: a.focus };
    case 'shortcut': {
      if (a.steps === 0) return s;
      const id = nextShortcut(model, topPage(s), a.steps);
      if (shortcutOf(topPage(s)) === id) return s;
      return withPage(s, [HOME, shortcutPage(id)]);
    }
  }
}
