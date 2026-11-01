import { angleDiff, bearing, distanceNm, FT_PER_NM, norm360, toDeg, toRad, type LatLon } from '../core/geo';
import { isLocalizer } from '../core/frequency';
import type { MagneticModel } from '../core/magvar';
import type { Localizer, NavDatabase, Navaid } from '../core/navdb';
import type { GpsSolution } from './fms';
import type { BearingSource, CdiSource, SimState } from './types';

/*
 * VHF NAV receivers (VOR, localizer and glideslope) and the composite
 * course-deviation picture that every CDI and HSI draws, whatever the source.
 */

/** Full-scale VOR deflection, degrees either side of the selected course. */
export const VOR_FULL_SCALE_DEG = 10;
/** Full-scale glideslope deflection, degrees above or below the path. */
export const GS_FULL_SCALE_DEG = 0.7;

/** Localizer service volume (simplified): 18 nm within 10 degrees of the course, 10 nm within 35 degrees. */
const LOC_RANGE_NM = 18;
const LOC_WIDE_RANGE_NM = 10;
/** Glideslope service volume: 10 nm within 8 degrees of the course, on the front course only. */
const GS_RANGE_NM = 10;
const GS_SECTOR_DEG = 8;

export interface GlideslopeSolution {
  /** -1..1; positive means the glideslope is above the airplane (fly up). */
  readonly needle: number;
  /** Airplane above the path, degrees (negative below). */
  readonly deviationDeg: number;
  /** Airplane height relative to the path, ft; negative below it. */
  readonly deviationFt: number;
  readonly angleDeg: number;
  /** Inside the glideslope service volume. */
  readonly valid: boolean;
  /** Full-scale deflection here, ft. */
  readonly fullScaleFt: number;
  readonly pathAltitudeFt: number;
  /** Along the course to the glideslope antenna, nm. */
  readonly distanceNm: number;
}

export interface VorSolution {
  readonly khz: number;
  /** The VOR heard, or null (flag in view, or a localizer is tuned). */
  readonly station: Navaid | null;
  /** Tuned to a localizer frequency. */
  readonly isLocalizer: boolean;
  /** Radial the airplane is on, from the station, degrees magnetic (station declination). */
  readonly radialMag: number | null;
  readonly bearingToMag: number | null;
  /** Slant range when the station has DME. */
  readonly dmeNm: number | null;
  /** Course the needle is referenced to: the OBS for a VOR, the localizer course for a localizer. */
  readonly courseMag: number;
  readonly deviationDeg: number;
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  /** The localizer received, when tuned to one inside its service volume. */
  readonly localizer?: Localizer | null;
  /** Its glideslope (ILS), when received. */
  readonly glideslope?: GlideslopeSolution | null;
  /** On the back course side of the localizer: the needle reads reversed on a CDI. */
  readonly backCourse?: boolean;
  /** Needle full scale either side, degrees: 10 for a VOR, half the course width for a localizer. */
  readonly fullScaleDeg?: number;
  /** Ground distance to the VOR or localizer antenna, nm. */
  readonly distanceNm?: number | null;
}

function noSignal(khz: number, courseMag: number, loc: boolean): VorSolution {
  return {
    khz,
    station: null,
    isLocalizer: loc,
    radialMag: null,
    bearingToMag: null,
    dmeNm: null,
    courseMag,
    deviationDeg: 0,
    needle: 0,
    toFrom: null,
    localizer: null,
    glideslope: null,
    backCourse: false,
    fullScaleDeg: loc ? 2.5 : VOR_FULL_SCALE_DEG,
    distanceNm: null,
  };
}

/** Glideslope: a path at `angleDeg` from the antenna, measured along the course. */
function glideslopeSolution(l: Localizer, courseTrue: number, pos: LatLon, altitudeFt: number): GlideslopeSolution | null {
  const gs = l.glideslope;
  if (!gs) return null;
  const off = angleDiff(bearing(gs, pos), courseTrue + 180);
  const alongNm = distanceNm(gs, pos) * Math.cos(toRad(off));
  const rangeFt = alongNm * FT_PER_NM;
  const tan = Math.tan(toRad(gs.angleDeg));
  const pathAltitudeFt = gs.elevationFt + rangeFt * tan;
  const deviationDeg = rangeFt > 1 ? toDeg(Math.atan2(altitudeFt - gs.elevationFt, rangeFt)) - gs.angleDeg : 0;
  return {
    needle: Math.min(Math.max(-deviationDeg / GS_FULL_SCALE_DEG, -1), 1),
    deviationDeg,
    deviationFt: altitudeFt - pathAltitudeFt,
    angleDeg: gs.angleDeg,
    valid: alongNm > 0.1 && alongNm <= GS_RANGE_NM && Math.abs(off) <= GS_SECTOR_DEG,
    fullScaleFt: Math.max(rangeFt * Math.tan(toRad(GS_FULL_SCALE_DEG)), 10),
    pathAltitudeFt,
    distanceNm: alongNm,
  };
}

/**
 * Localizer deviation from the published course and width: full scale at half
 * the course width. The needle is referenced to the front course, so flying
 * the back course inbound it reads reversed (reverse sensing).
 */
function localizerSolution(l: Localizer, khz: number, pos: LatLon, altitudeFt: number): VorSolution | null {
  const courseTrue = norm360(l.courseMag + l.magVar);
  const brg = bearing(l, pos);
  const d = distanceNm(l, pos);
  // Positive when left of the front course as seen flying it: fly right.
  const front = angleDiff(brg, courseTrue + 180);
  const back = Math.abs(front) > 90;
  const deviationDeg = back ? -angleDiff(brg, courseTrue) : front;
  const off = Math.abs(back ? angleDiff(brg, courseTrue) : front);
  if (!((off <= 10 && d <= LOC_RANGE_NM) || (off <= 35 && d <= LOC_WIDE_RANGE_NM))) return null;
  const half = Math.max(l.widthDeg / 2, 0.5);
  return {
    ...noSignal(khz, l.courseMag, true),
    courseMag: l.courseMag,
    deviationDeg,
    needle: Math.min(Math.max(deviationDeg / half, -1), 1),
    localizer: l,
    glideslope: back ? null : glideslopeSolution(l, courseTrue, pos, altitudeFt),
    backCourse: back,
    fullScaleDeg: half,
    distanceNm: d,
  };
}

export function vorSolution(
  db: NavDatabase,
  khz: number,
  pos: LatLon,
  altitudeFt: number,
  courseMag: number,
): VorSolution {
  const loc = isLocalizer(khz);
  if (loc) {
    const l = db.tuneLocalizer(khz, pos);
    return (l && localizerSolution(l, khz, pos, altitudeFt)) ?? noSignal(khz, courseMag, true);
  }
  const station = db.tune(khz, pos, altitudeFt);
  if (!station || station.kind !== 'vor') return noSignal(khz, courseMag, false);
  const radialTrue = bearing(station, pos);
  // VOR radials are referenced to the station's own declination, not today's local variation.
  const radialMag = norm360(radialTrue - station.magVar);
  const from = Math.abs(angleDiff(radialMag, courseMag)) <= 90;
  const reference = from ? courseMag : norm360(courseMag + 180);
  const raw = angleDiff(radialMag, reference);
  // Off to the right of the course line deflects the needle left (fly left), FROM or TO.
  const deviationDeg = from ? raw : -raw;
  const ground = distanceNm(pos, station);
  const heightNm = (altitudeFt - station.elevationFt) / FT_PER_NM;
  return {
    khz,
    station,
    isLocalizer: false,
    radialMag,
    bearingToMag: norm360(radialMag + 180),
    dmeNm: station.hasDme ? Math.hypot(ground, heightNm) : null,
    courseMag,
    deviationDeg,
    needle: Math.min(Math.max(-deviationDeg / VOR_FULL_SCALE_DEG, -1), 1),
    toFrom: from ? 'FROM' : 'TO',
    localizer: null,
    glideslope: null,
    backCourse: false,
    fullScaleDeg: VOR_FULL_SCALE_DEG,
    distanceNm: ground,
  };
}

/** What a CDI or HSI course needle shows, whatever the selected source. */
export interface CdiSolution {
  readonly source: CdiSource;
  /** "GPS", "VOR1", "LOC2", "ILS1"... */
  readonly label: string;
  /** Garmin convention: GPS magenta, VHF navigation green. */
  readonly color: 'magenta' | 'green';
  readonly courseMag: number;
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  /** No usable signal or no active leg: show the red flag. */
  readonly flag: boolean;
  /** GPS scale ("ENR", "TERM", "APR", "MAPR", "OBS") or null for VOR and localizer. */
  readonly scale: string | null;
  /** GPS full-scale deflection in nm; null for VOR (angular, 10 degrees) and localizer. */
  readonly fullScaleNm: number | null;
  readonly ident: string | null;
  readonly distanceNm: number | null;
  /** What the source is navigating with. */
  readonly kind?: 'GPS' | 'VOR' | 'LOC' | 'ILS';
  /** Angular full scale either side, degrees (VOR 10, localizer half its width); null for GPS. */
  readonly fullScaleDeg?: number | null;
  /** Flying the localizer back course: reverse sensing on a CDI (an HSI set to the front course reads normally). */
  readonly backCourse?: boolean;
}

export function cdiSolution(
  state: SimState,
  gps: GpsSolution,
  vor: readonly [VorSolution, VorSolution],
): CdiSolution {
  const source = state.nav.cdiSource;
  if (source === 'GPS') {
    const courseMag = gps.obsMode ? state.fms.obsCourseMag : gps.dtkMag ?? state.fms.obsCourseMag;
    return {
      source,
      label: 'GPS',
      color: 'magenta',
      courseMag,
      needle: gps.needle,
      toFrom: gps.toFrom,
      flag: !gps.active || gps.valid === false,
      scale: gps.obsMode ? 'OBS' : gps.scale,
      fullScaleNm: gps.fullScaleNm,
      ident: gps.to?.ident ?? null,
      distanceNm: gps.distanceNm,
      kind: 'GPS',
      fullScaleDeg: null,
      backCourse: false,
    };
  }
  const index = source === 'NAV1' ? 0 : 1;
  const v = vor[index];
  const loc = v.localizer ?? null;
  const kind = loc ? (loc.glideslope ? 'ILS' : 'LOC') : v.isLocalizer ? 'LOC' : 'VOR';
  return {
    source,
    label: `${kind}${index + 1}`,
    color: 'green',
    // A localizer's course is its own, whatever the OBS is set to.
    courseMag: loc ? loc.courseMag : state.nav.obsMag[index],
    needle: v.needle,
    toFrom: v.toFrom,
    flag: v.station === null && loc === null,
    scale: null,
    fullScaleNm: null,
    ident: loc?.ident ?? v.station?.ident ?? null,
    distanceNm: v.dmeNm,
    kind,
    fullScaleDeg: v.fullScaleDeg ?? VOR_FULL_SCALE_DEG,
    backCourse: v.backCourse ?? false,
  };
}

export interface BearingSolution {
  readonly source: BearingSource;
  /** Bearing to the station or waypoint, magnetic; null when there is nothing to point at. */
  readonly bearingMag: number | null;
  readonly ident: string | null;
  readonly distanceNm: number | null;
}

export function bearingSolution(
  source: BearingSource,
  gps: GpsSolution,
  vor: readonly [VorSolution, VorSolution],
): BearingSolution {
  switch (source) {
    case 'OFF':
      return { source, bearingMag: null, ident: null, distanceNm: null };
    case 'GPS':
      return { source, bearingMag: gps.valid === false ? null : gps.bearingMag, ident: gps.to?.ident ?? null, distanceNm: gps.distanceNm };
    case 'NAV1':
    case 'NAV2': {
      const v = vor[source === 'NAV1' ? 0 : 1];
      return { source, bearingMag: v.bearingToMag, ident: v.station?.ident ?? null, distanceNm: v.dmeNm };
    }
  }
}

/** Magnetic heading helper shared by devices. */
export function headingMag(mag: MagneticModel, state: SimState): number {
  const a = state.aircraft;
  return mag.toMagnetic(a.headingTrue, a.lat, a.lon);
}
