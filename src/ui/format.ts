/*
 * Avionics data-field formatting shared by every unit, so a bearing or an
 * ETE looks the same on a GNS, a GTN and a G1000.
 */

/** Course or bearing: "005°", "360°" for north. Dashes when unknown. */
export function formatBearing(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '___°';
  const d = Math.round(((deg % 360) + 360) % 360) || 360;
  return `${String(d).padStart(3, '0')}°`;
}

/** Distance in nm: one decimal under 100, whole numbers above. */
export function formatDistance(nm: number | null | undefined): string {
  if (nm === null || nm === undefined || !Number.isFinite(nm)) return '__._';
  return nm < 99.95 ? nm.toFixed(1) : String(Math.round(nm));
}

/** Time en route: "mm:ss" under an hour, "hh:mm" beyond. Dashes when unknown. */
export function formatEte(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '__:__';
  const s = Math.max(0, Math.round(seconds));
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.round(s / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Speed in knots, whole numbers. */
export function formatSpeed(kt: number | null | undefined): string {
  return kt === null || kt === undefined || !Number.isFinite(kt) ? '___' : String(Math.round(kt));
}

/** Altitude in feet with a thousands separator. */
export function formatAltitude(ft: number): string {
  return Math.round(ft).toLocaleString('en-US');
}

/** Coordinated universal time "hh:mm:ss" from a Date. */
export function formatUtc(d: Date): string {
  return d.toISOString().slice(11, 19);
}

/** Four-digit transponder code with leading zeros. */
export function formatSquawk(code: string): string {
  return code.padStart(4, '0').slice(-4);
}
