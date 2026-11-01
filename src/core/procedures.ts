/*
 * Instrument procedures from the FAA CIFP (ARINC 424): approaches,
 * departures (SIDs) and arrivals (STARs), one JSON file per airport under
 * public/data/proc/, loaded on demand. Built by scripts/build-cifp.mjs.
 *
 * Courses are degrees magnetic, distances nm, altitudes ft MSL.
 */

/** ARINC 424 path and terminator. */
export type PathTerminator =
  | 'IF' | 'TF' | 'CF' | 'DF' | 'FA' | 'FC' | 'FD' | 'FM' | 'CA' | 'CD' | 'CI' | 'CR'
  | 'RF' | 'AF' | 'VA' | 'VD' | 'VI' | 'VM' | 'VR' | 'PI' | 'HA' | 'HF' | 'HM';

export type AltitudeConstraint =
  | { readonly kind: 'at'; readonly ft: number }
  | { readonly kind: 'atOrAbove'; readonly ft: number }
  | { readonly kind: 'atOrBelow'; readonly ft: number }
  /** Between two altitudes (ARINC "B"). */
  | { readonly kind: 'between'; readonly aboveFt: number; readonly belowFt: number }
  /** Glide slope intercept altitude on ILS finals (ARINC "G"/"H"/"I"/"J"): `ft` is the intercept altitude. */
  | { readonly kind: 'glideslope'; readonly ft: number };

export interface ProcFix {
  readonly ident: string;
  readonly lat: number;
  readonly lon: number;
  readonly kind: 'fix' | 'vor' | 'ndb' | 'runway' | 'airport' | 'loc';
}

export interface ProcLeg {
  readonly path: PathTerminator;
  readonly fix?: ProcFix;
  readonly turn?: 'L' | 'R';
  /** Leg course, heading (V* legs) or hold inbound course. */
  readonly courseMag?: number;
  /** FC/FD/CD leg length or hold leg length. */
  readonly distanceNm?: number;
  /** Hold leg time. */
  readonly legTimeMin?: number;
  readonly altitude?: AltitudeConstraint;
  readonly speedKt?: number;
  /** Final approach vertical path angle, negative (e.g. -3.0). */
  readonly verticalAngleDeg?: number;
  /** RF / AF arc center and radius. */
  readonly arcCenter?: { readonly lat: number; readonly lon: number };
  readonly arcRadiusNm?: number;
  /** Recommended navaid for theta/rho (AF arcs, CF legs on VOR radials, FD legs). */
  readonly recommendedNavaid?: ProcFix;
  readonly thetaDeg?: number;
  readonly rhoNm?: number;
  readonly iaf?: boolean;
  readonly if?: boolean;
  readonly faf?: boolean;
  readonly map?: boolean;
  readonly flyover?: boolean;
}

export interface ProcTransition {
  /** IAF / feeder name ("MRB"), or "RW17" for SID runway transitions. */
  readonly name: string;
  readonly legs: readonly ProcLeg[];
}

export type ApproachType =
  | 'RNAV' | 'RNP' | 'GPS' | 'ILS' | 'LOC' | 'LOC BC' | 'LDA' | 'SDF' | 'VOR' | 'VOR/DME'
  | 'NDB' | 'NDB/DME' | 'TACAN' | 'GLS' | 'IGS';

export type ApproachMinima = 'LPV' | 'LP' | 'LNAV/VNAV' | 'LNAV';

export interface FinalApproachPath {
  /** Landing threshold point. */
  readonly thresholdLat: number;
  readonly thresholdLon: number;
  readonly thresholdElevationFt: number;
  /** Threshold crossing height. */
  readonly tchFt: number;
  /** Glidepath angle, positive degrees (e.g. 3.0). */
  readonly angleDeg: number;
  /** Final approach course, degrees magnetic. */
  readonly courseMag: number;
}

export interface Approach {
  /** CIFP identifier: "R17", "I16L", "VDMA". Unique within the airport. */
  readonly id: string;
  readonly type: ApproachType;
  /** Chart-style name: "RNAV (GPS) RWY 17", "ILS RWY 16L", "VOR-A". */
  readonly name: string;
  /** "17", "16L"; null for circling-only approaches. */
  readonly runway: string | null;
  /** Lines of minima published (RNAV approaches). */
  readonly minima: readonly ApproachMinima[];
  readonly transitions: readonly ProcTransition[];
  /** From the IF (or FACF) through the missed approach point. */
  readonly final: readonly ProcLeg[];
  readonly missed: readonly ProcLeg[];
  /** Localizer / ILS identifier for ILS, LOC, LDA and SDF approaches ("IJYO"). */
  readonly localizer?: string;
  /** Vertical path for GPS vertical guidance (LPV, LNAV/VNAV, +V), or the ILS glidepath. */
  readonly path?: FinalApproachPath;
}

export interface TerminalProcedure {
  readonly id: string;
  readonly kind: 'SID' | 'STAR';
  /** "LEESBURG FOUR" style names are not in the CIFP; this is the identifier, e.g. "JCOBY4". */
  readonly name: string;
  readonly runwayTransitions: readonly ProcTransition[];
  readonly common: readonly ProcLeg[];
  readonly enrouteTransitions: readonly ProcTransition[];
}

export interface RunwayThreshold {
  /** "17", "16L" */
  readonly ident: string;
  readonly lat: number;
  readonly lon: number;
  readonly elevationFt: number;
  readonly tchFt: number | null;
  readonly courseMag: number | null;
  readonly lengthFt: number | null;
}

export interface AirportProcedures {
  readonly v: 1;
  readonly airport: string;
  readonly cycle: string;
  readonly runways: readonly RunwayThreshold[];
  readonly approaches: readonly Approach[];
  readonly departures: readonly TerminalProcedure[];
  readonly arrivals: readonly TerminalProcedure[];
}

/** Loads per-airport procedure files on demand and caches them. */
export interface ProcedureSource {
  /** Whether the database has procedures for this airport (from the index; synchronous). */
  has(airport: string): boolean;
  /** Cached result: undefined while not loaded yet, null when the airport has none. */
  get(airport: string): AirportProcedures | null | undefined;
  load(airport: string): Promise<AirportProcedures | null>;
  /** Calls `listener` whenever another airport's file finishes loading. */
  subscribe(listener: () => void): () => void;
  readonly cycle: string;
}

/** Display name Garmin units use in lists: "RNAV 17", "ILS 16L", "VOR-A". */
export function shortApproachName(a: Approach): string {
  const type = a.type === 'GPS' ? 'RNAV' : a.type;
  if (!a.runway) {
    const letter = a.id.match(/-?([A-Z])$/)?.[1] ?? '';
    return `${type}${letter ? `-${letter}` : ''}`;
  }
  // Charted letter suffixes (W, X, Y, Z...) tell apart approaches to the same runway.
  const suffix = a.id.match(/-([A-Z])$/)?.[1];
  return `${type}${suffix ? ` ${suffix}` : ''} ${a.runway}`;
}
