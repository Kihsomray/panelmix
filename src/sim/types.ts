import type { Waypoint } from '../core/navdb';

/*
 * The one shared state every device reads. Devices never own navigation or
 * radio data: a GNS 430 and a G5 HSI show the same flight plan because they
 * both read it from here. Each device keeps only its own screen state (which
 * page is open, where the cursor is) locally.
 *
 * Units: feet, knots, feet per minute, degrees, inches of mercury, kHz.
 * "Mag" in a name means degrees magnetic, "True" degrees true.
 */

export interface EngineState {
  /** 0 idle to 1 full. */
  readonly throttle: number;
  readonly rpm: number;
  readonly fuelFlowGph: number;
  /** Left and right tank, gallons. */
  readonly fuelGal: readonly [number, number];
  readonly oilPressPsi: number;
  readonly oilTempF: number;
  readonly egtF: number;
  readonly chtF: number;
  readonly volts: number;
  readonly amps: number;
}

export interface AircraftState {
  readonly lat: number;
  readonly lon: number;
  /** True altitude above mean sea level. */
  readonly altitudeFt: number;
  readonly iasKt: number;
  readonly tasKt: number;
  readonly groundSpeedKt: number;
  readonly headingTrue: number;
  readonly trackTrue: number;
  readonly pitchDeg: number;
  /** Right wing down positive. */
  readonly bankDeg: number;
  readonly verticalSpeedFpm: number;
  /** Degrees per second, right positive. */
  readonly turnRateDps: number;
  /** Inclinometer ball, -1 (full left) to 1 (full right). */
  readonly slip: number;
  readonly engine: EngineState;
}

export interface EnvironmentState {
  readonly windFromTrue: number;
  readonly windKt: number;
  /** Actual sea-level pressure; altimeters read true altitude when set to this. */
  readonly qnhInHg: number;
  /** Deviation from the standard atmosphere, deg C. */
  readonly isaDeviationC: number;
}

export interface RadioPair {
  readonly activeKhz: number;
  readonly standbyKhz: number;
}

export interface RadioState {
  readonly com: readonly [RadioPair, RadioPair];
  readonly nav: readonly [RadioPair, RadioPair];
  /** Which COM the audio panel transmits on. */
  readonly micCom: 0 | 1;
  /** Morse ident audio on for each NAV receiver. */
  readonly navIdent: readonly [boolean, boolean];
}

export type TransponderMode = 'OFF' | 'STBY' | 'ON' | 'ALT' | 'GND';

export interface TransponderState {
  /** Four octal digits, "1200". */
  readonly code: string;
  readonly mode: TransponderMode;
  /** Sim time when the ident pulse ends, or null. */
  readonly identUntil: number | null;
}

export interface BugState {
  readonly headingMag: number;
  /** Altitude preselect / reference. */
  readonly altitudeFt: number;
  readonly verticalSpeedFpm: number;
  readonly airspeedKt: number;
  /** Kollsman window. */
  readonly baroInHg: number;
  /** Altimeter set to standard (29.92) for flight levels. */
  readonly baroStd: boolean;
  readonly minimumsFt: number | null;
}

export type CdiSource = 'GPS' | 'NAV1' | 'NAV2';
export type BearingSource = 'OFF' | 'NAV1' | 'NAV2' | 'GPS';

export interface NavSelectionState {
  /** Navigation source driving every CDI/HSI course needle. */
  readonly cdiSource: CdiSource;
  /** OBS / CRS for each NAV receiver, degrees magnetic. */
  readonly obsMag: readonly [number, number];
  readonly bearing1: BearingSource;
  readonly bearing2: BearingSource;
}

export interface ActiveLeg {
  /** Where the leg starts: a waypoint, or the present position for a direct-to. */
  readonly from: Waypoint;
  readonly to: Waypoint;
  /** Index of `to` in the flight plan, or null for a direct-to off the plan. */
  readonly planIndex: number | null;
  readonly isDirectTo: boolean;
}

export interface FmsState {
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  /** OBS mode: sequencing suspended, course set by the OBS / CRS knob. */
  readonly obsMode: boolean;
  readonly obsCourseMag: number;
  /** Time the plan or leg last changed; devices use it to reset their cursors. */
  readonly revision: number;
}

export type LateralMode = 'ROL' | 'HDG' | 'NAV';
export type VerticalMode = 'PIT' | 'ALT' | 'VS' | 'IAS';

export interface AutopilotState {
  readonly engaged: boolean;
  /** Flight director on (modes active even with the autopilot off). */
  readonly flightDirector: boolean;
  readonly lateral: LateralMode;
  readonly vertical: VerticalMode;
  /** Altitude preselect armed: captures `bugs.altitudeFt`. */
  readonly altitudeArmed: boolean;
  /** Pitch held in PIT mode. */
  readonly pitchRefDeg: number;
  /** Altitude held in ALT mode. */
  readonly altitudeRefFt: number;
  /** Bank held in ROL mode. */
  readonly rollRefDeg: number;
}

/** Hand-flying inputs from the sim yoke: rates, released to zero. */
export interface PilotControls {
  /** -1..1, right roll positive. */
  readonly roll: number;
  /** -1..1, nose up positive. */
  readonly pitch: number;
}

export type MessageLevel = 'advisory' | 'caution';

export interface SimMessage {
  readonly id: number;
  readonly text: string;
  readonly level: MessageLevel;
  readonly at: number;
  readonly read: boolean;
}

export interface SimState {
  /** Simulation seconds since the session began. */
  readonly time: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly aircraft: AircraftState;
  /** Held attitude while hand flying (the airplane is trimmed to it). */
  readonly attitudeHold: { readonly pitchDeg: number; readonly bankDeg: number };
  readonly env: EnvironmentState;
  readonly radios: RadioState;
  readonly xpdr: TransponderState;
  readonly bugs: BugState;
  readonly nav: NavSelectionState;
  readonly fms: FmsState;
  readonly ap: AutopilotState;
  readonly controls: PilotControls;
  readonly messages: readonly SimMessage[];
}
