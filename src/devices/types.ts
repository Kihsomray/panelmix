import type { ComponentType } from 'preact';
import type { CdiSource } from '../sim/types';

/*
 * The contract between the panel and each avionics unit.
 *
 * A device is a Preact component drawn at a fixed design size (100 design px
 * per inch of the real bezel). It reads and changes the shared simulator
 * state through the hooks in sim/hooks.ts and keeps only its own screen
 * state (pages, cursors, menus) locally.
 */

export type Slot = 'pfd' | 'nav' | 'xpdr' | 'ap';

export interface ControlHelp {
  /** "Small right knob", "D-> key", "COM flip-flop". */
  readonly control: string;
  readonly action: string;
}

export interface DeviceSpec {
  readonly id: string;
  readonly slot: Slot;
  readonly maker: string;
  /** "GNS 430W" */
  readonly name: string;
  /** One line for the picker. */
  readonly summary: string;
  /** Bezel design size, px (100 per inch). */
  readonly width: number;
  readonly height: number;
  /** Integrated suites: the only device ids allowed in another slot. */
  readonly requires?: Partial<Record<Slot, readonly string[]>>;
  /** What the unit brings to the panel. */
  readonly provides: {
    readonly gps?: boolean;
    /** Number of VHF NAV receivers. */
    readonly nav?: 0 | 1 | 2;
    readonly com?: 0 | 1 | 2;
    /** Controls a remote transponder from its own screen (GTN, G1000). */
    readonly xpdrControl?: boolean;
    /** Has autopilot controls built into its bezel (G1000 with GFC 700). */
    readonly autopilot?: boolean;
  };
  readonly load: () => Promise<{ default: ComponentType<DeviceProps> }>;
  /** Quick reference for the help sheet. */
  readonly help: readonly ControlHelp[];
}

/** What a device knows about the rest of the panel it sits in. */
export interface PanelInfo {
  readonly pfd: string;
  readonly nav: string;
  /** A transponder id, or "integrated" when the navigator or G1000 controls it. */
  readonly xpdr: string;
  /** An autopilot id, "integrated", or "none" (sim autopilot in the drawer). */
  readonly ap: string;
  /** CDI sources this panel can select, in the order a CDI key cycles them. */
  readonly cdiSources: readonly CdiSource[];
}

export interface DeviceProps {
  readonly spec: DeviceSpec;
  readonly panel: PanelInfo;
}
