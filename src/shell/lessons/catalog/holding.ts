import { bearing } from '../../../core/geo';
import { NavDatabase } from '../../../core/navdb';
import { formatAltitude } from '../../../ui/format';
import { holdEntry } from '../../instructor/scenario';
import * as c from '../checks';
import type { CheckContext, Lesson, Monitor } from '../types';
import { KJYO_THRESHOLD_FT, kjyoUnavailable } from './approaches';

/*
 * Holding: the published missed approach hold of the KJYO RNAV 17 at KORNY,
 * and a hold ATC assigns at the Martinsburg VORTAC, entered by the pilot.
 */

/** KORNY, the RNAV 17 missed approach holding fix (CIFP terminal waypoint N39 13 44.08, W077 50 02.26). */
const KORNY = { lat: 39.228911, lon: -77.833961 };
/** Martinsburg VORTAC. */
const MRB = { lat: 39.3856, lon: -77.8484 };

/** "From here that is a teardrop entry": the entry for the current course to the fix. */
function entryFromHere(ctx: CheckContext, fix: { lat: number; lon: number }, inboundMag: number, turn: 'L' | 'R'): string {
  const entry = holdEntry(bearing(ctx.state.aircraft, fix), inboundMag + ctx.derived.magVar, turn);
  return `Arriving from here it is a ${entry} entry.`;
}

function holdMonitors(steps: readonly string[], altitudeFt: number): Monitor[] {
  return [
    {
      id: 'altitude',
      label: `Largest altitude error in the hold (${formatAltitude(altitudeFt)} ft)`,
      during: steps,
      sample: ({ derived }) => Math.abs(derived.indicatedAltitudeFt - altitudeFt),
      format: (v) => `${formatAltitude(v)} ft`,
      limit: 100,
    },
    {
      id: 'bank',
      label: 'Steepest bank in the hold',
      during: steps,
      sample: ({ state }) => Math.abs(state.aircraft.bankDeg),
      format: (v) => `${Math.round(v)} degrees`,
      limit: 30,
    },
  ];
}

export const publishedHoldLesson: Lesson = {
  id: 'hold-missed',
  title: 'Holding: the missed approach hold at KORNY',
  summary: 'From a 6 nm final of the RNAV 17: down the glidepath to the DA, go missed, unsuspend, and fly the published hold at KORNY.',
  minutes: 12,
  unavailable: (env) => kjyoUnavailable(env),
  setup: [
    {
      kind: 'scenario',
      label: '6 nm final of the RNAV 17 at 2,100 ft, approach active, autopilot in ALT with APR armed.',
      airport: 'KJYO',
      approach: 'R17',
      transition: null,
      start: { kind: 'final', distanceNm: 6 },
      load: 'activate',
      autopilot: true,
    },
  ],
  steps: [
    {
      id: 'gp',
      title: 'Glidepath captured (GP)',
      check: c.any(c.glidepathCaptured, c.all(c.onGlidepath(0.3), ({ state }) => state.aircraft.verticalSpeedFpm < -300)),
      hints: { any: 'Reduce power to about 1,500 RPM (throttle 20 %) for about 90 kt down the glidepath.' },
    },
    {
      id: 'da',
      title: (ctx) => `Down to the DA, ${formatAltitude(c.decisionAltitudeFt(ctx.state, KJYO_THRESHOLD_FT))} ft`,
      check: c.atDecisionAltitude(KJYO_THRESHOLD_FT),
    },
    {
      id: 'go-around',
      title: 'Go around: full power and climb',
      check: c.goingAround,
      hints: { any: 'Full power, pitch up, select 4,000 ft. On the autopilot: VS or IAS/FLC up, NAV stays on the procedure.' },
      assist: () => [
        { type: 'engine.throttle', value: 1 },
        { type: 'ap.engage', on: true },
        { type: 'ap.vertical', mode: 'VS' },
        { type: 'bug.verticalSpeed', fpm: 700 },
        { type: 'bug.altitude', ft: 4000 },
        { type: 'ap.armAltitude', on: true },
      ],
    },
    {
      id: 'unsuspend',
      title: 'Unsuspend at the missed approach point (SUSP)',
      check: c.inMissedApproach,
      hints: {
        nav: {
          gns: 'Press OBS: SUSP goes out and the missed approach becomes active.',
          gtn: 'Tap Unsuspend (SUSP) in the bar at the bottom.',
          g1000: 'Press the SUSP softkey on the PFD.',
        },
      },
      assist: () => [{ type: 'fms.unsuspend' }],
    },
    {
      id: 'korny',
      title: 'Climb to 4,000 ft and fly to KORNY',
      detail: 'Climb to 1,100, then climbing right turn direct KORNY.',
      check: c.any(c.activeTo('KORNY'), c.holdingAt('KORNY')),
    },
    {
      id: 'entry',
      title: 'Enter the hold at KORNY',
      detail: (ctx) => `Inbound 081, right turns, 4 nm legs. ${entryFromHere(ctx, KORNY, 81, 'R')}`,
      check: c.holdingAt('KORNY'),
    },
    {
      id: 'level',
      title: 'Level at 4,000 ft in the hold for 15 s',
      check: c.all(c.holdingAt('KORNY'), c.atAltitude(4000, 100), c.levelFlight(200)),
      holdSec: 15,
    },
    {
      id: 'circuit',
      title: 'Fly a full circuit: cross KORNY inbound on 081',
      check: c.crossingInbound(KORNY, 81),
      hints: { any: 'Outbound legs are timed (or measured, 4 nm here) from abeam the fix. Adjust them so the inbound leg comes out right.' },
    },
  ],
  monitors: holdMonitors(['level', 'circuit'], 4000),
  tips: [
    'The entry comes from your heading at the fix: direct, teardrop or parallel, split by the 70 degree line.',
    'In a hold the inbound leg is the one that is timed: 1 minute below 14,000 ft, or a published distance like the 4 nm here.',
    'Below 6,000 ft holding speed is at most 200 kt: no limit for a 172, but slow down to save fuel.',
  ],
};

export const pilotHoldLesson: Lesson = {
  id: 'hold-pilot',
  title: 'Holding: a hold ATC assigns at MRB',
  summary: '"Hold southeast of MRB on the 120 radial, right turns, 1 minute legs": enter it on your navigator (or with OBS), fly the entry and a full circuit.',
  minutes: 10,
  setup: [
    { kind: 'position', label: '8 nm southeast of MRB on the 120 radial at 4,000 ft, heading for the VOR.', from: 'MRB', radialMag: 120, distanceNm: 8, altitudeFt: 4000, headingMag: 'toward', iasKt: 100 },
    { kind: 'directTo', label: 'Direct MRB on the GPS.', ident: 'MRB' },
    {
      kind: 'commands',
      label: 'Autopilot in NAV and ALT, 4,000 ft selected, NAV1 on MRB.',
      commands: [
        { type: 'nav.setActive', radio: 0, khz: 112100 },
        { type: 'cdi.source', source: 'GPS' },
        { type: 'bug.altitude', ft: 4000 },
        { type: 'ap.engage', on: true },
        { type: 'ap.vertical', mode: 'ALT' },
        { type: 'ap.lateral', mode: 'NAV' },
      ],
    },
  ],
  steps: [
    {
      id: 'enter',
      title: 'Enter the hold: MRB, inbound course 300, right turns, 1 minute legs',
      detail: 'The 120 radial inbound is a course of 300. Arriving on it from the southeast, it is a direct entry.',
      check: c.holdEntered('MRB', 300, 'R'),
      hints: {
        nav: {
          gns: 'The 430W has no user holds: with MRB active press OBS, set 300 with the course knob on the CDI or HSI, and fly the racetrack with the needle.',
          gtn: 'Flight Plan: tap MRB, Hold. Set course 300 inbound, right turns, 1 minute legs, then Insert.',
          g1000: 'With MRB active: FPL, MENU, Hold At Waypoint?: course 300 inbound, right, 1 minute, ENT. Or OBS softkey and the small CRS knob to 300.',
        },
      },
      assist: (ctx, env) => {
        const w = env.db.get('MRB', ctx.state.aircraft);
        return w ? [{ type: 'fms.hold', waypoint: NavDatabase.toWaypoint(w), inboundCourseMag: 300, turn: 'R', legTimeMin: 1, legNm: null }] : null;
      },
    },
    {
      id: 'cross',
      title: 'Cross MRB: start the entry',
      check: c.nearFix(MRB, 0.7),
    },
    {
      id: 'outbound',
      title: 'Turn right to the outbound heading, about 120, and fly 1 minute',
      check: c.outboundFrom(MRB, 1.3),
      hints: { any: 'Start timing abeam the fix (or when wings level outbound). Hand flying: HDG with the bug on 120, or the yoke.' },
    },
    {
      id: 'inbound',
      title: 'Turn right back to 300 and track it inbound for 15 s',
      check: c.inboundOn(MRB, 300, 0.5, 20),
      holdSec: 15,
    },
    {
      id: 'circuit',
      title: 'Cross MRB inbound: one full circuit',
      check: c.crossingInbound(MRB, 300),
    },
    {
      id: 'exit',
      title: 'ATC: "Cleared direct Leesburg". Leave the hold direct KJYO',
      check: c.any(c.directTo('KJYO'), c.activeTo('KJYO')),
      hints: {
        nav: {
          gns: 'OBS off first if you used it, then D->, KJYO, ENT, ENT.',
          gtn: 'Direct-To, KJYO, Activate (it cancels the hold).',
          g1000: 'D->, KJYO, ENT, ENT.',
        },
      },
      assist: (ctx, env) => {
        const w = env.db.get('KJYO', ctx.state.aircraft);
        return w ? [{ type: 'fms.obs', on: false }, { type: 'fms.directTo', waypoint: NavDatabase.toWaypoint(w) }] : null;
      },
    },
  ],
  monitors: holdMonitors(['cross', 'outbound', 'inbound', 'circuit'], 4000),
  tips: [
    'Copy the clearance in order: fix, direction from the fix, radial or course, turns, leg length, expect further clearance time.',
    'With wind, adjust the outbound time so the inbound leg takes the minute; triple the inbound wind correction outbound.',
    'A GNS has no user holds: OBS mode on the fix with the inbound course does the same job.',
  ],
};
