import type { SimCommand } from '../../sim/commands';
import type { LateralMode, VerticalMode } from '../../sim/types';

/*
 * GMC 507 mode controller for the GFC 500, as pure functions.
 *
 * The shared simulator has the generic modes (ROL, HDG, NAV / PIT, ALT, VS,
 * IAS) and the flight director. This module maps the GMC 507 keys onto them
 * and remembers what the shared state cannot say:
 *   - TRK flies the shared HDG mode on the current ground track (there is no
 *     separate track bug in the trainer);
 *   - NAV and APR both use the shared NAV mode and its arm (captured within
 *     half scale, one dot of two on the G5); there are no approach glidepaths
 *     in the trainer database;
 *   - LVL is the shared level command (wings level, zero vertical speed);
 *   - VNAV arms but never captures (the navigators publish no descent
 *     profile);
 *   - YD has no effect on the always-coordinated flight model.
 * Altitude capture (ALTS) arms automatically with PIT, VS and IAS, as on the
 * real system.
 */

export type GmcKey = 'AP' | 'FD' | 'YD' | 'LVL' | 'HDG' | 'TRK' | 'NAV' | 'APR' | 'VNAV' | 'ALT' | 'VS' | 'IAS';
export type CoupledKey = 'NAV' | 'APR';

export interface GmcView {
  readonly engaged: boolean;
  readonly flightDirector: boolean;
  readonly lateral: LateralMode;
  readonly vertical: VerticalMode;
  readonly lateralArmed: 'NAV' | null;
  readonly altitudeArmed: boolean;
  readonly altitudeRefFt: number;
  readonly headingMag: number;
  readonly trackMag: number;
  readonly altitudeFt: number;
  /** The CDI has no course to fly (flag in view). */
  readonly cdiFlag: boolean;
}

export interface GmcState {
  readonly yawDamper: boolean;
  /** The shared HDG mode was selected with the TRK key. */
  readonly track: boolean;
  /** Which key armed or selected the shared NAV mode. */
  readonly coupled: CoupledKey;
  readonly vnavArmed: boolean;
  /** LVL mode per axis: it lasts until a mode on that axis is selected. */
  readonly levelLateral: boolean;
  readonly levelVertical: boolean;
  /** Altitude reference when ALT hold began: the wheel may move it 200 ft at most. */
  readonly altBaseFt: number | null;
  readonly wasActive: boolean;
}

export interface GmcResult {
  readonly state: GmcState;
  readonly commands: readonly SimCommand[];
}

/** The wheel moves the ALT reference by at most this much. */
const WHEEL_ALT_LIMIT_FT = 200;

export function initialGmc(v: GmcView): GmcState {
  return {
    yawDamper: v.engaged,
    track: false,
    coupled: 'NAV',
    vnavArmed: false,
    levelLateral: false,
    levelVertical: false,
    altBaseFt: v.vertical === 'ALT' ? v.altitudeRefFt : null,
    wasActive: v.engaged || v.flightDirector,
  };
}

const active = (v: GmcView) => v.engaged || v.flightDirector;
const result = (state: GmcState, commands: readonly SimCommand[] = []): GmcResult => ({ state, commands });

/** Turns the flight director on in the default ROL and PIT modes when it is off. */
const fdOn = (v: GmcView): SimCommand[] => (active(v) ? [] : [{ type: 'ap.flightDirector', on: true }]);
const armAlts: SimCommand = { type: 'ap.armAltitude', on: true };

function vertical(s: GmcState, mode: VerticalMode, v: GmcView): GmcResult {
  const on = active(v) && v.vertical === mode && !s.levelVertical;
  // Mode keys are alternate action: pressing the active one returns to the default, PIT.
  const target: VerticalMode = on ? 'PIT' : mode;
  const commands: SimCommand[] = [{ type: 'ap.vertical', mode: target }];
  commands.push(target === 'ALT' ? { type: 'ap.armAltitude', on: false } : armAlts);
  return result({ ...s, levelVertical: false, altBaseFt: target === 'ALT' ? null : s.altBaseFt }, commands);
}

function lateralHeading(s: GmcState, track: boolean, v: GmcView): GmcResult {
  const on = active(v) && v.lateral === 'HDG' && s.track === track && !s.levelLateral;
  if (on) return result({ ...s, levelLateral: false }, [{ type: 'ap.lateral', mode: 'ROL' }]);
  const commands: SimCommand[] = [];
  // TRK: the heading bug takes the current ground track, which the shared HDG mode then flies.
  if (track) commands.push({ type: 'bug.heading', mag: Math.round(v.trackMag) });
  commands.push({ type: 'ap.lateral', mode: 'HDG' });
  if (!active(v)) commands.push(armAlts);
  return result({ ...s, track, levelLateral: false }, commands);
}

/**
 * NAV and APR arm the core's NAV capture: inside one dot it captures at once,
 * otherwise the current lateral mode flies until the needle comes in.
 */
function coupledKey(s: GmcState, key: CoupledKey, v: GmcView): GmcResult {
  const mine = s.coupled === key;
  if (active(v) && v.lateralArmed && mine) return result(s, [{ type: 'ap.armNav', on: false }]);
  if (active(v) && v.lateral === 'NAV' && !s.levelLateral) {
    // Pressed again: back to ROL. The other key: same course, its own annunciator.
    return mine ? result(s, [{ type: 'ap.lateral', mode: 'ROL' }]) : result({ ...s, coupled: key });
  }
  // The flight director only comes on for NAV or APR when there is a course to fly.
  if (!active(v) && v.cdiFlag) return result(s);
  return result({ ...s, coupled: key }, [...fdOn(v), ...(active(v) ? [] : [armAlts]), { type: 'ap.armNav', on: true }]);
}

export function pressGmc(s: GmcState, key: GmcKey, v: GmcView): GmcResult {
  switch (key) {
    case 'AP':
      if (v.engaged) return result(s, [{ type: 'ap.engage', on: false }]);
      // Engaging turns the flight director on (default ROL and PIT) and, if installed, the yaw damper.
      return result({ ...s, yawDamper: true }, [
        ...fdOn(v),
        { type: 'ap.engage', on: true },
        ...(active(v) && v.vertical === 'ALT' ? [] : [armAlts]),
      ]);
    case 'FD':
      // Disabled while the autopilot is engaged.
      if (v.engaged) return result(s);
      return v.flightDirector
        ? result(s, [
            { type: 'ap.flightDirector', on: false },
            { type: 'ap.armAltitude', on: false },
            { type: 'ap.armNav', on: false },
          ])
        : result(s, [{ type: 'ap.flightDirector', on: true }, armAlts]);
    case 'YD':
      return result({ ...s, yawDamper: !s.yawDamper });
    case 'LVL':
      // Cancels every armed and active mode (the core clears its arms) and engages the autopilot in level mode.
      return result({ ...s, yawDamper: true, levelLateral: true, levelVertical: true, vnavArmed: false, track: false }, [
        { type: 'ap.level' },
      ]);
    case 'HDG':
      return lateralHeading(s, false, v);
    case 'TRK':
      return lateralHeading(s, true, v);
    case 'NAV':
    case 'APR':
      return coupledKey(s, key, v);
    case 'VNAV':
      // Without vertical profile data the key cannot turn the flight director on.
      if (!active(v)) return result(s);
      return result({ ...s, vnavArmed: !s.vnavArmed });
    case 'ALT':
      return vertical(s, 'ALT', v);
    case 'VS':
      return vertical(s, 'VS', v);
    case 'IAS':
      return vertical(s, 'IAS', v);
  }
}

/** NOSE UP (+1) / DN (-1) wheel, one detent. */
export function rollWheel(s: GmcState, direction: 1 | -1, v: GmcView): GmcResult {
  if (!active(v) || s.levelVertical) return result(s);
  if (v.vertical === 'ALT') {
    const base = s.altBaseFt ?? v.altitudeRefFt;
    const next = v.altitudeRefFt + 10 * direction;
    if (Math.abs(next - base) > WHEEL_ALT_LIMIT_FT) return result({ ...s, altBaseFt: base });
    return result({ ...s, altBaseFt: base }, [{ type: 'ap.nudge', direction }]);
  }
  return result(s, [{ type: 'ap.nudge', direction }]);
}

/** HDG/TRK knob pushed: the bug syncs to the current heading (or ground track in TRK). */
export function syncHeading(s: GmcState, v: GmcView): SimCommand {
  const track = v.lateral === 'HDG' && s.track && active(v);
  return { type: 'bug.heading', mag: Math.round(track ? v.trackMag : v.headingMag) };
}

/** ALT SEL knob pushed: the selected altitude syncs to the current altitude. */
export function syncAltitude(v: GmcView): SimCommand {
  return { type: 'bug.altitude', ft: Math.round(v.altitudeFt / 10) * 10 };
}

/** Called as time passes: mode memory when the director goes off or NAV captures. */
export function tickGmc(s: GmcState, v: GmcView): GmcState {
  const isActive = active(v);
  let next = s;
  if (!isActive && s.wasActive) {
    next = { ...next, vnavArmed: false, levelLateral: false, levelVertical: false, track: false, altBaseFt: null };
  }
  if (isActive !== s.wasActive) next = { ...next, wasActive: isActive };
  // A NAV capture by the core ends LVL on the lateral axis.
  if (next.levelLateral && v.lateral === 'NAV') next = { ...next, levelLateral: false };
  // Leaving ALT forgets the wheel's reference base; an automatic capture starts a new one.
  if (v.vertical !== 'ALT' && next.altBaseFt !== null) next = { ...next, altBaseFt: null };
  return next;
}

/** Annunciator light above each key: lit while its function is selected. */
export function gmcLeds(s: GmcState, v: GmcView): Record<GmcKey, boolean> {
  const on = active(v);
  const lat = (mode: LateralMode) => on && v.lateral === mode && !s.levelLateral;
  const vert = (mode: VerticalMode) => on && v.vertical === mode && !s.levelVertical;
  return {
    AP: v.engaged,
    FD: v.flightDirector,
    YD: s.yawDamper,
    LVL: on && (s.levelLateral || s.levelVertical),
    HDG: lat('HDG') && !s.track,
    TRK: lat('HDG') && s.track,
    NAV: s.coupled === 'NAV' && (lat('NAV') || (on && v.lateralArmed !== null)),
    APR: s.coupled === 'APR' && (lat('NAV') || (on && v.lateralArmed !== null)),
    VNAV: on && s.vnavArmed,
    ALT: vert('ALT'),
    VS: vert('VS'),
    IAS: vert('IAS'),
  };
}
