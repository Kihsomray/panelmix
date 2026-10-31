import type { JSX } from 'preact';
import type { MagneticModel } from '../../core/magvar';
import type { NavDatabase } from '../../core/navdb';
import type { SimCommand } from '../../sim/commands';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import type { PanelInfo } from '../types';
import type { GlyphName } from './icons';
import type { NearestLists } from './lookups';
import type { Model } from './model';
import type { NavAction, NavState } from './navigation';
import type { Settings, SettingsAction } from './settings';

/*
 * What every GTN page gets: the shared simulator, the unit's own screen state
 * and the ways to change either. Pages are plain functions of this, so the
 * frame can ask a page for its control-bar keys and knob behaviour before
 * drawing it.
 */

export interface Gtn {
  readonly model: Model;
  readonly panel: PanelInfo;
  readonly state: SimState;
  readonly derived: Derived;
  readonly dispatch: (cmd: SimCommand) => void;
  readonly db: NavDatabase;
  readonly mag: MagneticModel;
  readonly nav: NavState;
  readonly settings: Settings;
  readonly lists: NearestLists;
  readonly go: (a: NavAction) => void;
  readonly set: (a: SettingsAction) => void;
  /** Size of the page area, design px. */
  readonly box: { readonly w: number; readonly h: number };
  /** Wall clock for ETA and time fields. */
  readonly nowMs: number;
  /** True when the panel's transponder is controlled from this GTN. */
  readonly xpdrControl: boolean;
}

/** A key the page adds to the control bar (750Xi bottom row, 650Xi side columns). */
export interface ControlKey {
  readonly label: string;
  readonly glyph?: GlyphName | 'direct';
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Shown lit, like an active function. */
  readonly active?: boolean;
}

export interface Controls {
  /** Back by default; Cancel on data entry; hidden on Home. */
  readonly back?: 'back' | 'cancel' | 'none';
  readonly onBack?: () => void;
  readonly menu?: () => void;
  /** CDI source and OBS keys (navigation pages). */
  readonly cdiObs?: boolean;
  /** Map zoom In / Out keys. */
  readonly zoom?: boolean;
  /** Enter, Activate... on the right. */
  readonly primary?: ControlKey;
  /** A second page key, e.g. Remove on the Direct-To page. */
  readonly secondary?: ControlKey;
}

/** What the dual concentric knob does on a page (when it is not tuning a radio). */
export interface KnobBinding {
  readonly inner?: (steps: number) => void;
  readonly outer?: (steps: number) => void;
  readonly push?: () => void;
  /** Annunciator label, e.g. "Num Entry / Psh Enter". */
  readonly hint?: string;
  /** Picture next to the knob symbol in the locater: the small knob zooms or scrolls. */
  readonly innerIcon?: 'zoom' | 'scroll';
  /** Names for the touch knob dock, e.g. "MHz" / "kHz" / "Enter". */
  readonly labels?: { readonly outer: string; readonly inner: string; readonly push: string };
}

export interface PageView {
  /** Title tab at the top of the page area; none for Home and the map. */
  readonly title?: string;
  readonly body: JSX.Element;
  readonly controls: Controls;
  readonly knob: KnobBinding;
}
