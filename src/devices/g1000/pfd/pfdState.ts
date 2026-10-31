import type { DirectToState } from '../shared/directTo';
import type { FplCursor } from '../shared/flightPlan';
import type { Confirm, PageMenu } from '../shared/menu';
import type { ProcState } from '../shared/procedures';
import type { DmeSource } from './PfdWindows';
import { PFD_KEYS_START, type PfdKeys } from './pfdSoftkeys';
import { DEFAULT_REFERENCES, type References, type TimerRefWindow } from './timerRef';

/*
 * Everything the PFD keeps on its own screen: softkey level and settings,
 * the window open in the lower right corner (one at a time), a page menu or
 * confirmation over it, the TMR/REF references, inset map range and pointer,
 * and the DME tuning choice.
 */

export type PfdWindow =
  | { readonly kind: 'nrst'; readonly cursor: number | null; readonly scroll: number }
  | { readonly kind: 'tmrRef'; readonly w: TimerRefWindow }
  | { readonly kind: 'alerts'; readonly scroll: number }
  | { readonly kind: 'dme'; readonly choice: DmeSource }
  | { readonly kind: 'dto'; readonly dto: DirectToState; readonly planIndex: number | null }
  | { readonly kind: 'fpl'; readonly cursor: FplCursor; readonly scroll: number }
  | { readonly kind: 'proc'; readonly proc: ProcState };

export type Popup = { readonly kind: 'menu'; readonly menu: PageMenu } | { readonly kind: 'confirm'; readonly confirm: Confirm };

export interface PfdUi {
  readonly keys: PfdKeys;
  readonly window: PfdWindow | null;
  readonly popup: Popup | null;
  readonly refs: References;
  readonly insetRangeNm: number;
  /** Map pointer on the inset map (joystick pushed), offset from the map center in px. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  readonly dme: { readonly source: DmeSource; readonly holdKhz: number | null };
}

export const PFD_UI_START: PfdUi = {
  keys: PFD_KEYS_START,
  window: null,
  popup: null,
  refs: DEFAULT_REFERENCES,
  insetRangeNm: 20,
  pointer: null,
  dme: { source: 'NAV1', holdKhz: null },
};

/** Moves a list cursor that may be off (null): the first turn lands on the first item. */
export function moveListCursor(cursor: number | null, steps: number, count: number): number | null {
  if (count === 0) return null;
  if (cursor === null) return 0;
  return Math.min(Math.max(cursor + steps, 0), count - 1);
}
