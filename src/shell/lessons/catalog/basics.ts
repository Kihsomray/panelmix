import { NavDatabase, type Waypoint } from '../../../core/navdb';
import type { SimCommand } from '../../../sim/commands';
import { formatAltitude } from '../../../ui/format';
import * as c from '../checks';
import type { CheckContext, Lesson, LessonEnv } from '../types';
import * as h from './hints';

/*
 * The buttonology lessons: radios and transponder, direct-to and flight
 * plans, autopilot basics and VOR tracking. All of them fly around
 * Leesburg (KJYO) and the Martinsburg VORTAC (MRB), where the session starts.
 */

function waypoints(env: LessonEnv, ctx: CheckContext, idents: readonly string[]): Waypoint[] | null {
  const out: Waypoint[] = [];
  for (const i of idents) {
    const w = env.db.get(i, ctx.state.aircraft);
    if (!w) return null;
    out.push(NavDatabase.toWaypoint(w));
  }
  return out;
}

const directToCmd = (ident: string) => (ctx: CheckContext, env: LessonEnv): SimCommand[] | null => {
  const w = waypoints(env, ctx, [ident])?.[0];
  if (!w) return null;
  const i = ctx.state.fms.plan.findIndex((p) => p.ident === ident);
  return [{ type: 'fms.directTo', waypoint: w, planIndex: i >= 0 ? i : null }];
};

export const radiosLesson: Lesson = {
  id: 'radios',
  title: 'Radios and transponder',
  summary: 'Tune and swap COM and NAV, squawk a code, select altitude reporting, ident and set the altimeter, the way ATC asks for them.',
  minutes: 5,
  setup: [
    {
      kind: 'commands',
      label: 'COM1 on 126.100 with 122.975 in standby, NAV1 standby 108.00, transponder 1200 in standby, and a new altimeter setting (29.87) for you to dial in.',
      commands: [
        { type: 'com.setActive', radio: 0, khz: 126100 },
        { type: 'com.setStandby', radio: 0, khz: 122975 },
        { type: 'nav.setActive', radio: 0, khz: 112100 },
        { type: 'nav.setStandby', radio: 0, khz: 108000 },
        { type: 'xpdr.code', code: '1200' },
        { type: 'xpdr.mode', mode: 'STBY' },
        { type: 'sim.qnh', inHg: 29.87 },
        { type: 'baro.set', inHg: 30.12 },
      ],
    },
  ],
  steps: [
    {
      id: 'com-standby',
      title: 'Put 121.500 in the COM1 standby',
      detail: 'The emergency frequency. Tune standby first: the active frequency stays in use until you swap.',
      check: c.comStandby(0, 121500),
      hints: h.COM1_STANDBY('121.500', '121', '500'),
      assist: () => [{ type: 'com.setStandby', radio: 0, khz: 121500 }],
    },
    {
      id: 'com-swap',
      title: 'Make 121.500 the active COM1 frequency',
      check: c.comActive(0, 121500),
      hints: h.COM1_SWAP,
      assist: () => [{ type: 'com.swap', radio: 0 }],
    },
    {
      id: 'nav-tune',
      title: 'Tune Armel VOR (AML, 113.50) as the NAV1 active frequency',
      detail: 'Standby first, then swap, the same as COM.',
      check: c.navActive(0, 113500),
      hints: h.NAV1_TUNE('113.50', '113', '50'),
      assist: () => [
        { type: 'nav.setStandby', radio: 0, khz: 113500 },
        { type: 'nav.swap', radio: 0 },
      ],
    },
    {
      id: 'squawk',
      title: 'ATC: "Squawk 4521"',
      check: c.squawk('4521'),
      hints: h.SQUAWK('4521'),
      assist: () => [{ type: 'xpdr.code', code: '4521' }],
    },
    {
      id: 'xpdr-alt',
      title: 'Transponder to ALT (altitude reporting)',
      detail: 'ALT replies with your pressure altitude: the normal mode in flight.',
      check: c.xpdrMode('ALT'),
      hints: h.XPDR_ALT,
      assist: () => [{ type: 'xpdr.mode', mode: 'ALT' }],
    },
    {
      id: 'ident',
      title: 'ATC: "Ident"',
      detail: 'Press IDENT once, only when asked.',
      check: c.identing,
      hints: h.XPDR_IDENT,
      assist: () => [{ type: 'xpdr.ident' }],
    },
    {
      id: 'altimeter',
      title: ({ state }) => `ATC: "Leesburg altimeter ${state.env.qnhInHg.toFixed(2)}". Set it`,
      detail: ({ state }) => {
        const err = Math.round((state.bugs.baroInHg - state.env.qnhInHg) * 1000);
        return err === 0 ? 'Set.' : `With your setting the altimeter reads about ${Math.abs(err)} ft ${err > 0 ? 'high' : 'low'}.`;
      },
      check: c.altimeterSet,
      hints: h.ALTIMETER,
      assist: ({ state }) => [{ type: 'baro.set', inHg: state.env.qnhInHg }],
    },
  ],
  tips: [
    'Tune standby, check it, then swap: the active frequency stays in use until you are ready.',
    'On a knob transponder set new codes in SBY, so ATC never sees the codes in between.',
    'About 1,000 ft per inch of mercury: a setting too high reads high ("high to low, look out below").',
  ],
};

export const directLesson: Lesson = {
  id: 'direct-fpl',
  title: 'Direct-to and flight plans',
  summary: 'Build a flight plan, fly its first leg, go direct when ATC clears you, then add a waypoint and activate a leg.',
  minutes: 8,
  setup: [
    { kind: 'position', label: 'Just west of Leesburg (KJYO) at 3,500 ft, heading 300.', from: 'KJYO', radialMag: 270, distanceNm: 3, altitudeFt: 3500, headingMag: 300 },
    {
      kind: 'commands',
      label: 'Flight plan and direct-to cleared, CDI on GPS, autopilot off.',
      commands: [
        { type: 'fms.removeApproach' },
        { type: 'fms.cancelDirectTo' },
        { type: 'fms.clear' },
        { type: 'cdi.source', source: 'GPS' },
        { type: 'ap.engage', on: false },
      ],
    },
  ],
  steps: [
    {
      id: 'build',
      title: 'Build the flight plan KJYO, MRB, KHGR',
      detail: 'Leesburg, the Martinsburg VORTAC, then Hagerstown. The first leg (KJYO to MRB) becomes active.',
      check: c.planHas(['KJYO', 'MRB', 'KHGR']),
      hints: {
        nav: {
          gns: 'FPL key, push the small right knob for the cursor. On the empty line turn the small right knob to spell KJYO (large knob for the next letter), ENT. Repeat for MRB and KHGR.',
          gtn: 'Home, Flight Plan, Add Waypoint: type KJYO, Enter. Add MRB and KHGR the same way.',
          g1000: 'FPL key, push the FMS knob for the cursor, turn the small FMS knob to spell KJYO (large knob for the next letter), ENT. Repeat for MRB and KHGR.',
        },
      },
      assist: (ctx, env) => {
        const plan = waypoints(env, ctx, ['KJYO', 'MRB', 'KHGR']);
        return plan && [{ type: 'fms.replacePlan', plan }];
      },
    },
    {
      id: 'track-leg',
      title: 'Fly the leg to MRB: within 0.5 nm of the course for 30 s',
      detail: 'Turn toward the magenta course and keep the needle centered. The CDI is in terminal scale (1 nm) near Leesburg.',
      check: c.all(c.activeTo('MRB'), c.gpsCrossTrackWithin(0.5), c.trackingDesiredTrack(20)),
      holdSec: 30,
      hints: { any: 'Intercept at 30 to 45 degrees, then turn onto the course as the needle comes in. Use the yoke in Fly, or HDG on the autopilot.' },
    },
    {
      id: 'direct',
      title: 'ATC: "Cleared direct Hagerstown". Go direct to KHGR',
      check: c.directTo('KHGR'),
      hints: {
        nav: {
          gns: 'Press D->: with the cursor on KHGR in the flight plan it is filled in; otherwise spell KHGR. ENT, then ENT at Activate?.',
          gtn: 'Press the Direct-To key; tap KHGR in the flight plan list (or type it), then Activate.',
          g1000: 'Press D->, spell KHGR with the FMS knobs (or pick it from the FPL list), ENT, then ENT at ACTIVATE?.',
        },
      },
      assist: directToCmd('KHGR'),
    },
    {
      id: 'track-direct',
      title: 'Turn to the new course and track it: within 0.3 nm and 10 degrees for 20 s',
      check: c.all(c.activeTo('KHGR'), c.gpsCrossTrackWithin(0.3), c.trackingDesiredTrack(10)),
      holdSec: 20,
      hints: { any: 'A direct-to starts at your present position: turn to the new desired track (DTK) and the needle stays centered.' },
    },
    {
      id: 'add',
      title: 'Add Frederick (KFDK) to the end of the plan',
      check: c.planHas(['KJYO', 'MRB', 'KHGR', 'KFDK']),
      hints: {
        nav: {
          gns: 'FPL, push the small right knob for the cursor, turn the large right knob to the empty line after KHGR, then spell KFDK with the small knob, ENT.',
          gtn: 'Flight Plan, Add Waypoint at the end, type KFDK, Enter.',
          g1000: 'FPL, push the FMS knob, large knob to the empty line, small knob to spell KFDK, ENT.',
        },
      },
      assist: (ctx, env) => {
        const w = waypoints(env, ctx, ['KFDK'])?.[0];
        return w ? [{ type: 'fms.insert', index: ctx.state.fms.plan.length, waypoint: w }] : null;
      },
    },
    {
      id: 'activate-leg',
      title: 'Activate the leg from KHGR to KFDK',
      detail: 'Activate Leg flies a leg of the plan from its start, not direct from where you are.',
      check: c.all(c.activeTo('KFDK'), c.activeLegOnPlan, ({ state }) => !state.fms.activeLeg?.isDirectTo),
      hints: {
        nav: {
          gns: 'FPL, push the small right knob, turn the large right knob to KFDK, MENU, Activate Leg?, ENT.',
          gtn: 'Tap KFDK in the flight plan, then Activate Leg.',
          g1000: 'FPL, push the FMS knob, large knob to KFDK, MENU, Activate Leg?, ENT.',
        },
      },
      assist: ({ state }) => {
        const i = state.fms.plan.findIndex((w) => w.ident === 'KFDK');
        return i > 0 ? [{ type: 'fms.activateLeg', index: i }] : null;
      },
    },
  ],
  monitors: [
    {
      id: 'xtk',
      label: 'Largest distance off course while tracking',
      during: ['track-leg', 'track-direct'],
      sample: ({ derived }) => (derived.gps.active ? Math.abs(derived.gps.crossTrackNm) : null),
      format: (v) => `${v.toFixed(2)} nm`,
      limit: 1,
    },
  ],
  tips: [
    'Activate Leg flies the leg from its start; Direct-To flies from where you are now.',
    'Picking the direct-to waypoint from the flight plan keeps the rest of the plan sequencing after it.',
    'Check the new DTK after every change, then turn to it.',
  ],
};

export const autopilotLesson: Lesson = {
  id: 'autopilot',
  title: 'Autopilot basics',
  summary: 'Heading mode, altitude preselect with a VS climb and capture, then NAV to intercept and track the flight plan.',
  minutes: 8,
  setup: [
    { kind: 'position', label: '4 nm southwest of Leesburg at 3,500 ft, heading 270.', from: 'KJYO', radialMag: 240, distanceNm: 4, altitudeFt: 3500, headingMag: 270 },
    { kind: 'plan', label: 'Flight plan KJYO, MRB, KHGR, flying to MRB.', idents: ['KJYO', 'MRB', 'KHGR'] },
    {
      kind: 'commands',
      label: 'Autopilot and flight director off, heading bug 270, altitude preselect 3,500 ft, CDI on GPS.',
      commands: [
        { type: 'ap.engage', on: false },
        { type: 'ap.flightDirector', on: false },
        { type: 'bug.heading', mag: 270 },
        { type: 'bug.altitude', ft: 3500 },
        { type: 'bug.verticalSpeed', fpm: 0 },
        { type: 'cdi.source', source: 'GPS' },
        { type: 'engine.throttle', value: 0.72 },
      ],
    },
  ],
  steps: [
    {
      id: 'bug',
      title: 'Set the heading bug to 360, an intercept heading for the course to MRB',
      check: c.headingBug(360),
      hints: h.HEADING_BUG,
      assist: () => [{ type: 'bug.heading', mag: 360 }],
    },
    {
      id: 'hdg',
      title: 'Engage the autopilot in heading mode (HDG)',
      check: c.all(c.apEngaged, c.apLateral('HDG')),
      hints: h.AP_HDG,
      assist: () => [
        { type: 'ap.engage', on: true },
        { type: 'ap.lateral', mode: 'HDG' },
      ],
    },
    {
      id: 'turn',
      title: 'Let it turn: on heading 360 within 5 degrees for 10 s',
      check: c.all(c.apLateral('HDG'), c.onHeading(360, 5)),
      holdSec: 10,
    },
    {
      id: 'preselect',
      title: 'Preselect 4,500 ft',
      check: c.altitudeBug(4500),
      hints: h.ALTITUDE_SELECT,
      assist: () => [{ type: 'bug.altitude', ft: 4500 }],
    },
    {
      id: 'climb',
      title: 'Climb at about 500 fpm (VS, or IAS/FLC) with the altitude capture armed',
      check: c.all(c.any(c.apVertical('VS'), c.apVertical('IAS')), c.altitudeArmed, c.climbing(250)),
      hints: h.VS_CLIMB,
      assist: () => [
        { type: 'engine.throttle', value: 1 },
        { type: 'ap.vertical', mode: 'VS' },
        { type: 'bug.verticalSpeed', fpm: 500 },
        { type: 'ap.armAltitude', on: true },
      ],
    },
    {
      id: 'capture',
      title: 'Level off: the autopilot captures 4,500 ft (ALT)',
      check: c.all(c.apVertical('ALT'), ({ state }) => Math.abs(state.aircraft.altitudeFt - 4500) <= 100),
      hints: { any: 'Watch the armed altitude (ALTS or ALT ARM) become ALT. Then reduce power to cruise, about 2,300 RPM (throttle 70 %).' },
    },
    {
      id: 'nav',
      title: 'Couple the flight plan: NAV on the GPS course',
      detail: 'Further than half scale from the course NAV arms; heading mode keeps flying until the needle comes in.',
      check: c.all(c.navSelected, c.cdiSource('GPS')),
      hints: h.AP_NAV,
      assist: () => [{ type: 'ap.armNav', on: true }],
    },
    {
      id: 'track',
      title: 'NAV captured: within 0.3 nm of the course for 20 s',
      check: c.all(c.apLateral('NAV'), c.gpsCrossTrackWithin(0.3)),
      holdSec: 20,
    },
    {
      id: 'off',
      title: 'Disconnect the autopilot and hand fly',
      check: c.apOff,
      hints: h.AP_OFF,
      assist: () => [{ type: 'ap.engage', on: false }],
    },
  ],
  monitors: [
    {
      id: 'overshoot',
      label: 'Altitude overshoot at the level-off',
      during: ['capture', 'nav', 'track'],
      sample: ({ state }) => Math.max(state.aircraft.altitudeFt - 4500, 0),
      format: (v) => `${formatAltitude(v)} ft`,
      limit: 100,
    },
  ],
  tips: [
    'Set the bug before the mode: the autopilot flies whatever the bug says the moment it engages.',
    'Preselect the altitude first, then start the climb, so the capture is armed.',
    'NAV arms outside half scale and captures as the needle comes in: give it an intercept heading.',
  ],
};

export const vorLesson: Lesson = {
  id: 'vor',
  title: 'VOR tracking on VLOC',
  summary: 'Tune and identify Martinsburg, switch the CDI to VLOC, center the needle, fly inbound, cross the station and track outbound.',
  minutes: 8,
  setup: [
    { kind: 'position', label: '7 nm southeast of MRB on the 130 radial at 3,500 ft, heading 330.', from: 'MRB', radialMag: 130, distanceNm: 7, altitudeFt: 3500, headingMag: 330 },
    {
      kind: 'commands',
      label: 'NAV1 on Armel (113.50) with 108.00 in standby, course 360, CDI on GPS, autopilot off.',
      commands: [
        { type: 'nav.setActive', radio: 0, khz: 113500 },
        { type: 'nav.setStandby', radio: 0, khz: 108000 },
        { type: 'nav.ident', radio: 0, on: false },
        { type: 'obs.set', radio: 0, mag: 360 },
        { type: 'cdi.source', source: 'GPS' },
        { type: 'ap.engage', on: false },
      ],
    },
  ],
  steps: [
    {
      id: 'tune',
      title: 'Tune Martinsburg (MRB, 112.10) as NAV1 active',
      check: c.navActive(0, 112100),
      hints: h.NAV1_TUNE('112.10', '112', '10'),
      assist: () => [
        { type: 'nav.setStandby', radio: 0, khz: 112100 },
        { type: 'nav.swap', radio: 0 },
      ],
    },
    {
      id: 'ident',
      title: 'Identify it: Morse ident on (-- .-. -...)',
      detail: 'A VOR is only usable once you have heard its identifier.',
      check: c.navIdentOn(0),
      hints: h.NAV1_IDENT,
      assist: () => [{ type: 'nav.ident', radio: 0, on: true }],
    },
    {
      id: 'cdi',
      title: 'Switch the CDI to VLOC (NAV1)',
      check: c.cdiSource('NAV1'),
      hints: h.CDI_VLOC,
      assist: () => [{ type: 'cdi.source', source: 'NAV1' }],
    },
    {
      id: 'center',
      title: 'Center the needle with a TO flag',
      detail: 'Turn the course until the needle centers and the flag shows TO: that course is the bearing to MRB.',
      check: c.all(c.cdiSource('NAV1'), c.toFlag, c.needleWithin(0.2)),
      hints: h.COURSE_CENTER,
      assist: ({ derived }) => {
        const to = derived.vor[0].bearingToMag;
        return to === null ? null : [{ type: 'obs.set', radio: 0, mag: Math.round(to) }];
      },
    },
    {
      id: 'inbound',
      title: 'Fly inbound: needle within half scale on the course for 30 s',
      check: c.all(c.cdiSource('NAV1'), c.toFlag, c.needleWithin(0.5), c.trackAlongCourse(20)),
      holdSec: 30,
      hints: {
        any: 'Turn to the course, then toward the needle. Once it is centered, find the heading that keeps it there: that is your wind correction.',
        ap: {
          kap140: 'Or HDG to the course, then NAV: it couples the VOR.',
          gfc500: 'Or NAV: the G5 shows VOR in green once captured.',
          gfc700: 'Or NAV: VOR in green on the PFD once captured.',
          sim: 'Or NAV in Fly.',
        },
      },
    },
    {
      id: 'passage',
      title: 'Station passage: the flag flips to FROM',
      detail: 'Close to the station the needle gets lively. Hold your heading; do not chase it.',
      check: c.all(c.cdiSource('NAV1'), c.fromFlag, ({ derived }) => derived.vor[0].station?.ident === 'MRB'),
    },
    {
      id: 'outbound',
      title: 'Track outbound: needle within half scale for 30 s',
      check: c.all(c.cdiSource('NAV1'), c.fromFlag, c.needleWithin(0.5), c.trackAlongCourse(20)),
      holdSec: 30,
    },
  ],
  monitors: [
    {
      id: 'needle',
      label: 'Largest needle deflection while tracking',
      during: ['inbound', 'outbound'],
      sample: ({ derived }) => (derived.cdi.flag ? null : Math.abs(derived.cdi.needle)),
      format: (v) => `${Math.round(v * 100)} % of full scale`,
      limit: 0.5,
    },
  ],
  tips: [
    'Tune, identify, then use: the CDI and autopilot follow whatever the CDI source shows.',
    'TO and FROM tell you which side of the station you are on, not which way you are heading.',
    'Keeping the same course after station passage gives the right sensing outbound.',
  ],
};
