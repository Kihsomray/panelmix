/**
 * Radio channel arithmetic, the way real tuning knobs behave: the large knob
 * steps whole MHz and the small knob steps channels, each wrapping inside its
 * own range without carrying into the other.
 *
 * Frequencies are integer kHz everywhere (118.975 MHz is 118975) so channel
 * math is exact.
 */

export interface Band {
  readonly minMhz: number;
  readonly maxMhz: number;
  /** Channel spacing in kHz. */
  readonly spacingKhz: number;
}

/** US VHF COM with 25 kHz channels: 118.000 to 136.975. */
export const COM: Band = { minMhz: 118, maxMhz: 136, spacingKhz: 25 };
/** VHF NAV, 50 kHz channels: 108.00 to 117.95. */
export const NAV: Band = { minMhz: 108, maxMhz: 117, spacingKhz: 50 };

const wrap = (value: number, min: number, max: number) => {
  const span = max - min + 1;
  return ((((value - min) % span) + span) % span) + min;
};

export function stepMhz(band: Band, khz: number, delta: number): number {
  const mhz = Math.floor(khz / 1000);
  const rest = khz - mhz * 1000;
  return wrap(mhz + delta, band.minMhz, band.maxMhz) * 1000 + rest;
}

export function stepChannel(band: Band, khz: number, delta: number): number {
  const mhz = Math.floor(khz / 1000);
  const channels = 1000 / band.spacingKhz;
  const channel = Math.round((khz - mhz * 1000) / band.spacingKhz);
  return mhz * 1000 + wrap(channel + delta, 0, channels - 1) * band.spacingKhz;
}

export function isValid(band: Band, khz: number): boolean {
  if (!Number.isInteger(khz)) return false;
  const mhz = Math.floor(khz / 1000);
  return mhz >= band.minMhz && mhz <= band.maxMhz && (khz - mhz * 1000) % band.spacingKhz === 0;
}

/** Snaps any value to the nearest legal channel in the band. */
export function snap(band: Band, khz: number): number {
  const clamped = Math.min(Math.max(khz, band.minMhz * 1000), band.maxMhz * 1000 + 1000 - band.spacingKhz);
  return Math.round(clamped / band.spacingKhz) * band.spacingKhz;
}

/** "118.975" */
export function formatCom(khz: number): string {
  return (khz / 1000).toFixed(3);
}

/** "113.50" */
export function formatNav(khz: number): string {
  return (khz / 1000).toFixed(2);
}

/** Localizers sit on 108.10 to 111.95 with an odd tenths digit. */
export function isLocalizer(khz: number): boolean {
  if (khz < 108000 || khz > 111950) return false;
  const tenths = Math.floor((khz % 1000) / 100);
  return tenths % 2 === 1;
}

/**
 * Parses keypad entry the way GTN-style keypads accept it: "11850", "118.5",
 * "1185" all mean 118.500. Returns null when the digits can't be a channel.
 */
export function parseKeypad(band: Band, digits: string): number | null {
  const clean = digits.replace(/[^0-9.]/g, '');
  if (!clean) return null;
  let mhzPart: string;
  let fracPart: string;
  if (clean.includes('.')) {
    [mhzPart = '', fracPart = ''] = clean.split('.');
  } else {
    mhzPart = clean.slice(0, 3);
    fracPart = clean.slice(3);
  }
  if (mhzPart.length !== 3) return null;
  const mhz = Number(mhzPart);
  const khz = Math.round(Number(`0.${fracPart || '0'}`) * 1000);
  const value = mhz * 1000 + khz;
  if (mhz < band.minMhz || mhz > band.maxMhz) return null;
  // Accept 118.02 as 118.025 (pilots often drop the last digit) by rounding to the channel grid.
  const snapped = Math.round(value / band.spacingKhz) * band.spacingKhz;
  return Math.abs(snapped - value) <= 5 || fracPart.length <= 2 ? snapped : null;
}
