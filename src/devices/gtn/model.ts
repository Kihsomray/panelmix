import type { Waypoint } from '../../core/navdb';
import type { IdentEntry } from '../../ui/identEntry';
import type { CourseEntry } from './course';
import type { FreqEntry, RadioBand } from './keypad';
import type { SquawkEntry } from './squawk';

/*
 * The GTN's own screen state: which page is open (a stack, so Back works),
 * what the dual knob controls, and the pop-up menus. The flight plan, radios
 * and transponder live in the shared simulator, never here.
 */

export type Model = '650' | '750';

/** What the dual concentric knob drives outside data entry: pages, or a standby frequency. */
export type KnobFocus = 'page' | 'com' | 'nav';

/** Home screen apps that need equipment or data the trainer does not simulate. */
export type AppId =
  | 'traffic'
  | 'terrain'
  | 'weather'
  | 'charts'
  | 'proc'
  | 'services'
  | 'utilities'
  | 'system'
  | 'audio'
  | 'intersection'
  | 'vrp'
  | 'user'
  | 'airspace'
  | 'artcc'
  | 'fss'
  | 'wxfreq';

export type WaypointCategory = 'airport' | 'vor' | 'ndb';
export type WptTab = 'info' | 'proc' | 'runways' | 'freqs' | 'wx' | 'notams';
export type DirectTab = 'waypoint' | 'fpl' | 'nrst';
export type FindTab = 'nearest' | 'recent' | 'fpl' | 'user';
export type WptFindTab = 'recent' | 'nearest' | 'fpl' | 'user';

/** A Direct-To destination; `planIndex` when it is a waypoint of the active flight plan. */
export interface DirectTarget {
  readonly waypoint: Waypoint;
  readonly planIndex: number | null;
}

/** Where the waypoint keyboard sends the identifier when Enter is pressed. */
export type KeyboardPurpose =
  | { readonly kind: 'directTo' }
  | { readonly kind: 'fplInsert'; readonly index: number }
  | { readonly kind: 'wptInfo'; readonly category: WaypointCategory };

export type Page =
  | { readonly kind: 'home'; readonly pane: number }
  | { readonly kind: 'map' }
  | { readonly kind: 'defaultNav' }
  | { readonly kind: 'flightPlan'; readonly cursor: number | null }
  | { readonly kind: 'directTo'; readonly tab: DirectTab; readonly target: DirectTarget | null; readonly knobEntry: IdentEntry | null }
  | { readonly kind: 'nearest' }
  | { readonly kind: 'nearestList'; readonly category: WaypointCategory; readonly cursor: number | null }
  | { readonly kind: 'waypointInfo' }
  | { readonly kind: 'wpt'; readonly category: WaypointCategory; readonly waypoint: Waypoint | null; readonly tab: WptTab; readonly runway: number }
  | { readonly kind: 'xpdr'; readonly entry: SquawkEntry }
  | { readonly kind: 'obsCourse'; readonly entry: CourseEntry }
  | { readonly kind: 'radio'; readonly band: RadioBand; readonly entry: FreqEntry }
  | { readonly kind: 'find'; readonly band: RadioBand; readonly tab: FindTab }
  | { readonly kind: 'keyboard'; readonly purpose: KeyboardPurpose; readonly entry: IdentEntry; readonly keyset: number }
  | { readonly kind: 'wptFind'; readonly purpose: KeyboardPurpose; readonly tab: WptFindTab }
  | { readonly kind: 'messages' }
  | { readonly kind: 'app'; readonly app: AppId };

export type PageKind = Page['kind'];

export type Modal =
  | { readonly kind: 'wptOptions'; readonly index: number }
  | { readonly kind: 'fplMenu' }
  | { readonly kind: 'confirm'; readonly action: 'deleteFpl' | 'removeWpt'; readonly index: number }
  | { readonly kind: 'loadFreq'; readonly band: RadioBand; readonly khz: number; readonly label: string }
  | { readonly kind: 'freqList'; readonly ident: string }
  | { readonly kind: 'mapMenu' }
  | { readonly kind: 'navMenu' }
  | { readonly kind: 'fieldPicker'; readonly where: 'map' | 'nav'; readonly index: number };

/** Pages where the knob edits data (its push is Enter / Activate), whatever the radio focus was. */
export const ENTRY_PAGES: ReadonlySet<PageKind> = new Set(['xpdr', 'radio', 'keyboard', 'directTo', 'obsCourse']);
