/**
 * International Standard Atmosphere, troposphere only (the trainer stays
 * below 18,000 ft). Altitudes in feet, temperatures in deg C.
 */

const LAPSE = 6.8756e-6;
export const STD_INHG = 29.92;

/** Pressure altitude: what an altimeter set to 29.92 reads. */
export function pressureAltitude(trueAltitudeFt: number, qnhInHg: number): number {
  return trueAltitudeFt + (STD_INHG - qnhInHg) * 1000;
}

/**
 * What an altimeter shows when its Kollsman window is set to `settingInHg`.
 * Setting it higher than the real pressure makes it read high ("high to low,
 * look out below").
 */
export function indicatedAltitude(trueAltitudeFt: number, qnhInHg: number, settingInHg: number): number {
  return trueAltitudeFt + (settingInHg - qnhInHg) * 1000;
}

export function outsideAirTempC(pressureAltitudeFt: number, isaDeviationC: number): number {
  return 15 - 1.9812 * (pressureAltitudeFt / 1000) + isaDeviationC;
}

/** Air density relative to sea level standard. */
export function densityRatio(pressureAltitudeFt: number, isaDeviationC: number): number {
  const theta = 1 - LAPSE * pressureAltitudeFt;
  const delta = theta ** 5.2559;
  const tempRatio = (288.15 * theta + isaDeviationC) / 288.15;
  return delta / tempRatio;
}

export function densityAltitude(pressureAltitudeFt: number, isaDeviationC: number): number {
  const sigma = densityRatio(pressureAltitudeFt, isaDeviationC);
  return (1 - sigma ** (1 / 4.2559)) / LAPSE;
}

/** True airspeed from indicated (incompressible; fine below 200 kt). */
export function trueAirspeed(iasKt: number, sigma: number): number {
  return iasKt / Math.sqrt(sigma);
}

/*
 * Pitot-static pressures, for instruments whose tubes are blocked: a blocked
 * port traps a pressure, and the instrument keeps converting whatever
 * pressures it sees into an altitude or an airspeed.
 */

const PRESSURE_EXPONENT = 5.2559;
const SPEED_OF_SOUND_SL_KT = 661.47;

/** Static pressure at a pressure altitude, inHg. */
export function staticPressureInHg(pressureAltitudeFt: number): number {
  return STD_INHG * Math.max(1 - LAPSE * pressureAltitudeFt, 0) ** PRESSURE_EXPONENT;
}

/** The pressure altitude an altimeter shows for a static pressure (inverse of `staticPressureInHg`). */
export function pressureAltitudeForInHg(staticInHg: number): number {
  return (1 - (Math.max(staticInHg, 0) / STD_INHG) ** (1 / PRESSURE_EXPONENT)) / LAPSE;
}

/** Impact pressure (pitot minus static) at a calibrated airspeed, inHg (subsonic, compressible). */
export function impactPressureInHg(casKt: number): number {
  const m = Math.max(casKt, 0) / SPEED_OF_SOUND_SL_KT;
  return STD_INHG * ((1 + 0.2 * m * m) ** 3.5 - 1);
}

/** The airspeed an indicator shows for an impact pressure, kt; zero when there is none. */
export function airspeedForImpactPressure(impactInHg: number): number {
  if (impactInHg <= 0) return 0;
  return SPEED_OF_SOUND_SL_KT * Math.sqrt(5 * ((impactInHg / STD_INHG + 1) ** (2 / 7) - 1));
}
