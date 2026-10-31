/*
 * "Select OBS Course": three digits typed on a keypad (025 for 25 degrees),
 * or the knob stepping the value (small knob 1 degree, large knob 10).
 * Shows the current course until the pilot types.
 */

export interface CourseEntry {
  /** Digits typed so far, at most three. */
  readonly typed: string;
  /** Course shown before typing, degrees 1-360. */
  readonly base: number;
}

const toDisplay = (deg: number) => {
  const d = Math.round(((deg % 360) + 360) % 360);
  return d === 0 ? 360 : d;
};

export function startCourse(deg: number): CourseEntry {
  return { typed: '', base: toDisplay(deg) };
}

export function pressDigit(e: CourseEntry, digit: string): CourseEntry {
  if (!/^[0-9]$/.test(digit) || e.typed.length >= 3) return e;
  const next = e.typed + digit;
  // The hundreds digit can only be 0-3, and nothing above 360.
  if (Number(next.padEnd(3, '0')) > 360) return e;
  return { ...e, typed: next };
}

export function backspace(e: CourseEntry): CourseEntry {
  return e.typed ? { ...e, typed: e.typed.slice(0, -1) } : e;
}

export function stepCourse(e: CourseEntry, degrees: number): CourseEntry {
  return { typed: '', base: toDisplay(courseValue(e) + degrees) };
}

/** The course Enter sets, degrees 1-360. Partial entries read as typed ("25" is 025). */
export function courseValue(e: CourseEntry): number {
  if (!e.typed) return e.base;
  return toDisplay(Number(e.typed));
}

/** "025°" while showing a value, "02_°" while typing. */
export function courseText(e: CourseEntry): string {
  if (!e.typed) return `${String(e.base).padStart(3, '0')}°`;
  return `${e.typed.padEnd(3, '_')}°`;
}
