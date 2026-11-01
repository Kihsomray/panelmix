import type { LatLon } from '../../../core/geo';
import type { MagneticModel } from '../../../core/magvar';
import type { Airport, Fix, Navaid, NavDatabase, Waypoint } from '../../../core/navdb';
import type { ProcedureSource } from '../../../core/procedures';
import type { SimCommand } from '../../../sim/commands';
import type { CdiSource, SimState } from '../../../sim/types';
import type { IdentEntry } from '../../../ui/identEntry';

/*
 * Screen state of a GNS 430W / 530W: which page is up, where the cursor is,
 * open windows and knob entry. Navigation and radio data live in the shared
 * simulator; this is only what the unit itself remembers.
 */

export type Model = '430' | '530';

/** The four main page groups, in large-knob order. */
export type Group = 'NAV' | 'WPT' | 'AUX' | 'NRST';

/** Pages reached with a function key instead of the right knobs. */
export type FnPage = 'fpl' | 'proc' | 'dto' | 'msg' | 'vnav';

export type PageId =
  | 'nav.default'
  | 'nav.map'
  | 'nav.terrain'
  | 'nav.navcom'
  | 'nav.position'
  | 'nav.satellite'
  | 'nav.vnav'
  | 'wpt.apt'
  | 'wpt.rwy'
  | 'wpt.freq'
  | 'wpt.apr'
  | 'wpt.arvl'
  | 'wpt.dep'
  | 'wpt.int'
  | 'wpt.ndb'
  | 'wpt.vor'
  | 'wpt.usr'
  | 'aux.fplan'
  | 'aux.util'
  | 'aux.setup1'
  | 'aux.setup2'
  | 'nrst.apt'
  | 'nrst.int'
  | 'nrst.ndb'
  | 'nrst.vor'
  | 'nrst.usr'
  | 'nrst.artcc'
  | 'nrst.fss'
  | 'nrst.asp'
  | 'fpl.active'
  | 'fpl.catalog'
  | 'proc'
  | 'dto'
  | 'msg'
  | 'vnav';

export type GnsKey =
  | 'CDI'
  | 'OBS'
  | 'MSG'
  | 'FPL'
  | 'VNAV'
  | 'PROC'
  | 'DTO'
  | 'MENU'
  | 'CLR'
  | 'ENT'
  | 'RNG_IN'
  | 'RNG_OUT'
  | 'COM_FLIP'
  | 'VLOC_FLIP';

/** Everything the pilot can do to the bezel. Knob steps are clockwise-positive detents. */
export type GnsInput =
  | { readonly kind: 'key'; readonly key: GnsKey }
  /** CLR held: default NAV page. COM flip-flop held two seconds: 121.5 active. */
  | { readonly kind: 'hold'; readonly key: 'CLR' | 'COM_FLIP' }
  | { readonly kind: 'right'; readonly ring: 'outer' | 'inner'; readonly steps: number }
  | { readonly kind: 'rightPush' }
  | { readonly kind: 'left'; readonly ring: 'outer' | 'inner'; readonly steps: number }
  | { readonly kind: 'leftPush' }
  | { readonly kind: 'volume'; readonly knob: 'com' | 'vloc'; readonly steps: number }
  | { readonly kind: 'volumePush'; readonly knob: 'com' | 'vloc' };

export interface RadioUi {
  /** Which standby frequency the left knobs tune (the tuning cursor). */
  readonly tuning: 'COM' | 'VLOC';
  /** Wall-clock seconds of the last VLOC tuning action; the cursor goes home after 30 s. */
  readonly tunedAt: number;
  /** Automatic squelch overridden (COM knob pushed): the receiver opens, "RX" shows. */
  readonly squelchOff: boolean;
  /** 0 to 100. The trainer has no audio, so the level is shown briefly instead. */
  readonly comVolume: number;
  readonly vlocVolume: number;
  readonly volumeShown: { readonly knob: 'com' | 'vloc'; readonly at: number } | null;
}

/** Actions behind page-menu items and confirmation windows. */
export type MenuAction =
  | 'fpl.activateLeg'
  | 'fpl.invert'
  | 'fpl.delete'
  | 'fpl.removeApproach'
  | 'proc.selectApproach'
  | 'proc.selectArrival'
  | 'proc.selectDeparture'
  | 'proc.loadIntoFpl'
  | 'proc.loadAndActivate'
  | 'proc.destination'
  | 'dto.cancel'
  | 'map.fields'
  | 'map.restore'
  | 'nav.restore'
  | 'vnav.restore'
  | 'terrain.inhibit'
  | 'terrain.view'
  | 'terrain.aviation'
  | 'none';

export interface MenuItem {
  readonly label: string;
  readonly action: MenuAction;
  readonly enabled: boolean;
}

export type ListPurpose = 'dto.fpl' | 'dto.nrst' | 'navcom.airport';

/** The procedure fields of the WPT approach, arrival and departure pages, each with its pop-up window. */
export type ProcField = 'approach' | 'transition' | 'arrival' | 'arrivalTrans' | 'arrivalRunway' | 'departure' | 'departureRunway' | 'departureTrans';

export interface ChoiceOption {
  /** What is stored when chosen; null is "VECTORS" (transition) or "ALL" (runway). */
  readonly value: string | null;
  readonly label: string;
  /** Magenta waypoint designator after the name ("IA"). */
  readonly tag?: string;
  /** Small "GPS" designation after approaches approved for GPS. */
  readonly gps?: boolean;
}

/** A request to load an approach, kept while a confirmation window is up. */
export interface ApproachLoad {
  readonly airport: Waypoint;
  readonly approachId: string;
  /** Transition name; null for VECTORS. */
  readonly transition: string | null;
  readonly mode: 'load' | 'activate';
}

export type ConfirmAction = 'fpl.delete' | 'fpl.remove' | 'fpl.removeApproach';

export type Popup =
  | { readonly kind: 'menu'; readonly items: readonly MenuItem[]; readonly index: number }
  /** "Yes? or No?" windows. */
  | { readonly kind: 'confirm'; readonly action: ConfirmAction; readonly index: number; readonly yes: boolean }
  /**
   * Procedure windows answered with "Yes? or No?": the GPS-monitoring-only
   * reminder before loading an approach not approved for GPS, and "discontinue
   * the current approach?" before restarting the approach being flown.
   */
  | { readonly kind: 'procConfirm'; readonly reason: 'monitor' | 'restart'; readonly load: ApproachLoad | null; readonly yes: boolean }
  /** The ACTIVATE LEG window ("Fly Leg  A -> B  Activate?"), for a flight plan or an approach leg. */
  | { readonly kind: 'activateLeg'; readonly target: 'plan' | 'approach'; readonly index: number }
  /** A pop-up list chosen with the small knob (D-> FPL and NRST fields). */
  | { readonly kind: 'list'; readonly purpose: ListPurpose; readonly items: readonly Waypoint[]; readonly index: number }
  /** The APR / TRANS / RUNWAY windows of the procedure pages. */
  | { readonly kind: 'choice'; readonly field: ProcField; readonly options: readonly ChoiceOption[]; readonly index: number }
  /** TERRAIN pop-up alert: CLR goes back to the page, ENT shows the TERRAIN page. */
  | { readonly kind: 'terrainAlert'; readonly text: string }
  /** An information window closed with ENT or CLR. */
  | { readonly kind: 'notice'; readonly title: string; readonly lines: readonly string[] };

export type EntryTarget =
  | { readonly kind: 'dto' }
  | { readonly kind: 'fpl'; readonly index: number }
  | { readonly kind: 'wpt'; readonly what: WptKind };

export interface Entry {
  readonly target: EntryTarget;
  readonly e: IdentEntry;
}

export type WptKind = 'airport' | 'vor' | 'ndb' | 'int' | 'usr';

export interface WptSelection {
  /** Waypoint shown on each WPT page family; null shows the default (active or nearest). */
  readonly airport: Waypoint | null;
  readonly vor: Waypoint | null;
  readonly ndb: Waypoint | null;
  readonly int: Waypoint | null;
  readonly runway: number;
}

/**
 * Selections on the WPT approach, arrival and departure pages (for the
 * airport those pages show). `flow` is set when the page was reached with
 * PROC "Select Approach?" (or arrival / departure): "Load?" and "Activate?"
 * appear and the windows open one after the other.
 */
export interface ProcUi {
  readonly flow: 'approach' | 'arrival' | 'departure' | null;
  /** The flow's first window opens once the airport's procedures have loaded ("LOADING..."). */
  readonly waiting: boolean;
  /** Airport the selections below belong to; they reset when another airport is shown. */
  readonly airport: string | null;
  readonly approach: string | null;
  /** Approach transition; null is VECTORS. */
  readonly transition: string | null;
  readonly arrival: string | null;
  readonly arrivalTrans: string | null;
  /** Runway transition; null is ALL (or none). */
  readonly arrivalRunway: string | null;
  readonly departure: string | null;
  readonly departureRunway: string | null;
  readonly departureTrans: string | null;
}

/** The TERRAIN page and the terrain annunciation. */
export interface TerrainUi {
  /** 360 degree view around the airplane, or 120 degrees ahead. */
  readonly view: 360 | 120;
  /** Index into TERRAIN_RANGES_NM. */
  readonly range: number;
  readonly aviation: boolean;
  /** Pilot inhibited alerts ("TER INHB"). */
  readonly inhibited: boolean;
}

/** AUX Setup 1, CDI / Alarms. */
export interface UnitSettings {
  /** ILS CDI selection: switch the external CDI to VLOC by itself when established on an ILS or LOC final. */
  readonly ilsCdi: 'auto' | 'manual';
  readonly arrivalAlarm: boolean;
  /** Arrival alarm circle, nm. */
  readonly arrivalNm: number;
}

/** What a modal page (D->, MSG) returns to. */
export interface Frame {
  readonly fn: FnPage | null;
  readonly cursor: number | null;
  readonly scroll: number;
}

export interface DtoState {
  readonly wp: Waypoint | null;
  /** Position of `wp` in the active flight plan when picked from it. */
  readonly planIndex: number | null;
}

export type AuxSub =
  | 'fuel'
  | 'trip'
  | 'dalt'
  | 'crossfill'
  | 'scheduler'
  | 'checklists'
  | 'timers'
  | 'tripStats'
  | 'raim'
  | 'sun'
  | 'versions'
  | 'airspace'
  | 'cdi'
  | 'units'
  | 'position'
  | 'datetime'
  | 'display'
  | 'nearestApt'
  | 'sbas'
  | 'com';

export interface GenericTimer {
  readonly running: boolean;
  readonly up: boolean;
  /** Seconds shown when stopped, or at `startedAt` when running. */
  readonly base: number;
  /** Sim time when it was started. */
  readonly startedAt: number;
  /** Count-down start value, seconds. */
  readonly preset: number;
}

export type RunwaySurfaceCriteria = 'any' | 'hard' | 'hard-soft';

export interface NearestCriteria {
  readonly surface: RunwaySurfaceCriteria;
  readonly minLengthFt: number;
}

export interface AuxUi {
  /** Item opened from an AUX menu page, or null for the menu itself. */
  readonly sub: AuxSub | null;
  readonly timer: GenericTimer;
  readonly criteria: NearestCriteria;
  /** Trip planning: 0 for the whole plan (CUM), otherwise the leg ending at plan[leg]. */
  readonly tripLeg: number;
}

export interface VnavUi {
  readonly altitudeFt: number;
  /** Target altitude referenced to the waypoint elevation ("Above Wpt") or sea level. */
  readonly aboveWpt: boolean;
  readonly offsetNm: number;
  /** Reach the target this far before (true) or after the active waypoint. */
  readonly before: boolean;
  readonly profileFpm: number;
}

export interface MapUi {
  /** Index into MAP_RANGES_NM. */
  readonly range: number;
  /** 0 to 3, shown as "-1".."-3" after the range. */
  readonly declutter: number;
  /** Data fields along the right side (default on for the 430, off for the 530). */
  readonly fields: boolean;
  /** The panning pointer while the cursor is on the map page. */
  readonly pointer: LatLon | null;
}

export interface GnsUi {
  readonly model: Model;
  readonly group: Group;
  /** Page shown in each group, remembered when switching groups. */
  readonly pages: Readonly<Record<Group, number>>;
  readonly fn: FnPage | null;
  /** 0 active flight plan, 1 catalog. */
  readonly fplPage: 0 | 1;
  /** Index into the current page's cursor stops; null when the cursor is off. */
  readonly cursor: number | null;
  /** First list row shown on scrolling pages. */
  readonly scroll: number;
  readonly popup: Popup | null;
  readonly entry: Entry | null;
  readonly stack: readonly Frame[];
  readonly dto: DtoState;
  readonly wpt: WptSelection;
  /** Set when a WPT page was opened from a list: "Done?" returns there. */
  readonly wptReturn: { readonly group: Group; readonly page: number; readonly cursor: number; readonly scroll: number } | null;
  readonly map: MapUi;
  /** 530 default NAV look-ahead map range, index into NAV_MAP_RANGES_NM. */
  readonly navRange: number;
  /** Airport runway page map range index into MAP_RANGES_NM. */
  readonly rwyRange: number;
  /** NAVCOM page: index into the flight plan airport list. */
  readonly navcomAirport: number;
  readonly radio: RadioUi;
  readonly aux: AuxUi;
  readonly vnav: VnavUi;
  readonly proc: ProcUi;
  readonly terrain: TerrainUi;
  readonly settings: UnitSettings;
}

/** Nearest facilities, computed sparingly by the component (not every frame). */
export interface NearestLists {
  readonly airports: readonly Airport[];
  readonly vors: readonly Navaid[];
  readonly ndbs: readonly Navaid[];
  readonly fixes: readonly Fix[];
}

/** What the reducer may read: the shared simulator at the moment of the input. */
export interface GnsCtx {
  readonly state: SimState;
  readonly db: NavDatabase;
  readonly mag: MagneticModel;
  readonly nearest: NearestLists;
  readonly cdiSources: readonly CdiSource[];
  /** Instrument procedures by airport; null when the trainer has no procedure database. */
  readonly procedures: ProcedureSource | null;
  /** Wall-clock seconds, for UI timeouts. */
  readonly now: number;
}

/** A reducer result: the next screen state and what to tell the simulator. */
export interface Step {
  readonly ui: GnsUi;
  readonly cmds: readonly SimCommand[];
}
