import { COM, NAV, parseKeypad, stepChannel, stepMhz, type Band } from '../../core/frequency';

/*
 * The GTN standby-frequency keypad ("direct tuning field").
 *
 * The field holds five digits, three before the dot and two after (a 25 kHz
 * COM channel shows as "119.52" for 119.525). As digits are typed the rest of
 * the field autofills, muted, with the first channel that starts with them.
 * A digit that no channel allows at the cursor is ignored, and because every
 * VHF frequency starts with "1" that leading digit is filled in when the
 * pilot starts with the second one: 2, 1, 5 enters 121.50.
 *
 * Pure state; the radio page renders it and the knob can tune it too.
 */

export type RadioBand = 'com' | 'nav';

export const BANDS: Record<RadioBand, Band> = { com: COM, nav: NAV };

export interface FreqEntry {
  /** Digits typed so far, without the dot ("1215"). Empty while the field shows `base`. */
  readonly typed: string;
  /** The value shown before any typing: the standby frequency, or the last knob-tuned value. kHz. */
  readonly base: number;
}

const FIELD_DIGITS = 5;

/** The five digits a GTN shows for a channel: "11952" for 119.525, "11350" for 113.50. */
export function channelDigits(khz: number): string {
  const mhz = Math.floor(khz / 1000);
  return `${mhz}${String(Math.floor((khz - mhz * 1000) / 10)).padStart(2, '0')}`;
}

/** "119.52": the five digits with the dot. */
function digitsText(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)}.${digits.slice(3)}` : digits;
}

const tables = new Map<RadioBand, readonly string[]>();

/** Every channel of the band as field digits, ascending. */
function channels(band: RadioBand): readonly string[] {
  let t = tables.get(band);
  if (!t) {
    const b = BANDS[band];
    const out: string[] = [];
    for (let khz = b.minMhz * 1000; khz < (b.maxMhz + 1) * 1000; khz += b.spacingKhz) out.push(channelDigits(khz));
    t = out;
    tables.set(band, t);
  }
  return t;
}

/** The first (lowest) channel whose digits start with `prefix`. */
function firstMatch(band: RadioBand, prefix: string): string | undefined {
  return channels(band).find((d) => d.startsWith(prefix));
}

export function startFreqEntry(base: number): FreqEntry {
  return { typed: '', base };
}

export function pressDigit(band: RadioBand, e: FreqEntry, digit: string): FreqEntry {
  if (!/^[0-9]$/.test(digit) || e.typed.length >= FIELD_DIGITS) return e;
  // Starting with anything but "1" means the pilot skipped the leading 1.
  const next = e.typed === '' && digit !== '1' ? `1${digit}` : e.typed + digit;
  return firstMatch(band, next) ? { ...e, typed: next } : e;
}

export function backspace(e: FreqEntry): FreqEntry {
  return e.typed ? { ...e, typed: e.typed.slice(0, -1) } : e;
}

/** The channel Enter or XFER loads: the autofilled match, or the base when nothing was typed. kHz. */
export function entryValue(band: RadioBand, e: FreqEntry): number {
  if (!e.typed) return e.base;
  const digits = firstMatch(band, e.typed);
  const khz = digits ? parseKeypad(BANDS[band], digits) : null;
  return khz ?? e.base;
}

/** How the field reads: the typed part and the muted autofill after it. */
export function entryDisplay(band: RadioBand, e: FreqEntry): { typed: string; fill: string; placeholder: boolean } {
  if (!e.typed) return { typed: digitsText(channelDigits(e.base)), fill: '', placeholder: true };
  const full = digitsText(firstMatch(band, e.typed) ?? e.typed);
  // The dot belongs to the typed part once a decimal digit has been typed.
  const cut = e.typed.length > 3 ? e.typed.length + 1 : e.typed.length;
  return { typed: full.slice(0, cut), fill: full.slice(cut), placeholder: false };
}

/** Knob tuning inside the panel: large knob MHz, small knob channels. Drops anything typed. */
export function tuneEntry(band: RadioBand, e: FreqEntry, knob: 'mhz' | 'khz', steps: number): FreqEntry {
  const value = entryValue(band, e);
  const b = BANDS[band];
  return { typed: '', base: knob === 'mhz' ? stepMhz(b, value, steps) : stepChannel(b, value, steps) };
}
