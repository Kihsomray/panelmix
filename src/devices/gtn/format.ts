import { formatNav } from '../../core/frequency';
import type { RadioBand } from './keypad';

/*
 * GTN text formats. With 25 kHz channel spacing (the US setting) the GTN
 * shows COM frequencies with five digits, so 119.525 reads "119.52".
 */

export function gtnCom(khz: number): string {
  const mhz = Math.floor(khz / 1000);
  return `${mhz}.${String(Math.floor((khz - mhz * 1000) / 10)).padStart(2, '0')}`;
}

export function gtnFreq(band: RadioBand, khz: number): string {
  return band === 'com' ? gtnCom(khz) : formatNav(khz);
}

/** Runway length the way the GTN lists it: "5,500FT". */
export function runwayLength(ft: number): string {
  return `${Math.round(ft).toLocaleString('en-US')}FT`;
}

/** Station declination: "11°W". */
export function declination(magVar: number): string {
  const d = Math.round(Math.abs(magVar));
  return d === 0 ? '0°' : `${d}°${magVar < 0 ? 'W' : 'E'}`;
}
