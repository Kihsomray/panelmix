import { NavDatabase, type Waypoint } from '../../core/navdb';
import type { Gtn } from './context';
import { startFreqEntry, type RadioBand } from './keypad';
import { ranged } from './lookups';
import type { DirectTarget, Page, WaypointCategory } from './model';
import { topPage } from './navigation';

/*
 * Workflows that touch both the shared simulator and the GTN's own screen:
 * tuning, Direct-To, opening waypoint pages. Kept here so the bezel keys,
 * the knob and the touch keys all do exactly the same thing.
 */

const EMERGENCY_KHZ = 121500;

export function swapRadio(g: Gtn, band: RadioBand): void {
  g.dispatch({ type: band === 'com' ? 'com.swap' : 'nav.swap', radio: 0 });
}

export function setStandby(g: Gtn, band: RadioBand, khz: number): void {
  g.dispatch({ type: band === 'com' ? 'com.setStandby' : 'nav.setStandby', radio: 0, khz });
  g.set({ type: 'recentFreq', band, khz });
}

export function setActive(g: Gtn, band: RadioBand, khz: number): void {
  g.dispatch({ type: band === 'com' ? 'com.setActive' : 'nav.setActive', radio: 0, khz });
  g.set({ type: 'recentFreq', band, khz });
}

export function standbyOf(g: Gtn, band: RadioBand): number {
  return band === 'com' ? g.state.radios.com[0].standbyKhz : g.state.radios.nav[0].standbyKhz;
}

export function activeOf(g: Gtn, band: RadioBand): number {
  return band === 'com' ? g.state.radios.com[0].activeKhz : g.state.radios.nav[0].activeKhz;
}

/** Holding the volume knob: 121.50 becomes the active COM, the old active goes to standby. */
export function tuneEmergency(g: Gtn): void {
  if (activeOf(g, 'com') === EMERGENCY_KHZ) return;
  setStandby(g, 'com', EMERGENCY_KHZ);
  swapRadio(g, 'com');
}

export function openRadioPanel(g: Gtn, band: RadioBand): void {
  g.go({ type: 'open', page: { kind: 'radio', band, entry: startFreqEntry(standbyOf(g, band)) } });
}

// Direct-To ----------------------------------------------------------------------

/** A waypoint as a Direct-To target, linked to the flight plan when it is in it. */
export function targetFor(g: Gtn, waypoint: Waypoint, planIndex: number | null = null): DirectTarget {
  if (planIndex !== null) return { waypoint, planIndex };
  const plan = g.state.fms.plan;
  const from = g.state.fms.activeLeg?.planIndex ?? 0;
  const same = (w: Waypoint) => w.ident === waypoint.ident && w.kind === waypoint.kind;
  // Prefer the occurrence still ahead of the airplane.
  let index = plan.findIndex((w, i) => i >= from && same(w));
  if (index < 0) index = plan.findIndex(same);
  return { waypoint: NavDatabase.toWaypoint(waypoint), planIndex: index < 0 ? null : index };
}

/** The waypoint the pilot has selected on the page on screen, which Direct-To pre-fills. */
function selectedTarget(g: Gtn, page: Page): DirectTarget | null {
  const pos = g.state.aircraft;
  switch (page.kind) {
    case 'flightPlan': {
      const w = page.cursor !== null ? g.state.fms.plan[page.cursor] : undefined;
      return w ? targetFor(g, w, page.cursor) : null;
    }
    case 'nearestList': {
      if (page.cursor === null) return null;
      const list: readonly Waypoint[] = page.category === 'airport' ? g.lists.airports : page.category === 'vor' ? g.lists.vors : g.lists.ndbs;
      const hit = ranged(list, pos)[page.cursor];
      return hit ? targetFor(g, hit.item) : null;
    }
    case 'wpt': {
      const w = page.waypoint ?? defaultWaypoint(g, page.category);
      return w ? targetFor(g, w) : null;
    }
    case 'map':
    case 'defaultNav':
      return g.settings.mapSelection ? targetFor(g, g.settings.mapSelection) : null;
    default:
      return null;
  }
}

/**
 * The Direct-To key: opens the Direct-To window pre-filled, or closes it when it
 * is already open, along with anything opened from it (its keyboard, Find).
 */
export function pressDirectTo(g: Gtn): void {
  const stack = g.nav.stack;
  const open = stack.map((p) => p.kind).lastIndexOf('directTo');
  if (open > 0) {
    g.go({ type: 'modal', modal: null });
    for (let i = open; i < stack.length; i++) g.go({ type: 'back' });
    return;
  }
  const page = topPage(g.nav);
  const leg = g.state.fms.activeLeg;
  const target = selectedTarget(g, page) ?? (leg ? { waypoint: leg.to, planIndex: leg.planIndex } : null);
  g.go({ type: 'open', page: { kind: 'directTo', tab: 'waypoint', target, knobEntry: null } });
}

export function activateDirectTo(g: Gtn, target: DirectTarget): void {
  g.dispatch({ type: 'fms.directTo', waypoint: target.waypoint, planIndex: target.planIndex });
  g.set({ type: 'recentWaypoint', waypoint: target.waypoint });
  g.set({ type: 'mapSelect', waypoint: null });
  // The real unit closes the window and shows the new leg on the map.
  g.go({ type: 'goto', page: { kind: 'map' } });
}

// Waypoint information -------------------------------------------------------------

/** The waypoint an information page shows when none was picked: the last one viewed, else the nearest. */
export function defaultWaypoint(g: Gtn, category: WaypointCategory): Waypoint | null {
  const recent = g.settings.recentWaypoints.find((w) => w.kind === category);
  if (recent) return recent;
  const list = category === 'airport' ? g.lists.airports : category === 'vor' ? g.lists.vors : g.lists.ndbs;
  return list[0] ?? null;
}

function categoryOf(w: Waypoint): WaypointCategory | null {
  return w.kind === 'airport' || w.kind === 'vor' || w.kind === 'ndb' ? w.kind : null;
}

export function openWaypointInfo(g: Gtn, w: Waypoint): void {
  const category = categoryOf(w);
  if (!category) return;
  g.set({ type: 'recentWaypoint', waypoint: NavDatabase.toWaypoint(w) });
  g.go({ type: 'open', page: { kind: 'wpt', category, waypoint: NavDatabase.toWaypoint(w), tab: 'info', runway: 0 } });
}
