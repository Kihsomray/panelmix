/*
 * Panel layout: how big to draw each unit. Pure, so it is tested on its own.
 *
 * Wide screens get two columns: flight instruments on the left, the
 * navigator stack (navigator, transponder, autopilot) on the right. Each
 * column is as large as the screen height allows; if the two don't fit side
 * by side they shrink together. On very short screens (a phone held
 * sideways) the height limit is dropped and the page scrolls instead, so
 * the units stay readable. Narrow screens stack everything in one column.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface LayoutInput {
  /** Width available to the panel, px. */
  readonly width: number;
  /** Height available below the header and above the sim bar, px. */
  readonly height: number;
  readonly pfd: Size;
  /** Navigator first, then transponder and autopilot if fitted. */
  readonly stack: readonly Size[];
}

export interface Layout {
  readonly columns: 1 | 2;
  /** CSS pixels per design pixel. */
  readonly pfdScale: number;
  readonly stackScale: number;
}

/** Each unit has a title bar above it. */
export const SLOT_BAR_H = 34;
export const GAP = 18;
export const TWO_COLUMN_MIN_WIDTH = 760;
/** Below this scale a unit is too small to use; drop the height limit instead. */
const MIN_USABLE_SCALE = 0.45;
const MAX_SCALE = 1.6;

export function computeLayout({ width, height, pfd, stack }: LayoutInput): Layout {
  if (width < TWO_COLUMN_MIN_WIDTH) {
    // One column: every unit as wide as the screen (each scaled on its own).
    return { columns: 1, pfdScale: Math.min(width / pfd.width, MAX_SCALE), stackScale: 0 };
  }

  const usable = width - GAP;
  const stackW = Math.max(...stack.map((s) => s.width), 1);
  const stackH = stack.reduce((sum, s) => sum + s.height, 0);
  const stackChrome = stack.length * SLOT_BAR_H + Math.max(stack.length - 1, 0) * GAP;

  // As large as the height allows...
  let pfdScale = Math.min((height - SLOT_BAR_H) / pfd.height, MAX_SCALE);
  let stackScale = Math.min((height - stackChrome) / Math.max(stackH, 1), MAX_SCALE);

  // ...unless that is unreadably small: then size by width and let the page scroll.
  if (pfdScale < MIN_USABLE_SCALE || stackScale < MIN_USABLE_SCALE) {
    const share = pfd.width / (pfd.width + stackW);
    const left = usable * Math.min(Math.max(share, 0.42), 0.62);
    return {
      columns: 2,
      pfdScale: Math.min(left / pfd.width, MAX_SCALE),
      stackScale: Math.min((usable - left) / stackW, MAX_SCALE),
    };
  }

  // Shrink both columns together if they don't fit side by side.
  const needed = pfdScale * pfd.width + stackScale * stackW;
  if (needed > usable) {
    const k = usable / needed;
    pfdScale *= k;
    stackScale *= k;
  }
  return { columns: 2, pfdScale, stackScale };
}

/** Width of a focused (enlarged) unit: fit the screen, but never smaller than fitting its width. */
export function focusWidth(unit: Size, screen: Size): number {
  const byWidth = screen.width;
  const byHeight = (screen.height / unit.height) * unit.width;
  // On short screens fitting the height would make it tiny; fit the width and scroll.
  const w = byHeight < byWidth * 0.6 ? byWidth : Math.min(byWidth, byHeight);
  return Math.max(Math.min(w, unit.width * 2), 120);
}
