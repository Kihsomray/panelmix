/*
 * Aircraft systems and weather beyond the basics: failures an instructor
 * can trigger, the electrical bus and battery, winds aloft and turbulence,
 * and the indicated values instruments actually show (which differ from the
 * truth when a pitot tube is blocked or the AHRS has failed).
 */

export type EngineCondition = 'ok' | 'rough' | 'failed';

/** Everything an instructor can fail. `true` means failed. */
export interface FailureState {
  /** Vacuum pump: the analog attitude and heading indicators slowly spin down and drift. */
  readonly vacuum: boolean;
  /** Pitot tube blocked (ram and drain): the airspeed indicator acts like an altimeter. */
  readonly pitot: boolean;
  /** Static port blocked: altimeter frozen, VSI at zero, airspeed wrong with altitude change. */
  readonly static: boolean;
  /** Alternator offline: the battery carries the bus until it is flat. */
  readonly alternator: boolean;
  /** Glass attitude and heading (AHRS) lost: red X on attitude and heading. */
  readonly ahrs: boolean;
  /** Air data computer lost: red X on airspeed, altitude and vertical speed tapes. */
  readonly adc: boolean;
  /** GPS position lost (loss of integrity): GPS navigation flags. */
  readonly gps: boolean;
  readonly engine: EngineCondition;
  /** G1000 display failures (the other display reverts). */
  readonly pfdDisplay: boolean;
  readonly mfdDisplay: boolean;
}

export interface WindLayer {
  readonly altitudeFt: number;
  readonly fromTrue: number;
  readonly kt: number;
}

export type TurbulenceLevel = 0 | 1 | 2 | 3;

export interface WeatherState {
  /** Winds aloft above the surface wind (env.windFromTrue / windKt), ascending by altitude. */
  readonly windsAloft: readonly WindLayer[];
  /** 0 none, 1 light, 2 moderate, 3 severe. */
  readonly turbulence: TurbulenceLevel;
}

export interface SystemsState {
  readonly failures: FailureState;
  readonly weather: WeatherState;
  /** Battery state of charge, 0..1. */
  readonly batteryCharge: number;
  /** Seconds the engine has been running rough or failed (for sputter effects). */
  readonly engineFaultSince: number | null;
}

/** What the pitot-static instruments (or the air data computer) indicate. */
export interface AirDataDerived {
  readonly valid: boolean;
  readonly iasKt: number;
  /** Indicated altitude with the shared Kollsman setting. */
  readonly altitudeFt: number;
  readonly verticalSpeedFpm: number;
  readonly tasKt: number;
  readonly oatC: number;
}

/** What attitude and heading sources indicate (AHRS for glass, gyros for steam). */
export interface AttitudeDerived {
  readonly valid: boolean;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  readonly slip: number;
  readonly turnRateDps: number;
  readonly headingValid: boolean;
  readonly headingMag: number;
}

export interface ElectricalDerived {
  readonly busVolts: number;
  /** Battery amps, negative when discharging. */
  readonly batteryAmps: number;
  readonly batteryCharge: number;
  /** False once the battery is flat after an alternator failure: avionics without backup batteries go dark. */
  readonly avionicsPowered: boolean;
  readonly alternatorFailed: boolean;
}

export interface TerrainDerived {
  /** Ground elevation below the airplane, ft MSL; null where no terrain data is loaded. */
  readonly elevationFt: number | null;
  readonly heightAglFt: number | null;
  /** TAWS-style alerting: caution when terrain is close ahead, warning when imminent. */
  readonly alert: 'none' | 'caution' | 'warning';
}

export interface AirspaceDerived {
  /** Controlled airspace the airplane is inside (class, name), innermost first. */
  readonly inside: readonly { readonly cls: 'B' | 'C' | 'D'; readonly name: string }[];
  /** Airspace the airplane will enter within about two minutes on its current track. */
  readonly ahead: readonly { readonly cls: 'B' | 'C' | 'D'; readonly name: string; readonly minutes: number }[];
}

export interface SystemsDerived {
  readonly air: AirDataDerived;
  readonly attitude: AttitudeDerived;
  readonly electrical: ElectricalDerived;
  readonly terrain: TerrainDerived;
  readonly airspace: AirspaceDerived;
  readonly gpsValid: boolean;
  readonly engineRunning: boolean;
  /** Wind at the airplane's altitude. */
  readonly windFromTrue: number;
  readonly windKt: number;
}

/** What the systems model hands the flight model each step. */
export interface FlightEffects {
  /** Multiplier on engine power: 1 normal, about 0.6 rough, 0 failed. */
  readonly powerFactor: number;
  /** Wind at the airplane's altitude. */
  readonly windFromTrue: number;
  readonly windKt: number;
  /** Turbulence disturbances for this step. */
  readonly gustBankDeg: number;
  readonly gustVerticalFpm: number;
  readonly gustAirspeedKt: number;
  /** Ground elevation for the airplane's position (terrain or field elevation), ft MSL. */
  readonly groundElevationFt: number;
}

/** State keys that may legitimately hold null (for session restore). */
export const SYSTEMS_NULLABLE = ['engineFaultSince'] as const;
