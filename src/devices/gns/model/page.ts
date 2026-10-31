import type { SimCommand } from '../../../sim/commands';
import { isNavKhz } from './data';
import type { DtoState, GnsCtx, GnsUi, MenuItem, Model, Step } from './types';

/*
 * What a page contributes to the reducer: its cursor stops and what the
 * knobs and keys do on them. The reducer handles everything generic
 * (cursor on/off and movement, scrolling, windows, knob entry).
 */

/** A scrolling list: `header` stops before it, `perRow` stops per row. */
export interface ListShape {
  readonly header: number;
  readonly perRow: number;
  readonly visible: number;
  readonly rows: number;
}

export interface PageLogic {
  /** Number of cursor stops; 0 when CRSR does nothing on this page. */
  stops(ui: GnsUi, ctx: GnsCtx): number;
  /** Where the cursor appears when CRSR is pushed (default the first stop). */
  first?(ui: GnsUi, ctx: GnsCtx): number;
  list?(ui: GnsUi, ctx: GnsCtx): ListShape;
  /** The page as the cursor appears (the map's panning pointer starts at the airplane). */
  cursorOn?(ui: GnsUi, ctx: GnsCtx): GnsUi;
  /** Small knob with the cursor on `stop`. */
  small?(ui: GnsUi, ctx: GnsCtx, stop: number, steps: number): Step | null;
  /** Large knob with the cursor on; by default it moves the cursor between stops. */
  large?(ui: GnsUi, ctx: GnsCtx, stop: number, steps: number): Step | null;
  ent?(ui: GnsUi, ctx: GnsCtx, stop: number): Step | null;
  /** CLR; `stop` is null with the cursor off. Null means "nothing to clear here". */
  clr?(ui: GnsUi, ctx: GnsCtx, stop: number | null): Step | null;
  /** The waypoint the D-> key picks up from this page. */
  dto?(ui: GnsUi, ctx: GnsCtx, stop: number | null): DtoState | null;
  menu?(ui: GnsUi, ctx: GnsCtx): readonly MenuItem[];
  /** RNG key; null when the page has no map. */
  range?(ui: GnsUi, delta: number): GnsUi | null;
}

export const step = (ui: GnsUi, cmds: readonly SimCommand[] = []): Step => ({ ui, cmds });

/** ENT on a frequency: COM frequencies to the COM standby, NAV ones to the VLOC standby (auto-tuning). */
export function loadStandby(khz: number): SimCommand {
  return isNavKhz(khz) ? { type: 'nav.setStandby', radio: 0, khz } : { type: 'com.setStandby', radio: 0, khz };
}

export const item = (label: string, action: MenuItem['action'], enabled = true): MenuItem => ({ label, action, enabled });

/** Rows shown at once on the list pages of each model (from the guide's screen captures). */
export const LIST_ROWS: Record<Model, { fpl: number; nrstApt: number; nrstNav: number; freq: number }> = {
  '430': { fpl: 4, nrstApt: 3, nrstNav: 5, freq: 5 },
  '530': { fpl: 6, nrstApt: 4, nrstNav: 8, freq: 8 },
};

export const clampStep = (i: number, steps: number, n: number) => Math.min(Math.max(i + steps, 0), Math.max(n - 1, 0));
