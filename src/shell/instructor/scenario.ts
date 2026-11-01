import { bearing, destination, distanceNm, FT_PER_NM, norm360, type LatLon } from '../../core/geo';
import type { Waypoint } from '../../core/navdb';
import { shortApproachName, type AirportProcedures, type AltitudeConstraint, type Approach, type ProcFix, type ProcLeg } from '../../core/procedures';
import type { SimCommand } from '../../sim/commands';
import type { CdiSource } from '../../sim/types';
import { formatAltitude, formatBearing } from '../../ui/format';

/*
 * Scenario starts: where to put the airplane for an approach, and the
 * commands that set it up.
 *
 *   transition  N nm before the transition's first fix, on the course of its
 *               first leg, at the first published altitude, heading for the fix
 *   final       on the extended final approach course, N nm out, at the
 *               segment's altitude (below the glidepath, so it is captured
 *               from below) or on the glidepath inside the final approach fix
 *   intercept   the same point offset to one side, on a 30 degree intercept
 *               heading, as if vectored by approach control
 *   hold        N nm from a published holding fix (missed approach hold or a
 *               hold in lieu of a procedure turn), lined up for the chosen entry
 *
 * Geometry comes from the procedure's own fixes (bearings between them are
 * true) wherever possible; published magnetic courses are converted with
 * the magnetic model only when there is nothing else.
 */

export interface MagConverter {
  toTrue(magDeg: number, lat: number, lon: number): number;
  toMagnetic(trueDeg: number, lat: number, lon: number): number;
}

export type HoldEntry = 'direct' | 'teardrop' | 'parallel';

export type StartChoice =
  | { readonly kind: 'transition'; readonly distanceNm?: number }
  | { readonly kind: 'final'; readonly distanceNm?: number }
  | { readonly kind: 'intercept'; readonly distanceNm?: number; readonly offsetNm?: number; readonly angleDeg?: number; readonly side?: 1 | -1 }
  | { readonly kind: 'hold'; readonly holdIndex?: number; readonly entry?: HoldEntry; readonly distanceNm?: number };

export const DEFAULT_DISTANCE_NM = { transition: 12, final: 10, intercept: 12, hold: 6 } as const;

export interface AirplaneStart extends LatLon {
  readonly altitudeFt: number;
  readonly headingTrue: number;
  readonly headingMag: number;
  readonly iasKt: number;
  /** "12 nm NW of MRB", "10 nm final". */
  readonly where: string;
}

const RAD = Math.PI / 180;
const ceil100 = (ft: number) => Math.ceil(ft / 100 - 1e-9) * 100;
const floor100 = (ft: number) => Math.floor(ft / 100 + 1e-9) * 100;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Eight-point compass direction of a true bearing. */
export function compass8(deg: number): string {
  return COMPASS[Math.round(norm360(deg) / 45) % 8]!;
}

/** The altitude a constraint lets you fly: the published altitude or its floor. */
export function constraintFt(c: AltitudeConstraint | undefined): number | null {
  if (!c) return null;
  return c.kind === 'between' ? c.aboveFt : c.ft;
}

type FixLeg = ProcLeg & { readonly fix: ProcFix };
const hasFix = (l: ProcLeg): l is FixLeg => !!l.fix;
const isHoldLeg = (l: ProcLeg) => l.path === 'HM' || l.path === 'HA' || l.path === 'HF';

// Final approach geometry ------------------------------------------------

export interface FinalFix {
  readonly fix: ProcFix;
  /** Straight-line distance to the anchor (threshold or MAP). */
  readonly toAnchorNm: number;
  readonly floorFt: number | null;
  readonly faf: boolean;
}

export interface FinalGeometry {
  /** Where "an N nm final" is measured from: the missed approach point, normally the landing threshold. */
  readonly anchor: LatLon;
  /** Landing threshold for the glidepath (the anchor when there is no runway). */
  readonly threshold: LatLon;
  readonly thresholdElevationFt: number;
  readonly tchFt: number;
  readonly courseTrue: number;
  readonly courseMag: number;
  /** Glidepath or glideslope angle; null for approaches without vertical guidance. */
  readonly angleDeg: number | null;
  readonly fafNm: number | null;
  /** Final segment fixes with altitudes, farthest first. */
  readonly fixes: readonly FinalFix[];
  /** Highest altitude any transition publishes at the first final fix (the intermediate fix). */
  readonly ifFloorFt: number | null;
}

export function finalGeometry(
  approach: Approach,
  procs: AirportProcedures | null,
  mag: MagConverter,
  fieldElevationFt: number,
): FinalGeometry | null {
  const legs = approach.final.filter(hasFix);
  const mapLeg = legs.find((l) => l.map) ?? legs[legs.length - 1];
  const fafLeg = legs.find((l) => l.faf);
  const runway = approach.runway ? procs?.runways.find((r) => r.ident === approach.runway) : undefined;
  const path = approach.path;

  const threshold: LatLon | null = path
    ? { lat: path.thresholdLat, lon: path.thresholdLon }
    : runway
      ? { lat: runway.lat, lon: runway.lon }
      : mapLeg
        ? mapLeg.fix
        : null;
  if (!threshold) return null;
  // A missed approach point short of the threshold (or off to the side) is where the final course ends.
  const anchor = mapLeg && distanceNm(mapLeg.fix, threshold) > 0.3 ? mapLeg.fix : threshold;

  let courseTrue: number | null = null;
  if (fafLeg && distanceNm(fafLeg.fix, anchor) > 1) courseTrue = bearing(fafLeg.fix, anchor);
  else if (path) courseTrue = mag.toTrue(path.courseMag, anchor.lat, anchor.lon);
  else if (runway?.courseMag != null) courseTrue = mag.toTrue(runway.courseMag, anchor.lat, anchor.lon);
  else {
    const before = [...legs].reverse().find((l) => distanceNm(l.fix, anchor) > 1);
    if (before) courseTrue = bearing(before.fix, anchor);
  }
  if (courseTrue === null) return null;

  const fixes = legs
    .map((l) => ({ fix: l.fix, toAnchorNm: distanceNm(l.fix, anchor), floorFt: constraintFt(l.altitude), faf: !!l.faf }))
    .sort((a, b) => b.toAnchorNm - a.toAnchorNm);
  const first = legs[0]?.fix.ident;
  const ifFloors = approach.transitions
    .flatMap((t) => t.legs)
    .filter((l) => l.fix?.ident === first)
    .map((l) => constraintFt(l.altitude))
    .filter((v): v is number => v !== null);

  return {
    anchor,
    threshold,
    thresholdElevationFt: path?.thresholdElevationFt ?? runway?.elevationFt ?? fieldElevationFt,
    tchFt: path?.tchFt ?? runway?.tchFt ?? 50,
    courseTrue,
    courseMag: Math.round(path?.courseMag ?? runway?.courseMag ?? mag.toMagnetic(courseTrue, anchor.lat, anchor.lon)) % 360 || 360,
    angleDeg: path?.angleDeg ?? null,
    fafNm: fafLeg ? distanceNm(fafLeg.fix, anchor) : null,
    fixes,
    ifFloorFt: ifFloors.length > 0 ? Math.max(...ifFloors) : null,
  };
}

/** Height of the glidepath over a point, ft MSL; null without vertical guidance. */
export function glidepathFt(g: FinalGeometry, pos: LatLon): number | null {
  if (g.angleDeg === null) return null;
  return g.thresholdElevationFt + g.tchFt + distanceNm(pos, g.threshold) * FT_PER_NM * Math.tan(g.angleDeg * RAD);
}

/**
 * Altitude for a start `d` nm out on final. Outside the final approach fix:
 * the higher of the altitudes published at the fixes either side (what
 * approach control would assign), but at least 150 ft below the glidepath
 * so it is intercepted from below, and never below the next fix's altitude.
 * Inside the final approach fix: on the glidepath.
 */
export function finalAltitudeFt(g: FinalGeometry, d: number, pos: LatLon): number {
  const gp = glidepathFt(g, pos);
  if (g.fafNm !== null && d < g.fafNm - 0.1 && gp !== null) return Math.round(gp / 10) * 10;
  const withFloor = g.fixes.filter((f) => f.floorFt !== null);
  const behind = [...withFloor].reverse().find((f) => f.toAnchorNm >= d);
  const ahead = withFloor.find((f) => f.toAnchorNm < d);
  const prev = behind?.floorFt ?? g.ifFloorFt;
  const next = ahead?.floorFt ?? null;
  let alt = ceil100(Math.max(prev ?? next ?? g.thresholdElevationFt + 2000, next ?? -Infinity));
  if (gp !== null) alt = Math.min(alt, floor100(gp - 150));
  if (next !== null) alt = Math.max(alt, ceil100(next));
  return alt;
}

function finalStart(
  g: FinalGeometry,
  choice: Extract<StartChoice, { kind: 'final' | 'intercept' }>,
  mag: MagConverter,
  runwayLabel: string,
): AirplaneStart {
  const d = choice.distanceNm ?? DEFAULT_DISTANCE_NM[choice.kind];
  const onCourse = destination(g.anchor, g.courseTrue + 180, d);
  let pos: LatLon = onCourse;
  let headingTrue = g.courseTrue;
  let where = `${round1(d)} nm final ${runwayLabel}`.trim();
  if (choice.kind === 'intercept') {
    const side = choice.side ?? 1;
    const offset = choice.offsetNm ?? 2;
    const angle = choice.angleDeg ?? 30;
    // `side` +1: right of the final course looking toward the runway. Turn back toward it.
    pos = destination(onCourse, g.courseTrue + 90 * side, offset);
    headingTrue = norm360(g.courseTrue - side * angle);
    where = `${round1(d)} nm out, ${round1(offset)} nm ${side > 0 ? 'right' : 'left'} of the final course`;
  }
  return {
    lat: pos.lat,
    lon: pos.lon,
    altitudeFt: finalAltitudeFt(g, d, pos),
    headingTrue,
    headingMag: magHeading(mag, headingTrue, pos),
    iasKt: 95,
    where,
  };
}

// Transitions ------------------------------------------------------------

/** N nm before the transition's first fix on its first leg's course, at the first published altitude. */
export function transitionStart(
  approach: Approach,
  name: string,
  distance: number,
  mag: MagConverter,
  fieldElevationFt: number,
): AirplaneStart | null {
  const t = approach.transitions.find((x) => x.name === name);
  if (!t) return null;
  const fixLegs = [...t.legs, ...approach.final].filter(hasFix);
  const first = fixLegs[0];
  if (!first) return null;
  const next = fixLegs.find((l) => distanceNm(l.fix, first.fix) > 0.5);
  const reversal = t.legs[0] && isHoldLeg(t.legs[0]) ? t.legs[0] : null;
  const inboundTrue = next
    ? bearing(first.fix, next.fix)
    : reversal?.courseMag !== undefined
      ? mag.toTrue(reversal.courseMag, first.fix.lat, first.fix.lon)
      : null;
  if (inboundTrue === null) return null;
  const pos = destination(first.fix, inboundTrue + 180, distance);
  const floor =
    [...t.legs, ...approach.final].map((l) => constraintFt(l.altitude)).find((v): v is number => v !== null) ?? fieldElevationFt + 2500;
  const headingTrue = bearing(pos, first.fix);
  return {
    lat: pos.lat,
    lon: pos.lon,
    altitudeFt: ceil100(floor),
    headingTrue,
    headingMag: magHeading(mag, headingTrue, pos),
    iasKt: 105,
    where: `${round1(distance)} nm ${compass8(bearing(first.fix, pos))} of ${first.fix.ident}`,
  };
}

// Holds ------------------------------------------------------------------

export interface HoldInfo {
  readonly fix: ProcFix;
  readonly inboundCourseMag: number;
  readonly turn: 'L' | 'R';
  readonly legTimeMin: number | null;
  readonly legNm: number | null;
  readonly altitudeFt: number | null;
  /** "Missed approach hold at KORNY" */
  readonly label: string;
}

/** Published holds of an approach: the missed approach hold, then holds in lieu of a procedure turn. */
export function approachHolds(approach: Approach): HoldInfo[] {
  const out: HoldInfo[] = [];
  const add = (l: ProcLeg, label: string) => {
    if (!hasFix(l) || l.courseMag === undefined) return;
    if (out.some((h) => h.fix.ident === l.fix.ident && h.inboundCourseMag === l.courseMag)) return;
    const legNm = l.distanceNm ?? null;
    out.push({
      fix: l.fix,
      inboundCourseMag: l.courseMag,
      turn: l.turn ?? 'R',
      // One-minute legs below 14,000 ft unless the leg is published by time or distance.
      legTimeMin: l.legTimeMin ?? (legNm === null ? 1 : null),
      legNm,
      altitudeFt: constraintFt(l.altitude),
      label: `${label} at ${l.fix.ident}`,
    });
  };
  for (const l of approach.missed) if (isHoldLeg(l)) add(l, 'Missed approach hold');
  for (const t of approach.transitions) for (const l of t.legs) if (isHoldLeg(l)) add(l, 'Course reversal hold');
  return out;
}

/**
 * The entry a pilot would fly, from the heading on arrival at the fix and the
 * inbound course (both true). The 70 degree line through the fix splits the
 * arrivals into direct (180 degrees), teardrop (70) and parallel (110).
 */
export function holdEntry(arrivalTrue: number, inboundTrue: number, turn: 'L' | 'R'): HoldEntry {
  const r = norm360(arrivalTrue - inboundTrue);
  if (turn === 'R') {
    if (r >= 110 && r < 180) return 'teardrop';
    if (r >= 180 && r < 290) return 'parallel';
    return 'direct';
  }
  if (r > 180 && r <= 250) return 'teardrop';
  if (r > 70 && r <= 180) return 'parallel';
  return 'direct';
}

/** Arrival heading relative to the inbound course that gives each entry: the middle of its sector. */
const ENTRY_REL: Record<HoldEntry, { R: number; L: number }> = {
  direct: { R: 0, L: 0 },
  teardrop: { R: 145, L: 215 },
  parallel: { R: 235, L: 125 },
};

export function holdStart(hold: HoldInfo, entry: HoldEntry, distance: number, mag: MagConverter, fieldElevationFt: number): AirplaneStart {
  const inboundTrue = mag.toTrue(hold.inboundCourseMag, hold.fix.lat, hold.fix.lon);
  const arrival = norm360(inboundTrue + ENTRY_REL[entry][hold.turn]);
  const pos = destination(hold.fix, arrival + 180, distance);
  const headingTrue = bearing(pos, hold.fix);
  return {
    lat: pos.lat,
    lon: pos.lon,
    altitudeFt: ceil100(hold.altitudeFt ?? fieldElevationFt + 3000),
    headingTrue,
    headingMag: magHeading(mag, headingTrue, pos),
    iasKt: 100,
    where: `${round1(distance)} nm ${compass8(bearing(hold.fix, pos))} of ${hold.fix.ident}`,
  };
}

// The whole scenario -------------------------------------------------------

export type ApproachLoad = 'none' | 'load' | 'activate';

export interface ScenarioRequest {
  readonly airport: Waypoint;
  readonly fieldElevationFt: number;
  readonly procedures: AirportProcedures | null;
  readonly approach: Approach;
  /** Transition name, or null for vectors to final. */
  readonly transition: string | null;
  readonly start: StartChoice;
  /** Leave the approach for the pilot to load, load it, or load and activate it. */
  readonly load: ApproachLoad;
  readonly autopilot: boolean;
  readonly setAltimeter: boolean;
  /** Tune and set the course of the localizer on NAV1 (default true); off when the pilot practises it. */
  readonly tuneLocalizer?: boolean;
}

export interface LocalizerInfo {
  readonly ident: string;
  readonly freqKhz: number;
  readonly courseMag: number;
}

export interface ScenarioEnv {
  readonly mag: MagConverter;
  readonly qnhInHg: number;
  /** The approach's localizer from the database (ILS, LOC, LDA, SDF). */
  readonly localizer: LocalizerInfo | null;
  /** The flight plan waypoint for a procedure fix. */
  readonly waypoint: (fix: ProcFix) => Waypoint;
}

export interface ScenarioPlan {
  readonly start: AirplaneStart;
  readonly commands: readonly SimCommand[];
  /** One line for the instructor: where and what was set up. */
  readonly summary: string;
  readonly notes: readonly string[];
  readonly hold: HoldInfo | null;
}

/** Approaches flown on a VHF localizer. */
export const usesLocalizer = (a: Approach) => !!a.localizer && ['ILS', 'LOC', 'LOC BC', 'LDA', 'SDF', 'IGS'].includes(a.type);

export function planScenario(req: ScenarioRequest, env: ScenarioEnv): ScenarioPlan | { readonly error: string } {
  const { approach, start: choice } = req;
  const name = shortApproachName(approach);
  const notes: string[] = [];
  let start: AirplaneStart | null = null;
  let hold: HoldInfo | null = null;

  if (choice.kind === 'transition') {
    if (!req.transition) return { error: 'Pick a transition to start before its first fix.' };
    start = transitionStart(approach, req.transition, choice.distanceNm ?? DEFAULT_DISTANCE_NM.transition, env.mag, req.fieldElevationFt);
    if (!start) return { error: `The ${req.transition} transition has no fix to start from.` };
  } else if (choice.kind === 'hold') {
    hold = approachHolds(approach)[choice.holdIndex ?? 0] ?? null;
    if (!hold) return { error: `${name} has no published hold.` };
    start = holdStart(hold, choice.entry ?? 'direct', choice.distanceNm ?? DEFAULT_DISTANCE_NM.hold, env.mag, req.fieldElevationFt);
  } else {
    const g = finalGeometry(approach, req.procedures, env.mag, req.fieldElevationFt);
    if (!g) return { error: `${name} has no final approach course to line up on.` };
    start = finalStart(g, choice, env.mag, approach.runway ? `RWY ${approach.runway}` : '');
  }

  const cmds: SimCommand[] = [
    { type: 'sim.reposition', lat: start.lat, lon: start.lon, altitudeFt: start.altitudeFt, headingTrue: start.headingTrue, iasKt: start.iasKt },
    // A clean slate: no old approach, direct-to or plan; the airport becomes the destination.
    { type: 'fms.removeApproach' },
    { type: 'fms.cancelDirectTo' },
    { type: 'fms.replacePlan', plan: [req.airport] },
  ];

  const onFinal = choice.kind === 'final' || choice.kind === 'intercept';
  let what: string;
  if (hold) {
    // The published hold, entered at its fix (what "hold as published" asks for).
    const fix = env.waypoint(hold.fix);
    cmds.push(
      { type: 'fms.directTo', waypoint: fix },
      { type: 'fms.hold', waypoint: fix, inboundCourseMag: hold.inboundCourseMag, turn: hold.turn, legTimeMin: hold.legTimeMin, legNm: hold.legNm },
    );
    what = `Holding at ${hold.fix.ident}: inbound ${formatBearing(hold.inboundCourseMag)}, ${hold.turn === 'R' ? 'right' : 'left'} turns, ${holdLegText(hold)}.`;
  } else if (req.load === 'none') {
    if (choice.kind === 'transition') {
      const first = approach.transitions.find((t) => t.name === req.transition)?.legs.find(hasFix);
      if (first) cmds.push({ type: 'fms.directTo', waypoint: env.waypoint(first.fix) });
      what = `Direct ${first?.fix.ident ?? req.transition}; load the ${name} yourself.`;
    } else what = `Vectors; load the ${name} yourself.`;
  } else {
    const activate = req.load === 'load' ? 'load' : onFinal || !req.transition ? 'vtf' : 'activate';
    cmds.push({ type: 'fms.loadApproach', airport: req.airport, approach, transition: onFinal ? null : req.transition, activate });
    what =
      activate === 'load'
        ? `${name} loaded.`
        : activate === 'vtf'
          ? `${name} active, vectors to final.`
          : `${name} active from ${req.transition}.`;
  }

  let cdi: CdiSource = 'GPS';
  if (usesLocalizer(approach) && req.tuneLocalizer !== false) {
    if (env.localizer) {
      cmds.push(
        { type: 'nav.setActive', radio: 0, khz: env.localizer.freqKhz },
        { type: 'obs.set', radio: 0, mag: Math.round(env.localizer.courseMag) },
      );
      if (onFinal) cdi = 'NAV1';
    } else notes.push(`Localizer ${approach.localizer} is not in the database: NAV1 was left as it was.`);
  }
  cmds.push(
    { type: 'cdi.source', source: cdi },
    { type: 'bug.heading', mag: Math.round(start.headingMag) },
    { type: 'bug.altitude', ft: start.altitudeFt },
  );
  if (req.setAltimeter) cmds.push({ type: 'baro.set', inHg: env.qnhInHg });
  // Approach power on final; cruise power elsewhere.
  cmds.push({ type: 'engine.throttle', value: onFinal ? 0.6 : 0.72 });

  let ap = 'hand flying';
  if (req.autopilot) {
    cmds.push({ type: 'ap.engage', on: true }, { type: 'ap.vertical', mode: 'ALT' });
    if (onFinal) {
      cmds.push({ type: 'ap.lateral', mode: 'HDG' });
      if (req.load !== 'none') cmds.push({ type: 'ap.approach', on: true });
      ap = req.load !== 'none' ? 'autopilot HDG, ALT, APR armed' : 'autopilot HDG, ALT';
    } else {
      cmds.push({ type: 'ap.lateral', mode: 'NAV' });
      ap = 'autopilot NAV, ALT';
    }
  } else cmds.push({ type: 'ap.engage', on: false });

  const summary = `${start.where}, ${formatAltitude(start.altitudeFt)} ft, heading ${formatBearing(start.headingMag)}. ${what} ${cap(ap)}.`;
  return { start, commands: cmds, summary, notes, hold };
}

export function holdLegText(h: HoldInfo): string {
  if (h.legNm !== null) return `${round1(h.legNm)} nm legs`;
  const t = h.legTimeMin ?? 1;
  return `${round1(t)} minute legs`;
}

function magHeading(mag: MagConverter, trueDeg: number, at: LatLon): number {
  return mag.toMagnetic(trueDeg, at.lat, at.lon);
}

const round1 = (v: number) => String(Math.round(v * 10) / 10);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
