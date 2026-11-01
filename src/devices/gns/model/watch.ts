import { angleDiff, bearing, crossTrackNm, distanceNm } from '../../../core/geo';
import type { NavDatabase } from '../../../core/navdb';
import type { ProcedureSource } from '../../../core/procedures';
import type { SimCommand } from '../../../sim/commands';
import { approachIndices } from '../../../sim/fms';
import type { Derived } from '../../../sim/simulator';
import type { CdiSource, LoadedApproach, SimState, TerrainAlertLevel } from '../../../sim/types';
import { currentPage } from './pages';
import { gpsApproved, resumeFlow, usesLocalizer } from './proc';
import type { GnsUi, NearestLists } from './types';

/*
 * What the unit does by itself as the flight goes on, evaluated every frame
 * as a pure function of the simulator and a small memo:
 *
 *   - ILS CDI "Auto": with an ILS or LOC approach active and its frequency
 *     tuned, the CDI switches from GPS to VLOC once established inbound,
 *     2 to 15 nm before the FAF within 1.2 nm of the final course (once per
 *     approach);
 *   - approach messages: "Select appropriate frequency for approach",
 *     "Select VLOC on CDI for approach", "Approach is not active";
 *   - the arrival alarm, when set on AUX Setup 1 ("Arrival at waypoint X");
 *   - the TERRAIN pop-up alert when a terrain caution or warning begins;
 *   - the PROC flow's first window, once the airport's procedures arrive.
 */

export interface WatchMemo {
  /** Messages already given, by occasion, so each is posted once. */
  readonly posted: readonly string[];
  /** The approach for which the CDI already switched to VLOC by itself. */
  readonly ilsSwitched: string | null;
  /** Terrain alert level last seen (pop-ups open when it rises). */
  readonly terrainLevel: TerrainAlertLevel;
}

export const INITIAL_WATCH: WatchMemo = { posted: [], ilsSwitched: null, terrainLevel: 'none' };

export interface WatchCtx {
  readonly state: SimState;
  readonly derived: Derived;
  readonly db: NavDatabase;
  readonly cdiSources: readonly CdiSource[];
  readonly procedures: ProcedureSource | null;
  readonly nearest: NearestLists;
}

export interface WatchResult {
  readonly memo: WatchMemo;
  readonly ui: GnsUi;
  readonly cmds: readonly SimCommand[];
}

/** Window of the automatic GPS to VLOC switch: along the course before the FAF, and either side of it. */
export const ILS_SWITCH = { minNm: 2, maxNm: 15, sideNm: 1.2, trackDeg: 45 } as const;
/** "You are inbound and within 3 NM of the FAF" (wrong frequency), 2 NM (CDI still on GPS, ILS CDI manual). */
const FREQ_MESSAGE_NM = 3;
const VLOC_MESSAGE_NM = 2;
/** "The approach could not transition to active, at 2 NM or closer to the FAF." */
const NOT_ACTIVE_NM = 2;
/** A message already in the list this recently (after a page reload, say) is not given again. */
const REPOST_AFTER_S = 600;
const MEMO_KEYS = 24;

export const MESSAGES = {
  frequency: 'Select appropriate frequency for approach',
  vloc: 'Select VLOC on CDI for approach',
  notActive: 'Approach is not active',
  arrival: (ident: string) => `Arrival at waypoint ${ident}`,
} as const;

const TERRAIN_RANK: Record<TerrainAlertLevel, number> = { none: 0, caution: 1, warning: 2 };

/** Garmin TERRAIN alert names: FLTA advisory for a caution, "TERRAIN AHEAD" when impact is imminent. */
export const TERRAIN_ALERT_TEXT: Record<Exclude<TerrainAlertLevel, 'none'>, string> = { caution: 'TERRAIN ADVISORY', warning: 'TERRAIN AHEAD' };

const approachKey = (a: LoadedApproach) => `${a.airport.ident}:${a.approach.id}:${a.transition ?? 'VTF'}`;

interface Inbound {
  /** Along the route to the FAF, nm. */
  readonly toFafNm: number;
  /** Left or right of the final approach course, nm. */
  readonly sideNm: number;
  /** Track within 45 degrees of the final approach course. */
  readonly aligned: boolean;
}

/** Where the airplane is relative to the final approach course while the FAF is still ahead. */
function inbound(state: SimState, derived: Derived): Inbound | null {
  const a = state.fms.approach;
  const d = derived.approach;
  const leg = state.fms.activeLeg;
  if (!a || !d?.activated || !leg || leg.approachIndex === null || leg.approachIndex === undefined) return null;
  const { faf, map } = approachIndices(a.legs);
  if (faf === null || map === null || leg.approachIndex > faf || d.distanceToFafNm === null) return null;
  const fafFix = a.legs[faf]!.to;
  const mapFix = a.legs[map]!.to;
  if (!fafFix || !mapFix) return null;
  const pos = state.aircraft;
  const courseTrue = bearing(fafFix, mapFix);
  return {
    toFafNm: d.distanceToFafNm,
    sideNm: Math.abs(crossTrackNm(fafFix, mapFix, pos)),
    aligned: Math.abs(angleDiff(pos.trackTrue, courseTrue)) < ILS_SWITCH.trackDeg,
  };
}

export function watch(memo: WatchMemo, ui: GnsUi, ctx: WatchCtx): WatchResult {
  const { state, derived } = ctx;
  const cmds: SimCommand[] = [];
  let posted = memo.posted;
  const post = (key: string, text: string) => {
    if (posted.includes(key)) return;
    posted = [...posted, key].slice(-MEMO_KEYS);
    const recent = state.messages.some((m) => m.text === text && state.time - m.at < REPOST_AFTER_S);
    if (!recent) cmds.push({ type: 'msg.post', text });
  };

  const powered = derived.systems.electrical.avionicsPowered;
  const a = state.fms.approach;
  const key = a ? approachKey(a) : null;
  let ilsSwitched = a?.activated ? memo.ilsSwitched : null;

  const where = powered && a ? inbound(state, derived) : null;
  if (a && key && where) {
    const loc = usesLocalizer(a.approach) && a.approach.localizer ? ctx.db.localizer(a.approach.localizer) : undefined;
    const tuned = !!loc && state.radios.nav[0].activeKhz === loc.freqKhz;
    let onGps = state.nav.cdiSource === 'GPS';
    if (loc && onGps && tuned && ui.settings.ilsCdi === 'auto' && ilsSwitched !== key && ctx.cdiSources.includes('NAV1')) {
      const inWindow = where.toFafNm >= ILS_SWITCH.minNm && where.toFafNm <= ILS_SWITCH.maxNm && where.sideNm <= ILS_SWITCH.sideNm && where.aligned;
      if (inWindow) {
        cmds.push({ type: 'cdi.source', source: 'NAV1' });
        ilsSwitched = key;
        onGps = false;
      }
    }
    if (loc && !tuned && where.toFafNm <= FREQ_MESSAGE_NM) post(`freq:${key}`, MESSAGES.frequency);
    if (!gpsApproved(a.approach) && onGps && where.toFafNm <= VLOC_MESSAGE_NM) post(`vloc:${key}`, MESSAGES.vloc);
  }

  // Loaded but never activated, and the FAF is close.
  if (powered && a && key && !a.activated) {
    const faf = approachIndices(a.legs).faf;
    const fix = faf !== null ? a.legs[faf]!.to : null;
    if (fix && distanceNm(state.aircraft, fix) <= NOT_ACTIVE_NM) post(`na:${key}`, MESSAGES.notActive);
  }

  const gps = derived.gps;
  if (powered && ui.settings.arrivalAlarm && gps.active && gps.to && gps.distanceNm !== null && gps.distanceNm <= ui.settings.arrivalNm) {
    const leg = state.fms.activeLeg;
    post(`arr:${gps.to.ident}:${leg?.planIndex ?? ''}:${leg?.approachIndex ?? ''}`, MESSAGES.arrival(gps.to.ident));
  }

  // TERRAIN pop-up when an alert begins (not on the TERRAIN page itself, not while inhibited).
  const t = derived.systems.terrain;
  const level: TerrainAlertLevel = !powered || !derived.systems.gpsValid || t.suppressed || ui.terrain.inhibited ? 'none' : t.alert;
  let next = ui;
  if (TERRAIN_RANK[level] > TERRAIN_RANK[memo.terrainLevel] && level !== 'none' && currentPage(ui) !== 'nav.terrain' && !ui.entry) {
    next = { ...ui, popup: { kind: 'terrainAlert', text: TERRAIN_ALERT_TEXT[level] } };
  }
  next = resumeFlow(next, ctx);

  const changed = posted !== memo.posted || ilsSwitched !== memo.ilsSwitched || level !== memo.terrainLevel;
  return { memo: changed ? { posted, ilsSwitched, terrainLevel: level } : memo, ui: next, cmds };
}
