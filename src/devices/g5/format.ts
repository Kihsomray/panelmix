/*
 * Number formats as the G5 prints them: headings with three digits and a
 * degree sign, altitudes without separators, signed vertical speeds.
 */

/** 0..360 with 360 for north, as every Garmin heading readout shows it. */
export function wrapHeading(deg: number): number {
  const d = Math.round(((deg % 360) + 360) % 360);
  return d === 0 ? 360 : d;
}

/** "065°" */
export function headingText(deg: number): string {
  return `${String(wrapHeading(deg)).padStart(3, '0')}°`;
}

/** Selected altitude "5000", or "-200". */
export function altitudeText(ft: number): string {
  return String(Math.round(ft));
}

/** Vertical speed reference "+500", "-700", "0". */
export function signedText(value: number): string {
  const v = Math.round(value);
  return v > 0 ? `+${v}` : String(v);
}

/** Barometric setting "29.92". */
export function baroText(inHg: number): string {
  return inHg.toFixed(2);
}

/** Celsius to whole degrees Fahrenheit. */
export function fahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

/**
 * Standard-rate bank angle for a true airspeed: the bank that turns at 3
 * degrees per second. The G5 marks it with green triangles on the roll scale.
 */
export function standardRateBankDeg(tasKt: number): number {
  const v = (Math.max(tasKt, 0) * 6076.12) / 3600; // ft/s
  const omega = (3 * Math.PI) / 180;
  return (Math.atan((v * omega) / 32.174) * 180) / Math.PI;
}

/**
 * Next selected altitude for a knob turn: steps of 100 ft, and an odd value
 * (after a sync to the current altitude) first snaps to the hundred in the
 * direction of the turn.
 */
export function stepAltitude(ft: number, steps: number): number {
  if (steps === 0) return ft;
  const base = steps > 0 ? Math.floor(ft / 100) * 100 : Math.ceil(ft / 100) * 100;
  return base + steps * 100;
}
