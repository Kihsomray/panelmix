import type { MagneticModel } from '../../core/magvar';
import type { NavDatabase } from '../../core/navdb';
import type { ProcedureSource } from '../../core/procedures';
import type { PanelInfo } from '../../devices/types';
import type { SimCommand } from '../../sim/commands';
import type { Derived } from '../../sim/simulator';
import type { SimState } from '../../sim/types';
import type { BooleanFailure } from '../instructor/failures';
import type { ApproachLoad, StartChoice } from '../instructor/scenario';

/*
 * Guided lessons: an ordered list of steps, each a plain check over the
 * shared simulator state, so the same lesson works on every panel. Hints
 * are written per device family from the units' own procedures.
 */

/** The flight instruments, navigator, transponder and autopilot families hints are written for. */
export type PfdFamily = 'steam' | 'g5' | 'aspen' | 'g1000';
export type NavFamily = 'gns' | 'gtn' | 'g1000';
/** A GTN or the G1000 when the transponder is controlled from its screen. */
export type XpdrFamily = 'gtx345' | 'kt76a' | 'gtn' | 'g1000';
/** `gfc700`: the G1000's integrated autopilot keys; `sim`: the sim autopilot in the Fly drawer. */
export type ApFamily = 'kap140' | 'gfc500' | 'gfc700' | 'sim';

export interface PanelFamilies {
  readonly pfd: PfdFamily;
  readonly nav: NavFamily;
  readonly xpdr: XpdrFamily;
  readonly ap: ApFamily;
}

/** How to do a step, per unit. The lesson shows the lines for the units installed in the panel. */
export interface StepHints {
  readonly pfd?: Partial<Record<PfdFamily, string>>;
  readonly nav?: Partial<Record<NavFamily, string>>;
  readonly xpdr?: Partial<Record<XpdrFamily, string>>;
  readonly ap?: Partial<Record<ApFamily, string>>;
  /** Technique that applies whatever the panel. */
  readonly any?: string;
}

/** Where the airplane was when a step became current, for relative checks ("descend 500 ft"). */
export interface StepStart {
  readonly time: number;
  readonly altitudeFt: number;
  readonly headingMag: number;
  readonly lat: number;
  readonly lon: number;
}

export interface CheckContext {
  readonly state: SimState;
  readonly derived: Derived;
  readonly panel: PanelInfo;
  readonly stepStart: StepStart;
}

/** Data sources a lesson's setup and assists use beyond the live state. */
export interface LessonEnv {
  readonly db: NavDatabase;
  readonly mag: MagneticModel;
  readonly procedures: ProcedureSource | null;
  readonly panel: PanelInfo;
}

/** Text that may depend on the state (a DA from the loaded approach). */
export type Text = string | ((ctx: CheckContext) => string);

export interface LessonStep {
  readonly id: string;
  readonly title: Text;
  readonly detail?: Text;
  /** True once the pilot has done it. */
  readonly check: (ctx: CheckContext) => boolean;
  /** The check must stay true this long (simulation seconds): "within 0.3 nm for 30 s". */
  readonly holdSec?: number;
  readonly hints?: StepHints;
  /** "Do it for me": commands that complete the step (null when they can't, e.g. no procedure data). */
  readonly assist?: (ctx: CheckContext, env: LessonEnv) => readonly SimCommand[] | null;
  /** Only on panels where it applies (minimums need a PFD that has them). */
  readonly when?: (panel: PanelInfo) => boolean;
}

/** Something measured through the lesson for the debrief. Larger values are worse. */
export interface Monitor {
  readonly id: string;
  readonly label: string;
  /** The value now, or null while it doesn't apply (before the final approach, say). */
  readonly sample: (ctx: CheckContext) => number | null;
  readonly format: (v: number) => string;
  /** At or under this is good. */
  readonly limit?: number;
  /** Sampled only while one of these steps is the current one. */
  readonly during?: readonly string[];
}

/** Optional set-up before the first step, applied only if the pilot asks for it. */
export type SetupAction =
  | { readonly kind: 'commands'; readonly label: string; readonly commands: readonly SimCommand[] }
  /** On a radial (magnetic, from the station or airport) at a distance, heading toward it or on a heading. */
  | {
      readonly kind: 'position';
      readonly label: string;
      readonly from: string;
      readonly radialMag: number;
      readonly distanceNm: number;
      readonly altitudeFt: number;
      readonly headingMag: number | 'toward';
      readonly iasKt?: number;
    }
  /** Replaces the flight plan (the first leg becomes active). */
  | { readonly kind: 'plan'; readonly label: string; readonly idents: readonly string[] }
  | { readonly kind: 'directTo'; readonly label: string; readonly ident: string }
  /** An instructor-station scenario start at an approach. */
  | {
      readonly kind: 'scenario';
      readonly label: string;
      readonly airport: string;
      /** CIFP approach id ("R17") or Garmin short name ("RNAV 17"). */
      readonly approach: string;
      readonly transition: string | null;
      readonly start: StartChoice;
      readonly load: ApproachLoad;
      readonly autopilot: boolean;
      /** Leave NAV1 for the pilot to tune (default: the localizer is tuned). */
      readonly tuneLocalizer?: boolean;
    }
  /** `attitude`: the vacuum pump on a steam panel, the AHRS on glass. Delay: a random moment in [min, max] seconds. */
  | { readonly kind: 'failure'; readonly label: string; readonly failure: BooleanFailure | 'attitude'; readonly delaySec: readonly [number, number] };

export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Rough flying time at 1x, minutes. */
  readonly minutes: number;
  /** Why the lesson can't run with this database, or null. */
  readonly unavailable?: (env: LessonEnv) => string | null;
  readonly setup: readonly SetupAction[];
  readonly steps: readonly LessonStep[];
  readonly monitors?: readonly Monitor[];
  /** "Remember" points for the debrief. */
  readonly tips: readonly string[];
}
