/*
 * Aircraft systems and weather beyond the basics: failures an instructor
 * can trigger, the electrical bus and battery, winds aloft and turbulence,
 * and the indicated values instruments actually show (which differ from the
 * truth when a pitot tube is blocked or the AHRS has failed).
 *
 * The truth stays in `SimState.aircraft`. `SystemsDerived` is what the
 * instruments show: glass units read `air` (air data computer) and
 * `attitude` (AHRS); the analog six-pack reads `air` too (the same
 * pitot-static system feeds both), plus `vacuum` (attitude and heading
 * indicators) and `turnCoordinator` (electric).
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
  /** Altitude of the layer, ft MSL (as in a winds aloft forecast). */
  readonly altitudeFt: number;
  readonly fromTrue: number;
  readonly kt: number;
}

export type TurbulenceLevel = 0 | 1 | 2 | 3;

export interface WeatherState {
  /**
   * Winds aloft above the surface wind (env.windFromTrue / windKt), ascending by altitude. The wind
   * at the airplane is interpolated between the surface (at the ground) and the layers, and held
   * above the highest layer.
   */
  readonly windsAloft: readonly WindLayer[];
  /** 0 none, 1 light, 2 moderate, 3 severe. */
  readonly turbulence: TurbulenceLevel;
}

/** An alert already given, and when its condition was last seen, so each message is posted once. */
export interface AlertMemo {
  readonly key: string;
  readonly seenAt: number;
}

export interface SystemsState {
  readonly failures: FailureState;
  readonly weather: WeatherState;
  /** Battery state of charge, 0..1. At 0 the battery is flat and the avionics are off line. */
  readonly batteryCharge: number;
  /** Seconds the engine has been running rough or failed (for sputter effects). */
  readonly engineFaultSince: number | null;
  /** Vacuum gyro rotor speed relative to normal, 0..1: spins down over minutes without suction. */
  readonly gyroRotor: number;
  /** Sim time the vacuum was lost (seeds how the attitude indicator tumbles); null with normal suction. */
  readonly vacuumLostAt: number | null;
  /** Heading indicator error built up by a spinning-down gyro, degrees (positive: the card reads high). */
  readonly headingIndicatorErrorDeg: number;
  /** Pressure trapped by a blocked pitot tube (total pressure) or static port, inHg; null while open. */
  readonly pitotTrappedInHg: number | null;
  readonly staticTrappedInHg: number | null;
  /** Alerts already annunciated (LOW VOLTS, terrain, airspace...): not saved, so a reload repeats them. */
  readonly alerts: readonly AlertMemo[];
}

/** What the pitot-static instruments (or the air data computer) indicate. */
export interface AirDataDerived {
  /**
   * False when the air data computer has failed: glass units red-X airspeed, altitude and vertical
   * speed. The values stay meaningful because pneumatic gauges read the same tubes and ignore it.
   */
  readonly valid: boolean;
  readonly iasKt: number;
  /** Indicated altitude with the shared Kollsman setting. */
  readonly altitudeFt: number;
  /** Pressure altitude from the static source: what the altitude encoder reports (frozen with a blocked port). */
  readonly pressureAltitudeFt: number;
  readonly verticalSpeedFpm: number;
  readonly tasKt: number;
  readonly oatC: number;
}

/** What the AHRS indicates (glass attitude and heading). Analog gauges read `vacuum` and `turnCoordinator`. */
export interface AttitudeDerived {
  /** False when the AHRS has failed: red X over the attitude (and turn rate and slip). */
  readonly valid: boolean;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  readonly slip: number;
  readonly turnRateDps: number;
  /** False with a failed AHRS: red X over the heading on an HSI. */
  readonly headingValid: boolean;
  readonly headingMag: number;
}

/** The vacuum-driven attitude indicator and heading indicator (analog six-pack, G1000 standby AI). */
export interface VacuumDerived {
  /** Suction gauge, inHg: about 5 (green arc 4.5 to 5.5); 0 with a failed pump or a stopped engine. */
  readonly suctionInHg: number;
  /** How firmly the gyros hold their reference: 1 normal, falling to 0 over a few minutes without suction. */
  readonly rigidity: number;
  /** What the attitude indicator shows: the truth while rigid, tipping over as the gyro spins down. */
  readonly pitchDeg: number;
  readonly bankDeg: number;
  /**
   * Heading indicator error from a failing gyro, degrees; add it to the card. 0 with a working vacuum.
   * It stays after the vacuum returns, until the pilot realigns the card with the compass.
   */
  readonly headingErrorDeg: number;
}

/** The electric turn coordinator of the analog panel. */
export interface TurnCoordinatorDerived {
  /** False (OFF flag, airplane symbol wings level) when the bus is dead. */
  readonly powered: boolean;
  readonly turnRateDps: number;
  /** The ball is mechanical: it works without power. */
  readonly slip: number;
}

export interface ElectricalDerived {
  readonly busVolts: number;
  /** Battery amps, negative when discharging. */
  readonly batteryAmps: number;
  readonly batteryCharge: number;
  /** False once the battery is flat after an alternator failure: avionics without backup batteries go dark. */
  readonly avionicsPowered: boolean;
  readonly alternatorFailed: boolean;
  /** The alternator carries the bus: not failed, and the engine (or a windmilling propeller) turns it. */
  readonly alternatorOnline: boolean;
  /** Minutes until the battery is flat at the present load; null while the alternator carries the bus. */
  readonly batteryMinutes: number | null;
}

export type TerrainAlertLevel = 'none' | 'caution' | 'warning';

export interface TerrainDerived {
  /** Ground elevation below the airplane, ft MSL; null where no terrain data is loaded. */
  readonly elevationFt: number | null;
  readonly heightAglFt: number | null;
  /**
   * TAWS-style alerting from a one-minute look-ahead along the track and the vertical speed:
   * caution when terrain is close ahead, warning when impact is imminent. Held a few seconds so it
   * doesn't flicker.
   */
  readonly alert: TerrainAlertLevel;
  /** Alerting is inhibited near the nearest airport when low and slow, as when landing. */
  readonly suppressed: boolean;
}

export interface AirspaceDerived {
  /** Controlled airspace the airplane is inside (class, name), innermost first. */
  readonly inside: readonly { readonly cls: 'B' | 'C' | 'D'; readonly name: string }[];
  /** Airspace the airplane will enter within about two minutes on its current track. */
  readonly ahead: readonly { readonly cls: 'B' | 'C' | 'D'; readonly name: string; readonly minutes: number }[];
}

/** Annunciator panel and CAS conditions (C172S: VOLTS, VAC, OIL PRESS, L/R LOW FUEL). */
export interface AnnunciatorsDerived {
  /** Bus below 24.5 V. */
  readonly lowVolts: boolean;
  /** Suction below 3.0 inHg. */
  readonly lowVacuum: boolean;
  /** Oil pressure below 20 psi. */
  readonly oilPressure: boolean;
  /** Under 5 gallons in the tank. */
  readonly lowFuelL: boolean;
  readonly lowFuelR: boolean;
}

/** G1000 displays: 'reversionary' shows the PFD and engine indications because the other display failed. */
export type DisplayStatus = 'normal' | 'reversionary' | 'failed';

export interface SystemsDerived {
  readonly air: AirDataDerived;
  readonly attitude: AttitudeDerived;
  readonly vacuum: VacuumDerived;
  readonly turnCoordinator: TurnCoordinatorDerived;
  readonly electrical: ElectricalDerived;
  readonly terrain: TerrainDerived;
  readonly airspace: AirspaceDerived;
  readonly annunciators: AnnunciatorsDerived;
  readonly displays: { readonly pfd: DisplayStatus; readonly mfd: DisplayStatus };
  /** False with a GPS failure or when the avionics are unpowered: GPS navigation flags. */
  readonly gpsValid: boolean;
  /** False when the engine has failed or run out of fuel. */
  readonly engineRunning: boolean;
  /** Wind at the airplane's altitude. */
  readonly windFromTrue: number;
  readonly windKt: number;
}

/** What the systems model hands the flight model each step. */
export interface FlightEffects {
  /** Multiplier on engine power: 1 normal, about 0.6 rough (with surges), 0 failed. */
  readonly powerFactor: number;
  /** False when the engine has failed or run out of fuel: the propeller windmills (or stops). */
  readonly engineRunning: boolean;
  /** Wind at the airplane's altitude. */
  readonly windFromTrue: number;
  readonly windKt: number;
  /** Turbulence: bank added to the commanded bank, degrees. */
  readonly gustBankDeg: number;
  /** Turbulence: vertical gust added to the commanded vertical speed, fpm. */
  readonly gustVerticalFpm: number;
  /** Turbulence: how much the gust changes the airspeed during this step, kt (zero mean, never accumulates). */
  readonly gustAirspeedKt: number;
  /** Ground elevation for the airplane's position (terrain or field elevation), ft MSL. */
  readonly groundElevationFt: number;
  /** Electrical bus voltage and battery current, for the engine gauges. */
  readonly busVolts: number;
  readonly batteryAmps: number;
}

/** State keys that may legitimately hold null (for session restore). */
export const SYSTEMS_NULLABLE = ['engineFaultSince', 'vacuumLostAt', 'pitotTrappedInHg', 'staticTrappedInHg'] as const;
