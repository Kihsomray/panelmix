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
