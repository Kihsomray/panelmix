import { angleDiff } from '../../../core/geo';
import type { SimCommand } from '../../../sim/commands';
import { formatAltitude } from '../../../ui/format';
import { findApproach } from '../../instructor/scenarioEnv';
import * as c from '../checks';
import type { CheckContext, Lesson, LessonEnv, LessonStep, Monitor } from '../types';
import * as h from './hints';

/*
 * Instrument approaches at Leesburg (KJYO), from the FAA CIFP:
 *
 * RNAV (GPS) RWY 17 (R17): transitions MRB, ZAXEN, HOAGE and CACAS (hold in
 * lieu of a procedure turn); CACAS (IF, 3,000) - DANMO (FAF, 2,100) -
 * CEYAC - RW17, LPV. Missed approach: climb to 1,100, then climbing right
 * turn direct KORNY and hold (inbound 081, right turns, 4 nm legs) at 4,000.
 *
 * ILS RWY 17 (I17): localizer IJYO 111.75, course 171. STILL (IF, 3,000) -
 * JOTUP - DANMO (FAF, glideslope intercept 2,100) - RW17. Missed approach:
 * climb to 1,200, then climbing right turn heading 340 to the MRB 157
 * radial and GAWDD, hold at 4,000.
 *
 * The runway 17 threshold is 378 ft (CIFP runway record), used for the
 * trainer's DA when no approach is loaded and no minimums are set.
 */

export const KJYO_THRESHOLD_FT = 378;
const IJYO_KHZ = 111750;
const LOC_COURSE = 171;

const da = (ctx: CheckContext) => c.decisionAltitudeFt(ctx.state, KJYO_THRESHOLD_FT);

export function kjyoUnavailable(env: LessonEnv, needsLocalizer = false): string | null {
  if (!env.procedures?.has('KJYO')) return 'Needs the KJYO instrument procedures (CIFP data), which this build does not have yet.';
  if (needsLocalizer && !env.db.localizer('IJYO')) return 'Needs the IJYO localizer (CIFP data), which this build does not have yet.';
  return null;
}

/** "Do it for me": load or activate a KJYO approach straight from the procedure database. */
function loadCmd(approach: string, transition: string | null, activate: 'load' | 'activate' | 'vtf') {
  return (_ctx: CheckContext, env: LessonEnv): SimCommand[] | null => {
    const a = findApproach(env.procedures?.get('KJYO'), approach);
    const airport = env.db.airport('KJYO');
    if (!a || !airport) return null;
    const wp = { kind: 'airport' as const, ident: airport.ident, name: airport.name, lat: airport.lat, lon: airport.lon };
    return [{ type: 'fms.loadApproach', airport: wp, approach: a, transition, activate }];
  };
}

const hasMinimums = (pfd: string) => pfd === 'g1000-pfd' || pfd === 'aspen-e1000';

const descending: c.Check = ({ state }) => state.aircraft.verticalSpeedFpm < -300;

/** On the path, coupled (GS mode) or hand flown with the needle near center while descending. */
const onPathDescending = c.any(c.glidepathCaptured, c.all(c.onGlidepath(0.3), descending));

const GO_AROUND_HINTS = {
  ap: {
    kap140: 'Press AP to disconnect, full power, pitch up for 75 kt, then ALT or VS with the missed approach altitude selected.',
    gfc500: 'Press AP (or move the yoke), full power, pitch up; then IAS or VS with the missed approach altitude selected.',
    gfc700: 'Press AP (or move the yoke), full power, pitch up; then FLC or VS with the missed approach altitude selected.',
    sim: 'Throttle to 100 % in Fly and pull up on the yoke (that disconnects the autopilot).',
  },
  any: 'Full power, climb attitude, then fly the published missed approach.',
};

function goAroundStep(): LessonStep {
  return {
    id: 'go-around',
    title: 'No runway in sight: go around. Full power and climb',
    check: c.goingAround,
    hints: GO_AROUND_HINTS,
    // Flown for you on the autopilot: full power and a 700 fpm climb.
    assist: () => [
      { type: 'engine.throttle', value: 1 },
      { type: 'ap.engage', on: true },
      { type: 'ap.vertical', mode: 'VS' },
      { type: 'bug.verticalSpeed', fpm: 700 },
    ],
  };
}

function daStep(): LessonStep {
  return {
    id: 'da',
    title: (ctx) => `Fly the path down to the DA, ${formatAltitude(da(ctx))} ft`,
    detail: (ctx) =>
      ctx.state.bugs.minimumsFt !== null
        ? 'Your minimums setting is the DA.'
        : `The trainer uses 200 ft above the threshold; the chart has the real DA. Now ${formatAltitude(ctx.derived.indicatedAltitudeFt - da(ctx))} ft above it.`,
    check: c.atDecisionAltitude(KJYO_THRESHOLD_FT),
    hints: { any: 'Small corrections: inside the final approach fix the needles are angular and get more sensitive toward the runway. Keep about 90 kt.' },
  };
}

function pathMonitors(steps: readonly string[]): Monitor[] {
  return [
    {
      id: 'course',
      label: 'Largest course deviation on final',
      during: steps,
      sample: ({ derived }) => (derived.cdi.flag ? null : Math.abs(derived.cdi.needle)),
      format: (v) => `${Math.round(v * 100)} % of full scale`,
      limit: 0.5,
    },
    {
      id: 'path',
      label: 'Largest glidepath deviation on final',
      during: steps,
      sample: ({ derived }) => (derived.vertical?.valid ? Math.abs(derived.vertical.needle) : null),
      format: (v) => `${Math.round(v * 100)} % of full scale`,
      limit: 0.5,
    },
  ];
}

export const rnavLesson: Lesson = {
  id: 'rnav17',
  title: 'RNAV (GPS) RWY 17 at KJYO, LPV',
  summary: 'Load and activate the RNAV 17 via MRB, fly the transition, couple APR and the glidepath to the DA, go missed and fly to the KORNY hold.',
  minutes: 18,
  unavailable: (env) => kjyoUnavailable(env),
  setup: [
    {
      kind: 'scenario',
      label: '6 nm northwest of MRB at 3,000 ft, direct MRB on the autopilot (NAV, ALT). You load the approach.',
      airport: 'KJYO',
      approach: 'R17',
      transition: 'MRB',
      start: { kind: 'transition', distanceNm: 6 },
      load: 'none',
      autopilot: true,
    },
  ],
  steps: [
    {
      id: 'load',
      title: 'Load the RNAV 17 at KJYO with the MRB transition',
      check: c.approachLoaded('KJYO', 'R17'),
      hints: h.LOAD_APPROACH('RNAV 17', 'MRB'),
      assist: loadCmd('R17', 'MRB', 'load'),
    },
    {
      id: 'activate',
      title: 'Activate the approach',
      detail: 'The navigator flies to MRB, the start of the transition, then the procedure.',
      check: c.approachActivated,
      hints: h.ACTIVATE_APPROACH,
      assist: () => [{ type: 'fms.activateApproach', vectorsToFinal: false }],
    },
    {
      id: 'minimums',
      title: ({ state }) => `Set your minimums to the DA: about ${formatAltitude(c.trainerDecisionAltitudeFt(state, KJYO_THRESHOLD_FT))} ft in the trainer`,
      check: ({ state }) => state.bugs.minimumsFt !== null,
      when: (p) => hasMinimums(p.pfd),
      hints: {
        pfd: {
          g1000: 'TMR/REF softkey, large FMS knob to BARO MIN, small knob to set it, ENT.',
          aspen: 'Press the MIN hot key, then turn the right knob.',
        },
      },
      assist: ({ state }) => [{ type: 'minimums.set', ft: c.trainerDecisionAltitudeFt(state, KJYO_THRESHOLD_FT) }],
    },
    {
      id: 'transition',
      title: 'Cross MRB and fly the transition to CACAS',
      check: c.activeTo('CACAS'),
      hints: { any: 'Stay at 3,000 ft: that is the altitude to CACAS. NAV on the autopilot follows the transition.' },
    },
    {
      id: 'intermediate',
      title: 'Past CACAS: the active leg is DANMO, the final approach fix',
      check: c.activeTo('DANMO'),
      hints: { any: 'The CDI scale goes from 1 nm (TERM) to the approach scale, starting 2 nm before DANMO.' },
    },
    {
      id: 'descend',
      title: 'Descend to 2,100 ft for DANMO',
      check: c.any(c.atAltitude(2100, 150), onPathDescending),
      hints: {
        ap: {
          kap140: 'Set 2,100 with the altitude knobs, ARM, then DN to about 500 fpm.',
          gfc500: 'Set 2,100 with ALT SEL, then VS and NOSE DN to -500 fpm.',
          gfc700: 'Set 2,100 with the ALT knob, then VS and NOSE DN to -500 fpm.',
          sim: 'ALT sel to 2,100, then VS and VS - to -500 in Fly.',
        },
        any: 'Ease the power back to about 1,900 RPM (throttle 40 %) so the speed stays near 105 kt.',
      },
    },
    {
      id: 'apr',
      title: 'Arm the approach: APR (GPS and GP armed)',
      check: c.all(c.approachArmed, c.glidepathArmedOrCaptured),
      hints: h.AP_APR,
      assist: () => [{ type: 'ap.approach', on: true }],
    },
    {
      id: 'lpv',
      title: 'Check the annunciation: LPV, and the CDI in approach scale',
      detail: 'No LPV (LNAV only)? Fly to the LNAV minimums instead: an MDA, no glidepath.',
      check: c.all(c.approachMode('LPV'), c.approachPhase('APR')),
      hints: {
        nav: {
          gns: 'The 430W shows LPV in the lower left corner of the screen.',
          gtn: 'LPV shows in the bar at the bottom of the screen, by the CDI scale.',
          g1000: 'The HSI shows LPV next to the GPS source.',
        },
      },
    },
    {
      id: 'gp',
      title: 'Glidepath captured (GP)',
      check: onPathDescending,
      hints: { any: 'At the capture reduce power to about 1,500 RPM (throttle 20 %) to hold about 90 kt on the way down.' },
    },
    daStep(),
    goAroundStep(),
    {
      id: 'unsuspend',
      title: 'At the runway the navigator suspends (SUSP): unsuspend for the missed approach',
      check: c.inMissedApproach,
      hints: h.UNSUSPEND,
      assist: () => [{ type: 'fms.unsuspend' }],
    },
    {
      id: 'korny',
      title: 'Climb to 4,000 ft and fly to KORNY',
      detail: 'Climb to 1,100, then climbing right turn direct KORNY.',
      check: c.all(c.any(c.activeTo('KORNY'), c.holdingAt('KORNY')), ({ derived }) => derived.indicatedAltitudeFt > 1500),
      hints: {
        ap: {
          kap140: 'Select 4,000 and ARM, VS up, then NAV.',
          gfc500: 'Select 4,000, IAS or VS, then NAV.',
          gfc700: 'Select 4,000, FLC or VS, then NAV.',
          sim: 'ALT sel 4,000, VS +, then NAV in Fly.',
        },
      },
    },
    {
      id: 'hold',
      title: 'Enter the hold at KORNY',
      detail: 'Inbound 081, right turns, 4 nm legs, 4,000 ft. The navigator picks the entry.',
      check: c.holdingAt('KORNY'),
    },
  ],
  monitors: [
    ...pathMonitors(['da']),
    {
      id: 'low',
      label: 'Lowest below 2,100 ft before the final approach fix',
      during: ['intermediate', 'descend', 'apr', 'lpv'],
      sample: ({ derived }) => Math.max(2100 - derived.indicatedAltitudeFt, 0),
      format: (v) => `${formatAltitude(v)} ft`,
      limit: 50,
    },
  ],
  tips: [
    'LPV is flown like an ILS, to a DA. LNAV has no glidepath: descend to the MDA and level off.',
    'Brief the missed approach before the final approach fix: here, 1,100 ft, then right direct KORNY, hold at 4,000.',
    'At the missed approach point sequencing suspends (SUSP); unsuspend it to get the missed approach legs.',
  ],
};

export const ilsLesson: Lesson = {
  id: 'ils17',
  title: 'ILS RWY 17 at KJYO',
  summary: 'From vectors: tune and identify IJYO, load the ILS, set the course, capture the localizer and glideslope, fly to the DA and go missed.',
  minutes: 10,
  unavailable: (env) => kjyoUnavailable(env, true),
  setup: [
    {
      kind: 'scenario',
      label: 'Vectors: 12 nm out, 2 nm west of the localizer on a 30 degree intercept heading, 3,000 ft, autopilot in HDG and ALT.',
      airport: 'KJYO',
      approach: 'I17',
      transition: null,
      start: { kind: 'intercept', distanceNm: 12, offsetNm: 2, angleDeg: 30 },
      load: 'none',
      autopilot: true,
      tuneLocalizer: false,
    },
    {
      kind: 'commands',
      label: 'NAV1 on MRB (112.10) with 108.00 in standby, course 360.',
      commands: [
        { type: 'nav.setActive', radio: 0, khz: 112100 },
        { type: 'nav.setStandby', radio: 0, khz: 108000 },
        { type: 'nav.ident', radio: 0, on: false },
        { type: 'obs.set', radio: 0, mag: 360 },
      ],
    },
  ],
  steps: [
    {
      id: 'tune',
      title: 'Tune the localizer IJYO (111.75) as NAV1 active',
      check: c.navActive(0, IJYO_KHZ),
      hints: h.NAV1_TUNE('111.75', '111', '75'),
      assist: () => [
        { type: 'nav.setStandby', radio: 0, khz: IJYO_KHZ },
        { type: 'nav.swap', radio: 0 },
      ],
    },
    {
      id: 'ident',
      title: 'Identify it: Morse ident on (I-J-Y-O)',
      check: c.navIdentOn(0),
      hints: h.NAV1_IDENT,
      assist: () => [{ type: 'nav.ident', radio: 0, on: true }],
    },
    {
      id: 'load',
      title: 'Load and activate the ILS 17 with vectors to final',
      check: c.all(c.approachLoaded('KJYO', 'I17'), c.approachActivated),
      hints: h.LOAD_VTF('ILS 17'),
      assist: loadCmd('I17', null, 'vtf'),
    },
    {
      id: 'course',
      title: `Set the course to ${LOC_COURSE}, the localizer course`,
      check: ({ state }) => Math.abs(angleDiff(state.nav.obsMag[0], LOC_COURSE)) <= 3,
      hints: h.COURSE_SET(String(LOC_COURSE)),
      assist: () => [{ type: 'obs.set', radio: 0, mag: LOC_COURSE }],
    },
    {
      id: 'cdi',
      title: 'CDI on NAV1 (LOC)',
      check: c.cdiSource('NAV1'),
      hints: h.CDI_VLOC,
      assist: () => [{ type: 'cdi.source', source: 'NAV1' }],
    },
    {
      id: 'apr',
      title: 'Arm the approach: APR (LOC and GS armed)',
      check: c.all(c.approachArmed, c.glidepathArmedOrCaptured),
      hints: h.AP_APR,
      assist: () => [{ type: 'ap.approach', on: true }],
    },
    {
      id: 'loc',
      title: 'Localizer captured',
      check: c.all(c.cdiSource('NAV1'), c.any(c.all(c.apLateral('NAV'), c.needleWithin(0.5)), c.all(c.needleWithin(0.3), c.trackAlongCourse(15)))),
      hints: { any: 'The localizer is four times as sensitive as a VOR: full scale is about 2.5 degrees. Make small heading changes.' },
    },
    {
      id: 'gs',
      title: 'Glideslope captured (GS)',
      check: onPathDescending,
      hints: { any: 'At the capture reduce power to about 1,500 RPM (throttle 20 %) for about 90 kt.' },
    },
    daStep(),
    goAroundStep(),
    {
      id: 'missed',
      title: 'Missed approach: climb to 1,200 ft, then right turn to heading 340',
      detail: 'Then intercept the MRB 157 radial to GAWDD and hold at 4,000 (inbound 157, right turns).',
      check: c.all(({ derived }) => derived.indicatedAltitudeFt >= 1150, c.onHeading(340, 15)),
      hints: h.HEADING_BUG,
    },
  ],
  monitors: pathMonitors(['da']),
  tips: [
    'Tune and identify the localizer before you trust it: the GPS overlay is not the ILS.',
    'Arm APR on an intercept heading: the localizer captures first, then the glideslope from below.',
    'Near the runway the needles are very sensitive: small, early corrections.',
  ],
};
