import { angleDiff, bearing, distanceNm, FT_PER_NM, norm360, type LatLon } from '../core/geo';
import { isLocalizer } from '../core/frequency';
import type { MagneticModel } from '../core/magvar';
import type { NavDatabase, Navaid } from '../core/navdb';
import type { GpsSolution } from './fms';
import type { BearingSource, CdiSource, SimState } from './types';

/*
 * VHF NAV receivers and the composite course-deviation picture that every
 * CDI and HSI draws, whatever the source.
 */

/** Full-scale VOR deflection, degrees either side of the selected course. */
export const VOR_FULL_SCALE_DEG = 10;

export interface VorSolution {
  readonly khz: number;
  /** The station heard, or null (flag in view). */
  readonly station: Navaid | null;
  /** Tuned to a localizer frequency (no localizers in the trainer database, so always flagged). */
  readonly isLocalizer: boolean;
  /** Radial the airplane is on, from the station, degrees magnetic (station declination). */
  readonly radialMag: number | null;
  readonly bearingToMag: number | null;
  /** Slant range when the station has DME. */
  readonly dmeNm: number | null;
  readonly courseMag: number;
  readonly deviationDeg: number;
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
}

export function vorSolution(
  db: NavDatabase,
  khz: number,
  pos: LatLon,
  altitudeFt: number,
  courseMag: number,
): VorSolution {
  const loc = isLocalizer(khz);
  const station = loc ? null : db.tune(khz, pos, altitudeFt);
  if (!station || station.kind !== 'vor') {
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
    };
  }
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
  };
}

/** What a CDI or HSI course needle shows, whatever the selected source. */
export interface CdiSolution {
  readonly source: CdiSource;
  /** "GPS", "VOR1", "LOC2"... */
  readonly label: string;
  /** Garmin convention: GPS magenta, VHF navigation green. */
  readonly color: 'magenta' | 'green';
  readonly courseMag: number;
  readonly needle: number;
  readonly toFrom: 'TO' | 'FROM' | null;
  /** No usable signal or no active leg: show the red flag. */
  readonly flag: boolean;
  /** GPS scale ("ENR", "TERM", "OBS") or null for VOR. */
  readonly scale: string | null;
  /** GPS full-scale deflection in nm; null for VOR (angular, 10 degrees). */
  readonly fullScaleNm: number | null;
  readonly ident: string | null;
  readonly distanceNm: number | null;
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
      flag: !gps.active,
      scale: gps.obsMode ? 'OBS' : gps.scale,
      fullScaleNm: gps.fullScaleNm,
      ident: gps.to?.ident ?? null,
      distanceNm: gps.distanceNm,
    };
  }
  const index = source === 'NAV1' ? 0 : 1;
  const v = vor[index];
  return {
    source,
    label: `${v.isLocalizer ? 'LOC' : 'VOR'}${index + 1}`,
    color: 'green',
    courseMag: state.nav.obsMag[index],
    needle: v.needle,
    toFrom: v.toFrom,
    flag: v.station === null,
    scale: null,
    fullScaleNm: null,
    ident: v.station?.ident ?? null,
    distanceNm: v.dmeNm,
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
      return { source, bearingMag: gps.bearingMag, ident: gps.to?.ident ?? null, distanceNm: gps.distanceNm };
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
