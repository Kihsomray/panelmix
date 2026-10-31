import type { SimCommand } from '../../sim/commands';
import type { LateralMode, VerticalMode } from '../../sim/types';
import { initialAlerter, stepAlerter, type AlertLamp, type AlerterState } from './alerter';

/*
 * KAP 140 two-axis autopilot with altitude preselect (software 03/01 and
 * later), as pure functions over a small local state.
 *
 * The shared simulator flies the guidance laws (ROL, HDG, NAV, VS, ALT), the
 * NAV arm and capture (within half scale, about 2.5 of the KAP's dots) and
 * the altitude capture. This module adds what the KC 140 computer itself
 * decides: which of NAV, APR or REV the shared NAV mode stands for, the
 * display (altitude alerter, VS and baro readouts), the power-up test and the
 * disconnect flash.
 *
 * Times are real seconds (`now`), so the 3 s readouts stay readable when
 * the simulation runs faster than real time.
 */

export type KapButton = 'AP' | 'HDG' | 'NAV' | 'APR' | 'REV' | 'ALT' | 'UP' | 'DN' | 'ARM' | 'BARO' | 'BARO_HOLD';
export type CoupledMode = 'NAV' | 'APR' | 'REV';
export type BaroUnit = 'INHG' | 'HPA';

/** What the autopilot reads from the simulator. */
export interface KapView {
  readonly now: number;
  readonly engaged: boolean;
  readonly flightDirector: boolean;
  readonly lateral: LateralMode;
  readonly vertical: VerticalMode;
  readonly lateralArmed: 'NAV' | null;
  readonly altitudeArmed: boolean;
  readonly selectedAltitudeFt: number;
  readonly vsBugFpm: number;
  readonly baroInHg: number;
  readonly altitudeFt: number;
}

export interface KapState {
  /** Real time the power-up test (PFT steps, then all segments) ends. */
  readonly testEndsAt: number;
  /** After the test the baro setting flashes until the pilot confirms or sets it. */
  readonly baroPending: boolean;
  /** Which button armed or coupled the shared NAV mode. */
  readonly coupled: CoupledMode;
  /** Temporary readout replacing the selected altitude. */
  readonly show: 'VS' | 'BARO' | null;
  readonly showUntil: number;
  readonly baroUnit: BaroUnit;
  readonly apFlashUntil: number;
  readonly wasEngaged: boolean;
  readonly alerter: AlerterState;
  /**
   * UP/DN held down: the last VS step, or (`altHold`) a climb or descent
   * flown from ALT hold until the button is released.
   */
  readonly hold: { readonly lastStepAt: number; readonly altHold: boolean } | null;
}

export interface KapResult {
  readonly state: KapState;
  readonly commands: readonly SimCommand[];
}

/** Power-up test: four PFT steps, then every segment lit. */
const PFT_STEP_S = 0.6;
const PFT_STEPS = 4;
const DISPLAY_TEST_S = 1.2;
export const TEST_S = PFT_STEP_S * PFT_STEPS + DISPLAY_TEST_S;
const READOUT_S = 3;
const AP_FLASH_S = 5;
/** UP/DN held: 100 fpm steps at about 300 fpm per second. */
const VS_REPEAT_S = 1 / 3;
/** UP/DN held in ALT: the airplane is flown up or down at this rate until release. */
const ALT_HOLD_RATE_FPM = 500;
const ALT_SELECT_MAX_FT = 35000;
const HPA_PER_INHG = 33.8639;

export function initialKap(v: KapView): KapState {
  // An autopilot already flying (a restored session) skips the power-up test.
  const testing = !v.engaged;
  return {
    testEndsAt: testing ? v.now + TEST_S : v.now,
    baroPending: testing,
    coupled: 'NAV',
    show: null,
    showUntil: 0,
    baroUnit: 'INHG',
    apFlashUntil: 0,
    wasEngaged: v.engaged,
    alerter: initialAlerter(v.selectedAltitudeFt),
    hold: null,
  };
}

const result = (state: KapState, commands: readonly SimCommand[] = []): KapResult => ({ state, commands });
/** Disconnect: AP flashes for five seconds and every readout clears. */
const disconnected = (s: KapState, now: number): KapState => ({ ...s, wasEngaged: false, apFlashUntil: now + AP_FLASH_S, show: null, hold: null });
/** The disconnect also drops both arms. */
const clearArms: readonly SimCommand[] = [
  { type: 'ap.armNav', on: false },
  { type: 'ap.armAltitude', on: false },
];
/** ROL on the KAP 140 is a wing leveler, whatever the bank when it is selected. */
const wingsLevel: SimCommand = { type: 'ap.lateral', mode: 'ROL', rollRefDeg: 0 };
const showing = (s: KapState, what: 'VS' | 'BARO', now: number) => s.show === what && now < s.showUntil;
const readout = (s: KapState, show: 'VS' | 'BARO', now: number): KapState => ({ ...s, show, showUntil: now + READOUT_S });
const testing = (s: KapState, now: number) => now < s.testEndsAt;

/**
 * NAV, APR and REV share the core's NAV arm: it captures at once inside half
 * scale and otherwise arms while ROL or HDG keeps flying.
 */
function coupledPress(s: KapState, mode: CoupledMode, v: KapView): KapResult {
  const mine = s.coupled === mode;
  if (v.lateralArmed && mine) return result(s, [{ type: 'ap.armNav', on: false }]);
  if (v.lateral === 'NAV') {
    // Pressed again: back to the wing leveler. Another of the three: same course, new annunciation.
    return mine ? result(s, [wingsLevel]) : result({ ...s, coupled: mode });
  }
  return result({ ...s, coupled: mode }, [{ type: 'ap.armNav', on: true }]);
}

/**
 * A button press. `held` is true for the repeats a held UP or DN button
 * sends; the first press of a hold counts as an ordinary press.
 */
export function pressKap(s: KapState, button: KapButton, v: KapView, held = false): KapResult {
  const now = v.now;
  if (testing(s, now)) return result(s);

  if (button === 'BARO') return result(readout({ ...s, baroPending: false }, 'BARO', now));
  if (button === 'BARO_HOLD') {
    return result(readout({ ...s, baroPending: false, baroUnit: s.baroUnit === 'INHG' ? 'HPA' : 'INHG' }, 'BARO', now));
  }

  if (button === 'AP') {
    if (v.engaged) return result(disconnected(s, now), [{ type: 'ap.engage', on: false }, ...clearArms]);
    // Engages in ROL and VS, holding the vertical speed at the moment of engagement, shown for 3 s.
    return result(readout({ ...s, wasEngaged: true }, 'VS', now), [
      { type: 'ap.engage', on: true },
      wingsLevel,
      { type: 'ap.vertical', mode: 'VS' },
      ...clearArms,
    ]);
  }

  // From software 03/01 the mode buttons do nothing until the autopilot is engaged.
  if (!v.engaged) return result(s);

  switch (button) {
    case 'HDG':
      return result(s, [v.lateral === 'HDG' ? wingsLevel : { type: 'ap.lateral', mode: 'HDG' }]);
    case 'NAV':
    case 'APR':
    case 'REV':
      return coupledPress(s, button, v);
    case 'ALT':
      return v.vertical === 'ALT'
        ? result(readout(s, 'VS', now), [{ type: 'ap.vertical', mode: 'VS' }])
        : result(s, [{ type: 'ap.vertical', mode: 'ALT' }]);
    case 'ARM':
      return result(s, [{ type: 'ap.armAltitude', on: !v.altitudeArmed }]);
    case 'UP':
    case 'DN':
      return upDown(s, button === 'UP' ? 1 : -1, v, held);
  }
}

function upDown(s: KapState, dir: 1 | -1, v: KapView, held: boolean): KapResult {
  const now = v.now;
  // Already flying a held change out of ALT hold: keep going until release.
  if (s.hold?.altHold) return result(s);
  if (v.vertical === 'ALT') {
    if (!held) {
      // Each press moves the altitude hold reference 20 ft.
      return result({ ...s, hold: null }, [
        { type: 'ap.nudge', direction: dir },
        { type: 'ap.nudge', direction: dir },
      ]);
    }
    // Held: climb or descend at 500 fpm; ALT hold resumes at the altitude reached on release.
    return result({ ...s, hold: { lastStepAt: now, altHold: true } }, [
      { type: 'ap.vertical', mode: 'VS' },
      { type: 'bug.verticalSpeed', fpm: ALT_HOLD_RATE_FPM * dir },
    ]);
  }
  // VS: the first press only brings up the commanded vertical speed.
  if (!held && !showing(s, 'VS', now)) return result({ ...readout(s, 'VS', now), hold: null });
  if (held && s.hold && now - s.hold.lastStepAt < VS_REPEAT_S) return result(readout(s, 'VS', now));
  const next = { ...readout(s, 'VS', now), hold: held ? { lastStepAt: now, altHold: false } : null };
  return result(next, [{ type: 'bug.verticalSpeed', fpm: v.vsBugFpm + 100 * dir }]);
}

/** UP or DN released after a hold: ALT hold takes the altitude reached as its new reference. */
export function releaseUpDown(s: KapState, v: KapView): KapResult {
  if (!s.hold) return result(s);
  const commands: SimCommand[] = s.hold.altHold && v.engaged ? [{ type: 'ap.vertical', mode: 'ALT' }] : [];
  return result({ ...s, hold: null }, commands);
}

/** The altitude select knobs: large thousands, small hundreds. After BARO they set the baro instead. */
export function turnKapKnob(s: KapState, ring: 'outer' | 'inner', steps: number, v: KapView): KapResult {
  const now = v.now;
  if (testing(s, now)) return result(s);
  if (s.baroPending || showing(s, 'BARO', now)) {
    const inHg =
      s.baroUnit === 'INHG'
        ? v.baroInHg + steps * (ring === 'outer' ? 0.1 : 0.01)
        : (Math.round(v.baroInHg * HPA_PER_INHG) + steps * (ring === 'outer' ? 10 : 1)) / HPA_PER_INHG;
    // The shared setting has 0.01 inHg resolution.
    return result(readout({ ...s, baroPending: false }, 'BARO', now), [{ type: 'baro.set', inHg: Math.round(inHg * 100) / 100 }]);
  }
  const ft = Math.min(Math.max(v.selectedAltitudeFt + steps * (ring === 'outer' ? 1000 : 100), 0), ALT_SELECT_MAX_FT);
  const commands: SimCommand[] = [{ type: 'bug.altitude', ft }];
  // With the autopilot engaged, selecting an altitude arms its capture.
  if (v.engaged && !v.altitudeArmed) commands.push({ type: 'ap.armAltitude', on: true });
  return result({ ...s, show: null }, commands);
}

/** Called as time passes: disconnect handling, readout timeouts, the alerter. */
export function tickKap(s: KapState, v: KapView): KapResult {
  const commands: SimCommand[] = [];
  let next = s;
  // The KAP 140 drives no flight director; one left on by another autopilot goes off.
  if (v.flightDirector && !v.engaged) commands.push({ type: 'ap.flightDirector', on: false });
  if (s.wasEngaged && !v.engaged) {
    // Disconnected from outside the KAP (the yoke, or another unit).
    next = disconnected(next, v.now);
    if (v.lateralArmed || v.altitudeArmed) commands.push(...clearArms);
  } else if (s.wasEngaged !== v.engaged) {
    next = { ...next, wasEngaged: v.engaged };
  }
  const alert = stepAlerter(next.alerter, v.altitudeFt, v.selectedAltitudeFt, v.now);
  if (alert.state !== next.alerter) next = { ...next, alerter: alert.state };
  if (next.show && v.now >= next.showUntil) next = { ...next, show: null };
  return { state: next, commands };
}

// Display ----------------------------------------------------------------------------

export type KapRight =
  | { readonly kind: 'ALT'; readonly ft: number }
  | { readonly kind: 'VS'; readonly fpm: number }
  | { readonly kind: 'BARO'; readonly unit: BaroUnit; readonly value: number; readonly flash: boolean };

export interface KapDisplay {
  /** Power-up test: the PFT step (1..4), or 'segments' for the display test. */
  readonly test: number | 'segments' | null;
  readonly lateral: string;
  readonly lateralArmed: string;
  readonly vertical: string;
  readonly verticalArmed: string;
  readonly ap: 'on' | 'off' | 'flash';
  readonly right: KapRight;
  readonly alert: AlertLamp;
}

const LATERAL_TEXT: Record<LateralMode, string> = { ROL: 'ROL', HDG: 'HDG', NAV: 'NAV' };
const VERTICAL_TEXT: Record<VerticalMode, string> = { PIT: 'PIT', ALT: 'ALT', VS: 'VS', IAS: 'IAS' };

export function kapDisplay(s: KapState, v: KapView): KapDisplay {
  const now = v.now;
  if (testing(s, now)) {
    const into = now - (s.testEndsAt - TEST_S);
    const step = Math.floor(into / PFT_STEP_S) + 1;
    return {
      test: step <= PFT_STEPS ? Math.max(step, 1) : 'segments',
      lateral: '',
      lateralArmed: '',
      vertical: '',
      verticalArmed: '',
      ap: 'off',
      right: { kind: 'ALT', ft: v.selectedAltitudeFt },
      alert: 'off',
    };
  }
  const engaged = v.engaged;
  // A held UP/DN out of ALT hold flies the shared VS mode but is still ALT on the KAP.
  const altHold = engaged && s.hold?.altHold === true;
  const lateral = !engaged ? '' : v.lateral === 'NAV' ? s.coupled : LATERAL_TEXT[v.lateral];
  const vertical = !engaged ? '' : altHold ? 'ALT' : VERTICAL_TEXT[v.vertical];
  let right: KapRight = { kind: 'ALT', ft: v.selectedAltitudeFt };
  if (s.baroPending || showing(s, 'BARO', now)) {
    const value = s.baroUnit === 'INHG' ? Math.round(v.baroInHg * 100) / 100 : Math.round(v.baroInHg * HPA_PER_INHG);
    right = { kind: 'BARO', unit: s.baroUnit, value, flash: s.baroPending };
  } else if (engaged && !altHold && v.vertical === 'VS' && showing(s, 'VS', now)) {
    right = { kind: 'VS', fpm: v.vsBugFpm };
  }
  return {
    test: null,
    lateral,
    lateralArmed: engaged && v.lateralArmed ? s.coupled : '',
    vertical,
    verticalArmed: engaged && v.altitudeArmed && vertical !== 'ALT' ? 'ALT' : '',
    ap: engaged ? 'on' : now < s.apFlashUntil ? 'flash' : 'off',
    right,
    alert: stepAlerter(s.alerter, v.altitudeFt, v.selectedAltitudeFt, now).lamp,
  };
}
