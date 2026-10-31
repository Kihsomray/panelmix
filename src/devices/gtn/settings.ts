import type { Waypoint } from '../../core/navdb';
import { stepRange } from '../../ui/map/paintMap';
import type { FieldId } from './fields';
import type { RadioBand } from './keypad';
import type { Model } from './model';

/*
 * The pilot's choices that outlive a page visit: map range, orientation and
 * user fields, the Default Navigation fields, radio volume and squelch, and
 * the recent frequency and waypoint lists the Find tabs show.
 */

export type MapOrientation = 'north' | 'track' | 'heading';

/** Pages with user fields: the map, and the 650Xi Default Navigation page. */
export type FieldPage = 'map' | 'nav';

export interface Settings {
  /** Radius of the map range ring, nm. */
  readonly rangeNm: number;
  readonly orientation: MapOrientation;
  /** Map corner fields: top left, top right, bottom left, bottom right. */
  readonly mapFields: readonly FieldId[];
  /** Map detail: 0 shows everything, 3 hides the most. */
  readonly detail: number;
  /** The page whose user fields show as keys while the pilot picks new data types. */
  readonly editingFields: FieldPage | null;
  /** Default Navigation page fields (GTN 650Xi), top row then bottom row. */
  readonly navFields: readonly FieldId[];
  readonly volume: Readonly<Record<RadioBand, number>>;
  /** COM automatic squelch overridden ("SQ"). */
  readonly squelchOpen: boolean;
  /** COM monitor mode: listen to standby while watching active ("MON"). */
  readonly monitor: boolean;
  /** Most recent first. */
  readonly recentFreqs: Readonly<Record<RadioBand, readonly number[]>>;
  readonly recentWaypoints: readonly Waypoint[];
  /** A waypoint picked by tapping the map (Direct-To pre-fills it). */
  readonly mapSelection: Waypoint | null;
}

export type SettingsAction =
  | { readonly type: 'zoom'; readonly steps: number }
  | { readonly type: 'orientation'; readonly orientation: MapOrientation }
  | { readonly type: 'detail' }
  | { readonly type: 'editFields'; readonly page: FieldPage | null }
  | { readonly type: 'mapField'; readonly index: number; readonly field: FieldId }
  | { readonly type: 'navField'; readonly index: number; readonly field: FieldId }
  | { readonly type: 'restoreMapFields' }
  | { readonly type: 'restoreNavFields' }
  | { readonly type: 'volume'; readonly band: RadioBand; readonly steps: number }
  | { readonly type: 'squelch' }
  | { readonly type: 'monitor' }
  | { readonly type: 'recentFreq'; readonly band: RadioBand; readonly khz: number }
  | { readonly type: 'recentWaypoint'; readonly waypoint: Waypoint }
  | { readonly type: 'mapSelect'; readonly waypoint: Waypoint | null };

const DEFAULT_MAP_FIELDS: readonly FieldId[] = ['DTK', 'TRK', 'GS', 'DIS'];
const DEFAULT_NAV_FIELDS: readonly FieldId[] = ['DIS', 'DTK', 'BRG', 'GS', 'TRK', 'ACTV WPT'];

/** Garmin map ranges the GTN offers, nm (range ring radius). */
export const GTN_RANGES = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300] as const;

const RECENT_FREQS = 20;
const RECENT_WAYPOINTS = 20;
const VOLUME_STEP = 5;

export function initialSettings(model: Model): Settings {
  return {
    rangeNm: model === '750' ? 5 : 3,
    orientation: 'track',
    mapFields: DEFAULT_MAP_FIELDS,
    detail: 0,
    editingFields: null,
    navFields: DEFAULT_NAV_FIELDS,
    volume: { com: 60, nav: 50 },
    squelchOpen: false,
    monitor: false,
    recentFreqs: { com: [], nav: [] },
    recentWaypoints: [],
    mapSelection: null,
  };
}

const replaceAt = <T>(list: readonly T[], index: number, value: T): readonly T[] =>
  index < 0 || index >= list.length ? list : list.map((v, i) => (i === index ? value : v));

export function settingsReducer(s: Settings, a: SettingsAction): Settings {
  switch (a.type) {
    case 'zoom':
      return { ...s, rangeNm: stepRange(s.rangeNm, a.steps, GTN_RANGES) };
    case 'orientation':
      return { ...s, orientation: a.orientation };
    case 'detail':
      return { ...s, detail: (s.detail + 1) % 4 };
    case 'editFields':
      return s.editingFields === a.page ? s : { ...s, editingFields: a.page };
    case 'mapField':
      return { ...s, mapFields: replaceAt(s.mapFields, a.index, a.field) };
    case 'navField':
      return { ...s, navFields: replaceAt(s.navFields, a.index, a.field) };
    case 'restoreMapFields':
      return { ...s, mapFields: DEFAULT_MAP_FIELDS };
    case 'restoreNavFields':
      return { ...s, navFields: DEFAULT_NAV_FIELDS };
    case 'volume': {
      const v = Math.min(Math.max(s.volume[a.band] + a.steps * VOLUME_STEP, 0), 100);
      return { ...s, volume: { ...s.volume, [a.band]: v } };
    }
    case 'squelch':
      return { ...s, squelchOpen: !s.squelchOpen };
    case 'monitor':
      return { ...s, monitor: !s.monitor };
    case 'recentFreq': {
      const list = [a.khz, ...s.recentFreqs[a.band].filter((k) => k !== a.khz)].slice(0, RECENT_FREQS);
      return { ...s, recentFreqs: { ...s.recentFreqs, [a.band]: list } };
    }
    case 'recentWaypoint': {
      const w = a.waypoint;
      const rest = s.recentWaypoints.filter((r) => !(r.ident === w.ident && r.kind === w.kind));
      return { ...s, recentWaypoints: [w, ...rest].slice(0, RECENT_WAYPOINTS) };
    }
    case 'mapSelect':
      return { ...s, mapSelection: a.waypoint };
  }
}
