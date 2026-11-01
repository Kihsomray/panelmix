import { COM, isLocalizer, NAV, snap } from '../core/frequency';
import { norm360 } from '../core/geo';
import type { MagneticModel } from '../core/magvar';
import type { NavDatabase, Waypoint } from '../core/navdb';
import type { Approach } from '../core/procedures';
import { pitchForVerticalSpeed } from './flight';
import * as fms from './fms';
import { applySystemsCommand, isSystemsCommand, type SystemsCommand } from './systems/commands';
import type {
  AutopilotState,
  BearingSource,
  CdiSource,
  LateralMode,
  MessageLevel,
  SimState,
  TransponderMode,
  VerticalMode,
} from './types';

/*
 * Every change to the shared state goes through one of these commands. Devices
 * describe what the pilot did ("swap COM1", "direct-to KFDK"); the reducer
 * applies the rules the real systems follow.
 */

export type Radio = 0 | 1;

export type SimCommand =
  | { type: 'com.swap'; radio: Radio }
  | { type: 'com.setStandby'; radio: Radio; khz: number }
  | { type: 'com.setActive'; radio: Radio; khz: number }
  | { type: 'com.mic'; radio: Radio }
  | { type: 'nav.swap'; radio: Radio }
  | { type: 'nav.setStandby'; radio: Radio; khz: number }
  | { type: 'nav.setActive'; radio: Radio; khz: number }
  | { type: 'nav.ident'; radio: Radio; on: boolean }
  | { type: 'xpdr.code'; code: string }
  | { type: 'xpdr.mode'; mode: TransponderMode }
  | { type: 'xpdr.ident' }
  | { type: 'bug.heading'; mag: number }
  | { type: 'bug.altitude'; ft: number }
  | { type: 'bug.verticalSpeed'; fpm: number }
  | { type: 'bug.airspeed'; kt: number }
  | { type: 'baro.set'; inHg: number }
  | { type: 'baro.std'; on: boolean }
  | { type: 'minimums.set'; ft: number | null }
  | { type: 'cdi.source'; source: CdiSource }
  /** Steps to the next source in `sources` (the ones this panel actually has). */
  | { type: 'cdi.cycle'; sources: readonly CdiSource[] }
  | { type: 'obs.set'; radio: Radio; mag: number }
  /** Sets the selected course of whatever drives the CDI: a NAV OBS, or the GPS OBS course in OBS mode. */
  | { type: 'course.set'; mag: number }
  | { type: 'bearing.set'; pointer: 1 | 2; source: BearingSource }
  /** Direct-to a waypoint; with `courseMag`, a course to it (D-> CRS) instead of from the present position. */
  | { type: 'fms.directTo'; waypoint: Waypoint; planIndex?: number | null; courseMag?: number }
  | { type: 'fms.cancelDirectTo' }
  | { type: 'fms.activateLeg'; index: number }
  | { type: 'fms.insert'; index: number; waypoint: Waypoint }
  | { type: 'fms.remove'; index: number }
  | { type: 'fms.replacePlan'; plan: readonly Waypoint[] }
  | { type: 'fms.invert' }
  | { type: 'fms.clear' }
  | { type: 'fms.obs'; on: boolean }
  /**
   * Loads an instrument approach after the enroute plan. `activate`: just load it, activate it
   * (fly the transition from its first fix), or activate vectors to final.
   */
  | {
      type: 'fms.loadApproach';
      airport: Waypoint;
      approach: Approach;
      transition: string | null;
      activate: 'load' | 'activate' | 'vtf';
    }
  | { type: 'fms.activateApproach'; vectorsToFinal: boolean }
  | { type: 'fms.removeApproach' }
  /** Activates one leg of the loaded approach as published (flight plan "activate leg"). */
  | { type: 'fms.activateApproachLeg'; index: number }
  /** Goes straight into the missed approach from the present position ("activate missed approach"). */
  | { type: 'fms.activateMissed' }
  /** Resumes automatic sequencing after SUSP (missed approach, or out of a hold). */
  | { type: 'fms.unsuspend' }
  /** Pilot-entered hold at a waypoint. */
  | { type: 'fms.hold'; waypoint: Waypoint; inboundCourseMag: number; turn: 'L' | 'R'; legTimeMin: number | null; legNm: number | null }
  | { type: 'fms.exitHold' }
  /** Sets the GPS OBS course directly, whatever the CDI source (GTN OBS page, G1000 OBS softkey). */
  | { type: 'fms.obsCourse'; mag: number }
  | { type: 'ap.engage'; on: boolean }
  | { type: 'ap.flightDirector'; on: boolean }
  /** Selects a lateral mode. For ROL, `rollRefDeg` overrides the bank held (0 = wings level, as on a KAP 140). */
  | { type: 'ap.lateral'; mode: LateralMode; rollRefDeg?: number }
  /** Arms NAV capture (or disarms it); the current lateral mode flies until capture. */
  | { type: 'ap.armNav'; on: boolean }
  /** GPS steering on or off (G5 / Aspen GPSS with a heading-only autopilot). */
  | { type: 'ap.gpss'; on: boolean }
  | { type: 'ap.vertical'; mode: VerticalMode }
  | { type: 'ap.armAltitude'; on: boolean }
  /** Level mode (GFC 500 LVL, also the KAP 140 / GFC "blue button" recovery): wings level, zero vertical speed. */
  | { type: 'ap.level' }
  /** Arms (or disarms) glideslope / glidepath capture. */
  | { type: 'ap.armGlidepath'; on: boolean }
  /** APR: approach lateral mode (NAV with approach annunciation) and glidepath arm when a vertical path exists. */
  | { type: 'ap.approach'; on: boolean }
  /** Nose up (+1) / down (-1) wheel: changes the reference of the active vertical mode. */
  | { type: 'ap.nudge'; direction: 1 | -1 }
  | { type: 'controls.set'; roll: number; pitch: number }
  | { type: 'controls.level' }
  | { type: 'engine.throttle'; value: number }
  | { type: 'sim.pause'; paused: boolean }
  | { type: 'sim.rate'; rate: number }
  | {
      type: 'sim.reposition';
      lat: number;
      lon: number;
      altitudeFt: number;
      headingTrue: number;
      iasKt?: number;
    }
  | { type: 'sim.wind'; fromTrue: number; kt: number }
  | { type: 'sim.qnh'; inHg: number }
  | { type: 'msg.post'; text: string; level?: MessageLevel }
  | { type: 'msg.readAll' }
  | SystemsCommand;

export interface CommandContext {
  readonly mag: MagneticModel;
  /** For station declinations when loading procedures and for finding the glideslope APR arms. */
  readonly db?: NavDatabase;
}

const IDENT_SECONDS = 18;
const MAX_MESSAGES = 20;

const wrapHeading = (deg: number) => {
  const h = norm360(Math.round(deg));
  return h === 0 ? 360 : h;
};

function withMessage(state: SimState, text: string, level: MessageLevel = 'advisory'): SimState {
  const id = (state.messages[state.messages.length - 1]?.id ?? 0) + 1;
  const messages = [...state.messages, { id, text, level, at: state.time, read: false }].slice(-MAX_MESSAGES);
  return { ...state, messages };
}

function disconnect(state: SimState, reason: string): SimState {
  if (!state.ap.engaged) return state;
  return withMessage({ ...state, ap: { ...state.ap, engaged: false } }, reason, 'caution');
}

/**
 * Modes chosen when the autopilot engages with nothing selected: wings level
 * and hold pitch. With the director off there is no live selection, so any
 * arm left over from an earlier engagement is dropped too.
 */
function engageDefaults(state: SimState): AutopilotState {
  const a = state.aircraft;
  const fresh = !state.ap.flightDirector;
  return {
    ...state.ap,
    ...(fresh && { lateralArmed: null, altitudeArmed: false, verticalArmed: null, approach: false }),
    engaged: true,
    lateral: state.ap.flightDirector ? state.ap.lateral : 'ROL',
    vertical: state.ap.flightDirector ? state.ap.vertical : 'PIT',
    rollRefDeg: Math.abs(a.bankDeg) < 6 ? 0 : Math.max(Math.min(a.bankDeg, 22), -22),
    pitchRefDeg: a.pitchDeg,
    altitudeRefFt: a.altitudeFt,
  };
}

const approachContext = (state: SimState, ctx: CommandContext): fms.ApproachContext => ({
  mag: ctx.mag,
  db: ctx.db,
  time: state.time,
  aircraft: state.aircraft,
});

/**
 * Whether APR has a vertical path to arm: a coupled GPS glidepath (LPV,
 * L/VNAV) on GPS, or an ILS glideslope on the NAV receiver the CDI shows.
 */
function hasVerticalPath(state: SimState, ctx: CommandContext): boolean {
  const source = state.nav.cdiSource;
  if (source === 'GPS') return fms.hasCoupledGlidepath(state.fms);
  const khz = state.radios.nav[source === 'NAV1' ? 0 : 1].activeKhz;
  if (!isLocalizer(khz)) return false;
  // Without the database at hand, any localizer frequency may carry a glideslope.
  return ctx.db ? ctx.db.tuneLocalizer(khz, state.aircraft)?.glideslope != null : true;
}

export function applyCommand(state: SimState, cmd: SimCommand, ctx: CommandContext): SimState {
  if (isSystemsCommand(cmd)) return applySystemsCommand(state, cmd);
  const a = state.aircraft;
  const pos = { lat: a.lat, lon: a.lon };
  const setFms = (next: SimState['fms']) => ({ ...state, fms: next });

  switch (cmd.type) {
    case 'com.swap': {
      const com = [...state.radios.com] as [SimState['radios']['com'][0], SimState['radios']['com'][1]];
      const r = com[cmd.radio];
      com[cmd.radio] = { activeKhz: r.standbyKhz, standbyKhz: r.activeKhz };
      return { ...state, radios: { ...state.radios, com } };
    }
    case 'com.setStandby':
    case 'com.setActive': {
      const com = [...state.radios.com] as [SimState['radios']['com'][0], SimState['radios']['com'][1]];
      const key = cmd.type === 'com.setStandby' ? 'standbyKhz' : 'activeKhz';
      com[cmd.radio] = { ...com[cmd.radio], [key]: snap(COM, cmd.khz) };
      return { ...state, radios: { ...state.radios, com } };
    }
    case 'com.mic':
      return { ...state, radios: { ...state.radios, micCom: cmd.radio } };
    case 'nav.swap': {
      const nav = [...state.radios.nav] as [SimState['radios']['nav'][0], SimState['radios']['nav'][1]];
      const r = nav[cmd.radio];
      nav[cmd.radio] = { activeKhz: r.standbyKhz, standbyKhz: r.activeKhz };
      return { ...state, radios: { ...state.radios, nav } };
    }
    case 'nav.setStandby':
    case 'nav.setActive': {
      const nav = [...state.radios.nav] as [SimState['radios']['nav'][0], SimState['radios']['nav'][1]];
      const key = cmd.type === 'nav.setStandby' ? 'standbyKhz' : 'activeKhz';
      nav[cmd.radio] = { ...nav[cmd.radio], [key]: snap(NAV, cmd.khz) };
      return { ...state, radios: { ...state.radios, nav } };
    }
    case 'nav.ident': {
      const navIdent: [boolean, boolean] = [...state.radios.navIdent];
      navIdent[cmd.radio] = cmd.on;
      return { ...state, radios: { ...state.radios, navIdent } };
    }

    case 'xpdr.code':
      return /^[0-7]{4}$/.test(cmd.code) ? { ...state, xpdr: { ...state.xpdr, code: cmd.code } } : state;
    case 'xpdr.mode':
      return { ...state, xpdr: { ...state.xpdr, mode: cmd.mode } };
    case 'xpdr.ident':
      return state.xpdr.mode === 'OFF' || state.xpdr.mode === 'STBY'
        ? state
        : { ...state, xpdr: { ...state.xpdr, identUntil: state.time + IDENT_SECONDS } };

    case 'bug.heading':
      return { ...state, bugs: { ...state.bugs, headingMag: wrapHeading(cmd.mag) } };
    case 'bug.altitude':
      return { ...state, bugs: { ...state.bugs, altitudeFt: Math.min(Math.max(Math.round(cmd.ft), -1000), 50000) } };
    case 'bug.verticalSpeed':
      return { ...state, bugs: { ...state.bugs, verticalSpeedFpm: Math.min(Math.max(Math.round(cmd.fpm), -3000), 3000) } };
    case 'bug.airspeed':
      return { ...state, bugs: { ...state.bugs, airspeedKt: Math.min(Math.max(Math.round(cmd.kt), 50), 200) } };
    case 'baro.set':
      return {
        ...state,
        bugs: { ...state.bugs, baroInHg: Math.min(Math.max(Math.round(cmd.inHg * 100) / 100, 27.5), 31.5), baroStd: false },
      };
    case 'baro.std':
      return { ...state, bugs: { ...state.bugs, baroStd: cmd.on } };
    case 'minimums.set':
      return { ...state, bugs: { ...state.bugs, minimumsFt: cmd.ft } };

    case 'cdi.source':
      return { ...state, nav: { ...state.nav, cdiSource: cmd.source } };
    case 'cdi.cycle': {
      if (cmd.sources.length === 0) return state;
      const i = cmd.sources.indexOf(state.nav.cdiSource);
      const source = cmd.sources[(i + 1) % cmd.sources.length]!;
      return { ...state, nav: { ...state.nav, cdiSource: source } };
    }
    case 'obs.set': {
      const obsMag: [number, number] = [...state.nav.obsMag];
      obsMag[cmd.radio] = wrapHeading(cmd.mag) % 360;
      return { ...state, nav: { ...state.nav, obsMag } };
    }
    case 'course.set': {
      const source = state.nav.cdiSource;
      if (source === 'GPS') return state.fms.obsMode ? setFms(fms.setObsCourse(state.fms, cmd.mag)) : state;
      return applyCommand(state, { type: 'obs.set', radio: source === 'NAV1' ? 0 : 1, mag: cmd.mag }, ctx);
    }
    case 'bearing.set':
      return { ...state, nav: { ...state.nav, [cmd.pointer === 1 ? 'bearing1' : 'bearing2']: cmd.source } };

    case 'fms.directTo':
      return setFms(fms.directTo(state.fms, cmd.waypoint, pos, cmd.planIndex ?? null, { courseMag: cmd.courseMag, mag: ctx.mag }));
    case 'fms.cancelDirectTo':
      return setFms(fms.cancelDirectTo(state.fms, pos));
    case 'fms.activateLeg':
      return setFms(fms.activateLeg(state.fms, cmd.index, pos));
    case 'fms.insert':
      return setFms(fms.insertWaypoint(state.fms, cmd.index, cmd.waypoint, pos));
    case 'fms.remove':
      return setFms(fms.removeWaypoint(state.fms, cmd.index, pos));
    case 'fms.replacePlan':
      return setFms(fms.replacePlan(state.fms, cmd.plan, pos));
    case 'fms.invert':
      return setFms(fms.invertPlan(state.fms, pos));
    case 'fms.clear':
      return setFms(fms.clearPlan(state.fms));
    case 'fms.obsCourse':
      return setFms(fms.setObsCourse(state.fms, cmd.mag));
    case 'fms.obs': {
      // Entering OBS mode starts from the current desired track so the needle doesn't jump.
      const leg = state.fms.activeLeg;
      let course = state.fms.obsCourseMag;
      if (cmd.on && leg) {
        const gps = fms.gpsSolution(state.fms, pos, a.trackTrue, a.groundSpeedKt, ctx.mag);
        course = Math.round(gps.dtkMag ?? course);
      }
      return setFms(fms.setObsMode(state.fms, cmd.on, course));
    }

    case 'ap.engage':
      if (!cmd.on) return { ...state, ap: { ...state.ap, engaged: false } };
      return state.ap.engaged ? state : { ...state, ap: engageDefaults(state) };
    case 'ap.flightDirector': {
      if (!cmd.on && state.ap.engaged) return state; // FD stays on while the autopilot flies
      const ap = cmd.on && !state.ap.flightDirector ? { ...engageDefaults(state), engaged: false } : state.ap;
      // Turning the director off cancels its armed modes.
      const disarm = cmd.on ? {} : { lateralArmed: null, altitudeArmed: false, verticalArmed: null, approach: false };
      return { ...state, ap: { ...ap, ...disarm, flightDirector: cmd.on } };
    }
    case 'ap.lateral': {
      const ap = state.ap.engaged || state.ap.flightDirector ? state.ap : { ...engageDefaults(state), engaged: false, flightDirector: true };
      const held = Math.abs(a.bankDeg) < 6 ? 0 : Math.max(Math.min(a.bankDeg, 22), -22);
      const rollRefDeg = cmd.mode === 'ROL' ? cmd.rollRefDeg ?? held : ap.rollRefDeg;
      // Selecting NAV directly supersedes an armed capture.
      const lateralArmed = cmd.mode === 'NAV' ? null : ap.lateralArmed;
      // Leaving a captured approach (HDG or ROL instead of the localizer / GPS course) cancels it;
      // while it is only armed, HDG is the intercept heading and the arm stays.
      const leavesApproach = cmd.mode !== 'NAV' && ap.approach && ap.lateral === 'NAV';
      const approach = leavesApproach ? { approach: false, verticalArmed: null } : {};
      return { ...state, ap: { ...ap, lateral: cmd.mode, rollRefDeg, lateralArmed, ...approach } };
    }
    case 'ap.armNav':
      return { ...state, ap: { ...state.ap, lateralArmed: cmd.on ? 'NAV' : null } };
    case 'ap.gpss':
      return { ...state, ap: { ...state.ap, gpss: cmd.on } };
    case 'ap.armGlidepath':
      return { ...state, ap: { ...state.ap, verticalArmed: cmd.on ? 'GS' : null } };
    case 'ap.approach': {
      if (!cmd.on) {
        if (!state.ap.approach) return state;
        const ap = state.ap;
        // APR off: back to wings level and pitch hold if the approach modes were flying.
        return {
          ...state,
          ap: {
            ...ap,
            approach: false,
            verticalArmed: null,
            lateralArmed: null,
            lateral: ap.lateral === 'NAV' ? 'ROL' : ap.lateral,
            rollRefDeg: ap.lateral === 'NAV' ? 0 : ap.rollRefDeg,
            vertical: ap.vertical === 'GS' ? 'PIT' : ap.vertical,
            pitchRefDeg: ap.vertical === 'GS' ? a.pitchDeg : ap.pitchRefDeg,
          },
        };
      }
      const ap = state.ap.engaged || state.ap.flightDirector ? state.ap : { ...engageDefaults(state), engaged: false, flightDirector: true };
      // APR arms the approach course (it captures like NAV) and the vertical path when there is one.
      return {
        ...state,
        ap: {
          ...ap,
          approach: true,
          lateralArmed: ap.lateral === 'NAV' ? null : 'NAV',
          verticalArmed: ap.vertical === 'GS' ? null : hasVerticalPath(state, ctx) ? 'GS' : ap.verticalArmed,
        },
      };
    }
    case 'ap.vertical': {
      const ap = state.ap.engaged || state.ap.flightDirector ? state.ap : { ...engageDefaults(state), engaged: false, flightDirector: true };
      // The glideslope can't be selected, only armed: it captures when the path comes in.
      if (cmd.mode === 'GS') return state.ap.vertical === 'GS' ? state : { ...state, ap: { ...ap, verticalArmed: 'GS' } };
      const next: AutopilotState = { ...ap, vertical: cmd.mode };
      if (cmd.mode === 'ALT') return { ...state, ap: { ...next, altitudeRefFt: Math.round(a.altitudeFt / 10) * 10 } };
      if (cmd.mode === 'PIT') return { ...state, ap: { ...next, pitchRefDeg: a.pitchDeg } };
      if (cmd.mode === 'VS') {
        return { ...state, ap: next, bugs: { ...state.bugs, verticalSpeedFpm: Math.round(a.verticalSpeedFpm / 100) * 100 } };
      }
      return { ...state, ap: next, bugs: { ...state.bugs, airspeedKt: Math.round(a.iasKt) } };
    }
    case 'ap.armAltitude':
      return { ...state, ap: { ...state.ap, altitudeArmed: cmd.on } };
    case 'ap.level':
      return {
        ...state,
        ap: {
          ...state.ap,
          engaged: true,
          flightDirector: true,
          lateral: 'ROL',
          rollRefDeg: 0,
          vertical: 'VS',
          altitudeArmed: false,
          lateralArmed: null,
          verticalArmed: null,
          approach: false,
          gpss: false,
        },
        bugs: { ...state.bugs, verticalSpeedFpm: 0 },
      };
    case 'ap.nudge': {
      const ap = state.ap;
      switch (ap.vertical) {
        case 'VS':
          return applyCommand(state, { type: 'bug.verticalSpeed', fpm: state.bugs.verticalSpeedFpm + 100 * cmd.direction }, ctx);
        case 'PIT':
          return { ...state, ap: { ...ap, pitchRefDeg: Math.min(Math.max(ap.pitchRefDeg + 0.5 * cmd.direction, -15), 20) } };
        case 'ALT':
          return { ...state, ap: { ...ap, altitudeRefFt: ap.altitudeRefFt + 10 * cmd.direction } };
        case 'IAS':
          // Nose up means slower.
          return applyCommand(state, { type: 'bug.airspeed', kt: state.bugs.airspeedKt - cmd.direction }, ctx);
      }
      return state;
    }

    case 'controls.set': {
      const roll = Math.min(Math.max(cmd.roll, -1), 1);
      const pitch = Math.min(Math.max(cmd.pitch, -1), 1);
      const moved = Math.abs(roll) > 0.05 || Math.abs(pitch) > 0.05;
      const next = { ...state, controls: { roll, pitch } };
      if (!moved || !state.ap.engaged) return next;
      // Pushing on the yoke overpowers the servos: the autopilot disconnects.
      return { ...disconnect(next, 'Autopilot disconnected'), attitudeHold: { pitchDeg: a.pitchDeg, bankDeg: a.bankDeg } };
    }
    case 'controls.level': {
      const pitchDeg = pitchForVerticalSpeed(0, a.iasKt, a.tasKt, 0);
      return { ...disconnect(state, 'Autopilot disconnected'), attitudeHold: { pitchDeg, bankDeg: 0 } };
    }
    case 'engine.throttle':
      return { ...state, aircraft: { ...a, engine: { ...a.engine, throttle: Math.min(Math.max(cmd.value, 0), 1) } } };

    case 'sim.pause':
      return { ...state, paused: cmd.paused };
    case 'sim.rate':
      return { ...state, rate: Math.min(Math.max(cmd.rate, 1), 16) };
    case 'sim.reposition': {
      const ias = cmd.iasKt ?? a.iasKt;
      const aircraft = {
        ...a,
        lat: cmd.lat,
        lon: cmd.lon,
        altitudeFt: cmd.altitudeFt,
        headingTrue: norm360(cmd.headingTrue),
        trackTrue: norm360(cmd.headingTrue),
        iasKt: ias,
        tasKt: ias,
        bankDeg: 0,
        verticalSpeedFpm: 0,
        turnRateDps: 0,
      };
      const pitchDeg = pitchForVerticalSpeed(0, ias, ias, 0);
      return {
        ...state,
        aircraft: { ...aircraft, pitchDeg },
        attitudeHold: { pitchDeg, bankDeg: 0 },
        ap: { ...state.ap, altitudeRefFt: cmd.altitudeFt, rollRefDeg: 0 },
      };
    }
    case 'sim.wind':
      return { ...state, env: { ...state.env, windFromTrue: norm360(cmd.fromTrue), windKt: Math.max(cmd.kt, 0) } };
    case 'sim.qnh':
      return { ...state, env: { ...state.env, qnhInHg: cmd.inHg } };

    // Instrument procedures.
    case 'fms.loadApproach':
      return setFms(fms.loadApproach(state.fms, cmd.airport, cmd.approach, cmd.transition, cmd.activate, pos, approachContext(state, ctx)));
    case 'fms.activateApproach':
      return setFms(fms.activateApproach(state.fms, cmd.vectorsToFinal, pos, approachContext(state, ctx)));
    case 'fms.activateApproachLeg':
      return setFms(fms.activateApproachLeg(state.fms, cmd.index, pos, approachContext(state, ctx)));
    case 'fms.activateMissed':
      return setFms(fms.activateMissedApproach(state.fms, pos, approachContext(state, ctx)));
    case 'fms.removeApproach':
      return setFms(fms.removeApproach(state.fms, pos));
    case 'fms.unsuspend':
      return setFms(fms.unsuspend(state.fms, pos, approachContext(state, ctx)));
    case 'fms.hold':
      return setFms(fms.holdAt(state.fms, cmd.waypoint, cmd.inboundCourseMag, cmd.turn, cmd.legTimeMin, cmd.legNm, pos, approachContext(state, ctx)));
    case 'fms.exitHold':
      return setFms(fms.exitHold(state.fms));

    case 'msg.post':
      return withMessage(state, cmd.text, cmd.level);
    case 'msg.readAll':
      return state.messages.some((m) => !m.read)
        ? { ...state, messages: state.messages.map((m) => (m.read ? m : { ...m, read: true })) }
        : state;
  }
}
