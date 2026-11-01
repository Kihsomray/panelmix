import type { Waypoint } from '../../core/navdb';
import type { AltitudeConstraint, Approach, PathTerminator } from '../../core/procedures';

/*
 * Flight management state: the enroute flight plan, a loaded instrument
 * approach, the active leg, OBS and suspend (SUSP), and holds.
 *
 * Waypoints and procedure legs are copied into the state by value so it is
 * self-contained, serialisable and identical for every device.
 */

/** One leg of a loaded procedure, resolved for flying (ARINC 424 path and terminator). */
export interface RouteLeg {
  readonly path: PathTerminator;
  /** Terminating (or initial) fix; null for legs that end at an altitude, a heading or manually. */
  readonly to: Waypoint | null;
  /** Course or heading of the leg, degrees magnetic (hold inbound course on hold legs). */
  readonly courseMag?: number;
  readonly turn?: 'L' | 'R';
  /** Leg length (FC/FD/CD legs, hold leg length) in nm. */
  readonly distanceNm?: number;
  /** Hold leg time, minutes. */
  readonly legTimeMin?: number;
  readonly altitude?: AltitudeConstraint;
  readonly speedKt?: number;
  /** Vertical path angle on final approach legs, degrees (negative = descending). */
  readonly verticalAngleDeg?: number;
  /** Arc center and radius for RF and AF (DME arc) legs. */
  readonly arcCenter?: { readonly lat: number; readonly lon: number };
  readonly arcRadiusNm?: number;
  readonly segment: 'transition' | 'final' | 'missed';
  readonly role?: 'IAF' | 'IF' | 'FAF' | 'MAP' | 'MAHP';
  readonly flyover?: boolean;
  /** What a flight plan page shows for the leg: the fix ident, "1100ft", "INTRCPT", "MANSEQ", "HOLD". */
  readonly label: string;
  /**
   * `courseMag` in degrees true, resolved when the approach is loaded with the
   * declination the course is published against (the recommended navaid's, else
   * the local variation), so guidance never mixes magnetic models.
   */
  readonly courseTrue?: number;
  /** Recommended navaid: the DME for FD/CD/VD legs, the radial station for CR/VR legs. */
  readonly navaid?: { readonly ident: string; readonly lat: number; readonly lon: number };
  /** CR/VR legs: the radial that ends the leg, degrees true from `navaid`. */
  readonly radialTrue?: number;
}

export interface LoadedApproach {
  /** The airport the approach belongs to. */
  readonly airport: Waypoint;
  /** The procedure as published (from the CIFP), copied so the state stands alone. */
  readonly approach: Approach;
  /** Selected transition (IAF) name, or null for vectors / straight from the IF. */
  readonly transition: string | null;
  /** Legs in flying order: transition, final approach (through the MAP), missed approach. */
  readonly legs: readonly RouteLeg[];
  /** Vectors to final: the leg into the FAF on the final approach course is active. */
  readonly vectorsToFinal: boolean;
  /** Whether the approach has been activated (its legs are being flown). */
  readonly activated: boolean;
  /** The plan ended at this airport and the approach replaced it (restored when the approach is removed). */
  readonly destinationRemoved?: boolean;
}

/** A holding pattern being flown (published HM/HA/HF leg, or one entered by the pilot). */
export interface HoldState {
  readonly fix: Waypoint;
  readonly inboundCourseMag: number;
  readonly turn: 'L' | 'R';
  /** Leg length by time (minutes) or distance (nm); one of them is set. */
  readonly legTimeMin: number | null;
  readonly legNm: number | null;
  readonly entry: 'direct' | 'teardrop' | 'parallel';
  /** Where in the pattern the airplane is; the FMS state machine owns the meaning. */
  readonly phase: 'entry' | 'outbound' | 'inbound' | 'turnOutbound' | 'turnInbound';
  readonly phaseStartedAt: number;
  /** Leave the hold at the next crossing of the fix (pilot pressed "exit hold" or the leg ends). */
  readonly exitArmed: boolean;
  readonly source: 'procedure' | 'pilot';
  /*
   * Racetrack state machine details (optional so hand-built states stay valid):
   * phase 'entry' runs `entryStep` toFix -> turn (direct) or leg -> return
   * (teardrop, parallel); then turnOutbound -> outbound -> turnInbound -> inbound,
   * one circuit per inbound crossing of the fix.
   */
  /** 'toFix' while flying to the holding fix; the entry is chosen when the fix is crossed. */
  readonly entryStep?: 'toFix' | 'turn' | 'leg' | 'return';
  /** Inbound course in degrees true, fixed when the hold is set up. */
  readonly inboundCourseTrue?: number;
  /** Turn radius and straight leg length of the racetrack, nm, fixed when the entry starts. */
  readonly radiusNm?: number;
  readonly legLengthNm?: number;
  /** Inbound crossings of the fix since the entry. */
  readonly circuits?: number;
  /** HM: until exited; HF: after one circuit; HA: at the first crossing once `exitAltitudeFt` is reached. */
  readonly termination?: 'manual' | 'fix' | 'altitude';
  readonly exitAltitudeFt?: number | null;
}

/** Sub-steps of a procedure turn (PI): outbound, the 45 degree leg, the 180 degree turn, back to intercept. */
export type LegStage = 'outbound' | 'away' | 'turn' | 'back' | 'exited';

export interface ActiveLeg {
  /** Where the leg starts: a waypoint, or the present position for a direct-to. */
  readonly from: Waypoint;
  readonly to: Waypoint;
  /** Index of `to` in the enroute flight plan, or null (direct-to off the plan, or an approach leg). */
  readonly planIndex: number | null;
  readonly isDirectTo: boolean;
  /** Index into `approach.legs` while flying the approach; null on enroute legs. */
  readonly approachIndex?: number | null;
  /** D-> CRS: the course into `to`, degrees magnetic (a course line through the waypoint, not from the present position). */
  readonly courseMag?: number | null;
  /** Procedure turn progress, or 'exited' once a final hold has been left. */
  readonly stage?: LegStage;
}

export interface FmsState {
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  /** OBS mode: sequencing suspended, course set by the OBS / CRS knob. */
  readonly obsMode: boolean;
  readonly obsCourseMag: number;
  /** Time the plan or leg last changed; devices use it to reset their cursors. */
  readonly revision: number;
  /** Approach loaded into the flight plan after the enroute waypoints. */
  readonly approach: LoadedApproach | null;
  /** Automatic sequencing suspended (SUSP): reached the missed approach point, or held. */
  readonly suspended: boolean;
  readonly hold: HoldState | null;
}

/** Flight phase shown on Garmin annunciators. */
export type FlightPhase = 'DPRT' | 'TERM' | 'ENR' | 'APR' | 'MAPR';

/** The approach service level being flown, as annunciated (LPV, LNAV+V...). */
export type ApproachMode = 'LPV' | 'LP' | 'LP+V' | 'L/VNAV' | 'LNAV+V' | 'LNAV' | 'ILS' | 'LOC' | 'VOR' | 'NDB';

/** What every device can show about the approach, computed once per frame. */
export interface ApproachDerived {
  readonly airport: string;
  /** Short name for annunciators and page titles: "RNAV 17", "ILS 17", "VOR-A". */
  readonly name: string;
  readonly mode: ApproachMode | null;
  readonly phase: FlightPhase;
  readonly activated: boolean;
  readonly vectorsToFinal: boolean;
  readonly suspended: boolean;
  /** Along the route from the airplane, nm; null once passed. */
  readonly distanceToFafNm: number | null;
  readonly distanceToMapNm: number | null;
  readonly distanceToThresholdNm: number | null;
  /** Index into the loaded approach legs of the active leg, or null before it starts. */
  readonly activeLegIndex: number | null;
  /** Selected transition, null for vectors or straight from the IF. */
  readonly transition?: string | null;
  /** Indices into the loaded approach legs (null when the procedure has none). */
  readonly fafIndex?: number | null;
  readonly mapIndex?: number | null;
  readonly missedIndex?: number | null;
  /** GPS CDI full-scale deflection right now, nm (same as `derived.gps.fullScaleNm`). */
  readonly fullScaleNm?: number;
  /** The active leg is a hold, or a pilot hold is being flown. */
  readonly holding?: boolean;
}

/** Vertical deviation for VDIs and glideslope indicators. */
export interface VerticalDerived {
  /** GP = GPS glidepath (LPV, LNAV/VNAV, advisory +V), GS = ILS glideslope. */
  readonly source: 'GP' | 'GS';
  /** Advisory only (LNAV+V, LP+V): no autopilot coupling or minima. */
  readonly advisory: boolean;
  /** -1..1; positive means the path is above the airplane (fly up). */
  readonly needle: number;
  /** Airplane height relative to the path, ft; negative = below the path. */
  readonly deviationFt: number;
  readonly angleDeg: number;
  readonly valid: boolean;
  /** Full-scale deflection here, ft (angular, so it shrinks toward the runway). */
  readonly fullScaleFt?: number;
  /** Altitude of the path abeam the airplane, ft MSL. */
  readonly pathAltitudeFt?: number;
  /** Distance to the threshold (GP) or the glideslope antenna (GS) along the course, nm. */
  readonly distanceNm?: number;
}

/** Steering the FMS hands to an autopilot in NAV (and GPSS) for the active leg. */
export type FmsSteering =
  | { readonly kind: 'track'; readonly courseMag: number; readonly crossTrackNm: number }
  /** `turn` forces the direction of a large turn (hold entries, procedure turns, DF/VI legs with a published turn). */
  | { readonly kind: 'heading'; readonly headingMag: number; readonly turn?: 'L' | 'R' }
  | { readonly kind: 'arc'; readonly courseMag: number; readonly crossTrackNm: number; readonly turn: 'L' | 'R'; readonly radiusNm: number };

/** State keys that may legitimately hold null (for session restore). */
export const FMS_NULLABLE = ['activeLeg', 'approach', 'hold', 'transition', 'approachIndex'] as const;
