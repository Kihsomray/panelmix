import { bearing, distanceNm, norm360, type LatLon } from '../../core/geo';
import type { MagneticModel } from '../../core/magvar';
import type { NavDatabase, Waypoint } from '../../core/navdb';
import type { AltitudeConstraint, Approach, PathTerminator, ProcFix, ProcLeg } from '../../core/procedures';
import { destination } from '../../core/geo';
import { rayCircleIntersectionNm } from './geometry';
import type { ApproachMode, RouteLeg } from './types';

/*
 * Turns a published approach (CIFP legs) into the legs the FMS flies:
 * transition, final and missed approach in order, with the duplicate fix
 * where a transition joins the final removed, a leg to the fix inserted in
 * front of holds, procedure turns and legs that start at a fix, every course
 * resolved to true with the declination it is published against, and the
 * labels Garmin flight plan pages show ("1100ft", "INTRCPT", "HOLD").
 */

export interface ProcedureContext {
  readonly mag: MagneticModel;
  /** For station declinations (localizers, VORs). Without it the local variation is used. */
  readonly db?: NavDatabase;
}

const HOLDS: ReadonlySet<PathTerminator> = new Set(['HM', 'HA', 'HF']);
/** Legs that begin at their own fix, so the airplane has to get there first. */
const FROM_FIX: ReadonlySet<PathTerminator> = new Set(['FC', 'FA', 'FD', 'FM', 'PI', 'HM', 'HA', 'HF']);
/** Legs that end at their fix. */
const TO_FIX: ReadonlySet<PathTerminator> = new Set(['IF', 'TF', 'CF', 'DF', 'RF', 'AF']);

export const isHoldPath = (p: PathTerminator) => HOLDS.has(p);

export function procFixWaypoint(f: ProcFix, db?: NavDatabase): Waypoint {
  const kind = f.kind === 'vor' ? 'vor' : f.kind === 'ndb' ? 'ndb' : f.kind === 'airport' ? 'airport' : 'fix';
  const known = kind === 'vor' || kind === 'ndb' || kind === 'airport' ? db?.get(f.ident, f) : undefined;
  const name = known && known.kind === kind && distanceNm(known, f) < 2 ? known.name : f.ident;
  return { kind, ident: f.ident, name, lat: f.lat, lon: f.lon };
}

const sameFix = (a: LatLon & { ident: string }, b: LatLon & { ident: string }) => a.ident === b.ident && distanceNm(a, b) < 0.2;

/** The altitude a constraint names (the lower bound of a window). */
export function constraintFt(c: AltitudeConstraint | undefined): number | null {
  if (!c) return null;
  return c.kind === 'between' ? c.aboveFt : c.ft;
}

/**
 * Declination a leg's courses are published against: the localizer's or the
 * VOR's own station declination when the leg is based on one, otherwise the
 * local variation. East positive, true = magnetic + declination.
 */
function declination(leg: ProcLeg, at: LatLon, ctx: ProcedureContext): number {
  const nav = leg.recommendedNavaid;
  if (nav && ctx.db) {
    if (nav.kind === 'loc') {
      const loc = ctx.db.localizer(nav.ident);
      if (loc && distanceNm(loc, nav) < 10) return loc.magVar;
    } else if (nav.kind === 'vor') {
      const vor = ctx.db.get(nav.ident, nav);
      if (vor && vor.kind === 'vor' && 'magVar' in vor && distanceNm(vor, nav) < 5) return vor.magVar;
    }
  }
  return ctx.mag.variation(at.lat, at.lon);
}

/** Garmin's name for a computed DME point: "D" + radial + distance letter (D134J = 134 radial, 10 nm). */
function dmeName(radialMag: number, nm: number): string {
  const radial = String(Math.round(norm360(radialMag)) % 360).padStart(3, '0');
  const d = Math.round(nm);
  return d >= 1 && d <= 26 ? `D${radial}${String.fromCharCode(64 + d)}` : `D${radial}/${d}`;
}

function label(leg: ProcLeg, prevFix: ProcFix | null, ctx: ProcedureContext): string {
  switch (leg.path) {
    case 'CA':
    case 'FA':
    case 'VA': {
      const ft = constraintFt(leg.altitude);
      return ft === null ? 'ALT' : `${Math.round(ft)}ft`;
    }
    case 'VI':
    case 'CI':
      return 'INTRCPT';
    case 'VM':
    case 'FM':
      return 'MANSEQ';
    case 'HM':
    case 'HA':
    case 'HF':
      return 'HOLD';
    case 'PI':
      return 'PROC TURN';
    case 'CR':
    case 'VR': {
      const nav = leg.recommendedNavaid;
      const radial = String(Math.round(norm360(leg.thetaDeg ?? 0)) % 360).padStart(3, '0');
      return nav ? `${nav.ident}${radial}` : 'INTRCPT';
    }
    case 'FC': {
      if (!leg.fix || leg.distanceNm === undefined) return leg.fix?.ident ?? 'FC';
      return dmeName(leg.courseMag ?? 0, leg.distanceNm);
    }
    case 'FD':
    case 'CD':
    case 'VD': {
      const nav = leg.recommendedNavaid;
      if (!nav || leg.distanceNm === undefined) return 'DME';
      const start = leg.fix ?? prevFix ?? nav;
      const decl = declination(leg, nav, ctx);
      const course = norm360((leg.courseMag ?? 0) + decl);
      const t = rayCircleIntersectionNm(start, course, nav, leg.distanceNm);
      const end = t === null ? destination(start, course, leg.distanceNm) : destination(start, course, t);
      return dmeName(bearing(nav, end) - decl, leg.distanceNm);
    }
    default:
      return leg.fix?.ident ?? leg.path;
  }
}

function role(leg: ProcLeg): RouteLeg['role'] | undefined {
  if (leg.map) return 'MAP';
  if (leg.faf) return 'FAF';
  if (leg.iaf) return 'IAF';
  if (leg.if) return 'IF';
  return undefined;
}

function routeLeg(
  leg: ProcLeg,
  segment: RouteLeg['segment'],
  prevFix: ProcFix | null,
  airport: LatLon,
  ctx: ProcedureContext,
): RouteLeg {
  const at = leg.fix ?? leg.recommendedNavaid ?? prevFix ?? airport;
  const decl = declination(leg, at, ctx);
  // A leg that starts at its fix doesn't own the fix's role: the leg that gets there does.
  const r = FROM_FIX.has(leg.path) ? undefined : role(leg);
  const nav = leg.recommendedNavaid;
  const arcCenter = leg.arcCenter ?? (leg.path === 'AF' && nav ? { lat: nav.lat, lon: nav.lon } : undefined);
  const arcRadiusNm = leg.arcRadiusNm ?? (leg.path === 'AF' ? leg.rhoNm : undefined);
  return {
    path: leg.path,
    to: leg.fix ? procFixWaypoint(leg.fix, ctx.db) : null,
    segment,
    label: label(leg, prevFix, ctx),
    ...(leg.courseMag !== undefined && { courseMag: leg.courseMag, courseTrue: norm360(leg.courseMag + decl) }),
    ...(leg.turn && { turn: leg.turn }),
    ...(leg.distanceNm !== undefined && { distanceNm: leg.distanceNm }),
    ...(leg.legTimeMin !== undefined && { legTimeMin: leg.legTimeMin }),
    ...(leg.altitude && { altitude: leg.altitude }),
    ...(leg.speedKt !== undefined && { speedKt: leg.speedKt }),
    ...(leg.verticalAngleDeg !== undefined && { verticalAngleDeg: leg.verticalAngleDeg }),
    ...(arcCenter && { arcCenter: { lat: arcCenter.lat, lon: arcCenter.lon } }),
    ...(arcRadiusNm !== undefined && { arcRadiusNm }),
    ...(r && { role: r }),
    ...(leg.flyover && { flyover: true }),
    ...(nav && { navaid: { ident: nav.ident, lat: nav.lat, lon: nav.lon } }),
    ...((leg.path === 'CR' || leg.path === 'VR') && nav && leg.thetaDeg !== undefined && { radialTrue: norm360(leg.thetaDeg + decl) }),
  };
}

/** The leg that takes the airplane to a fix a hold, procedure turn or FC/FD/FA/FM leg starts from. */
function toFixLeg(leg: ProcLeg, fix: ProcFix, segment: RouteLeg['segment'], first: boolean, prevEndsAtFix: boolean, db?: NavDatabase): RouteLeg {
  const r = role(leg);
  return {
    path: first ? 'IF' : prevEndsAtFix ? 'TF' : 'DF',
    to: procFixWaypoint(fix, db),
    segment,
    label: fix.ident,
    ...(leg.altitude && { altitude: leg.altitude }),
    ...(r && { role: r }),
  };
}

/** Legs in flying order for the chosen transition (null: straight from the final's first fix). */
export function buildApproachLegs(
  approach: Approach,
  transition: string | null,
  airport: LatLon,
  ctx: ProcedureContext,
): RouteLeg[] {
  const t = transition !== null ? approach.transitions.find((x) => x.name === transition) : undefined;
  const source = [
    ...(t?.legs ?? []).map((leg) => ({ leg, segment: 'transition' as const })),
    ...approach.final.map((leg) => ({ leg, segment: 'final' as const })),
    ...approach.missed.map((leg) => ({ leg, segment: 'missed' as const })),
  ];
  const out: RouteLeg[] = [];
  let lastFix: ProcFix | null = null;
  /** Gives the fix's role to the last leg that ends at it, unless it already has one. */
  const roleToArrival = (leg: ProcLeg) => {
    const r = role(leg);
    for (let i = out.length - 1; i >= 0 && r; i--) {
      const l = out[i]!;
      if (FROM_FIX.has(l.path)) continue;
      if (!l.role && l.to && leg.fix && sameFix(l.to, leg.fix)) out[i] = { ...l, role: r };
      return;
    }
  };
  for (const { leg, segment } of source) {
    const fix = leg.fix ?? null;
    // Where a transition ends at the fix the final starts from, it simply flows on.
    if (leg.path === 'IF' && fix && lastFix && sameFix(fix, lastFix)) {
      roleToArrival(leg);
      continue;
    }
    if (fix && FROM_FIX.has(leg.path)) {
      if (!(lastFix && sameFix(fix, lastFix))) {
        out.push(toFixLeg(leg, fix, segment, out.length === 0, lastFix !== null, ctx.db));
        lastFix = fix;
      } else roleToArrival(leg);
    }
    out.push(routeLeg(leg, segment, lastFix, airport, ctx));
    lastFix = fix && (TO_FIX.has(leg.path) || HOLDS.has(leg.path)) ? fix : null;
  }
  // The missed approach holding point is the fix the missed approach hold is flown at.
  const hold = out.findIndex((l) => l.segment === 'missed' && HOLDS.has(l.path));
  const before = out[hold - 1];
  if (hold > 0 && before && !before.role && before.to && out[hold]!.to && before.to.ident === out[hold]!.to!.ident) {
    out[hold - 1] = { ...before, role: 'MAHP' };
  }
  return out;
}

export interface ApproachIndices {
  readonly faf: number | null;
  readonly map: number | null;
  /** First leg of the missed approach. */
  readonly missed: number | null;
}

export function approachIndices(legs: readonly RouteLeg[]): ApproachIndices {
  const faf = legs.findIndex((l) => l.role === 'FAF');
  let map = legs.findIndex((l) => l.role === 'MAP');
  if (map < 0) {
    for (let i = legs.length - 1; i >= 0; i--) {
      if (legs[i]!.segment === 'final') {
        map = i;
        break;
      }
    }
  }
  const missed = legs.findIndex((l) => l.segment === 'missed');
  return { faf: faf >= 0 ? faf : null, map: map >= 0 ? map : null, missed: missed >= 0 ? missed : null };
}

/** Whether the published final has a vertical path (an FAS block, or a vertical angle to the runway). */
export function hasVerticalPath(a: Approach): boolean {
  return a.path !== undefined || a.final.some((l) => l.verticalAngleDeg !== undefined);
}

const GPS_TYPES = new Set(['RNAV', 'RNP', 'GPS']);

/** The service level a WAAS navigator annunciates for the approach (LPV, L/VNAV, LNAV+V...). */
export function approachMode(a: Approach): ApproachMode {
  if (GPS_TYPES.has(a.type)) {
    const vertical = hasVerticalPath(a);
    if (a.minima.includes('LPV')) return 'LPV';
    if (a.minima.includes('LP')) return vertical ? 'LP+V' : 'LP';
    if (a.minima.includes('LNAV/VNAV')) return 'L/VNAV';
    return vertical ? 'LNAV+V' : 'LNAV';
  }
  switch (a.type) {
    case 'ILS':
    case 'GLS':
    case 'IGS':
      return 'ILS';
    case 'LOC':
    case 'LOC BC':
    case 'LDA':
    case 'SDF':
      return 'LOC';
    case 'NDB':
    case 'NDB/DME':
      return 'NDB';
    default:
      return 'VOR';
  }
}

/** GPS vertical guidance a mode gives: coupled (LPV, L/VNAV), advisory (+V) or none. */
export function gpsVertical(mode: ApproachMode): 'coupled' | 'advisory' | null {
  if (mode === 'LPV' || mode === 'L/VNAV') return 'coupled';
  if (mode === 'LNAV+V' || mode === 'LP+V') return 'advisory';
  return null;
}

/** Angular CDI scaling on final (like a localizer) for these modes; LNAV stays linear 0.3 nm. */
export function angularLateral(mode: ApproachMode): boolean {
  return mode === 'LPV' || mode === 'LP' || mode === 'LP+V' || mode === 'L/VNAV' || mode === 'LNAV+V';
}
