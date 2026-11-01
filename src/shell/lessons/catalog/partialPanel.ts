import { formatAltitude } from '../../../ui/format';
import { attitudeFailure } from '../setup';
import * as c from '../checks';
import type { CheckContext, Lesson } from '../types';
import { NEAREST_DIRECT, AP_OFF } from './hints';

/*
 * Partial panel: the attitude source fails in cruise (the vacuum pump on a
 * six-pack, the AHRS on glass) and the pilot flies on what is left.
 */

/** 100 ft steps, so "descend 500 ft" targets a round altitude. */
const roundedStart = (ctx: CheckContext) => Math.round(ctx.stepStart.altitudeFt / 100) * 100;

export const partialPanelLesson: Lesson = {
  id: 'partial-panel',
  title: 'Partial panel: vacuum or AHRS failure',
  summary: 'Cruising on the autopilot, the attitude source fails without warning. Hand fly level, turn and descend on what is left, then divert.',
  minutes: 8,
  setup: [
    { kind: 'position', label: '8 nm west of Leesburg at 4,000 ft, heading 360.', from: 'KJYO', radialMag: 270, distanceNm: 8, altitudeFt: 4000, headingMag: 360 },
    {
      kind: 'commands',
      label: 'Failures cleared, autopilot flying heading 360 at 4,000 ft.',
      commands: [
        { type: 'failure.clearAll' },
        { type: 'bug.heading', mag: 360 },
        { type: 'bug.altitude', ft: 4000 },
        { type: 'engine.throttle', value: 0.72 },
        { type: 'ap.engage', on: true },
        { type: 'ap.lateral', mode: 'HDG' },
        { type: 'ap.vertical', mode: 'ALT' },
      ],
    },
    {
      kind: 'failure',
      label: 'The vacuum pump (six-pack) or the AHRS (glass) fails some time in the next one and a half minutes.',
      failure: 'attitude',
      delaySec: [20, 90],
    },
  ],
  steps: [
    {
      id: 'scan',
      title: 'Cruise and keep scanning: something is going to fail',
      detail: 'Cross-check the attitude indicator against the turn coordinator or the GPS track, the altimeter and the VSI.',
      check: c.attitudeFailed,
      assist: ({ panel }) => [{ type: 'failure.set', failure: attitudeFailure(panel), failed: true }],
    },
    {
      id: 'ap-off',
      title: 'Attitude failure! Autopilot off: hand fly',
      detail: 'A GFC 500 or GFC 700 needs the AHRS and drops out by itself. The KAP 140 flies on its own turn coordinator, but practise flying without it.',
      check: c.apOff,
      hints: AP_OFF,
      assist: () => [{ type: 'ap.engage', on: false }],
    },
    {
      id: 'level',
      title: 'Wings level: bank within 5 degrees for 20 s',
      check: c.wingsLevel(5),
      holdSec: 20,
      hints: {
        pfd: {
          steam: 'Cover the attitude and heading indicators. Keep the turn coordinator wings level and the ball centered.',
          g5: 'The G5 shows a red X. A steady GPS track on the navigator means wings level; a changing one means a turn.',
          aspen: 'The Aspen shows a red X. A steady GPS track on the navigator means wings level; a changing one means a turn.',
          g1000: 'Attitude and heading show red X. Use the ground track (TRK) on the MFD and the altitude and vertical speed tapes.',
        },
      },
    },
    {
      id: 'altitude',
      title: 'Hold your altitude within 100 ft for a minute',
      detail: (ctx) => `Target ${formatAltitude(roundedStart(ctx))} ft. The altimeter and VSI still work: small pitch changes, then wait.`,
      check: (ctx) => Math.abs(ctx.derived.indicatedAltitudeFt - roundedStart(ctx)) <= 100,
      holdSec: 60,
    },
    {
      id: 'turn',
      title: 'Turn left to 270 at standard rate, then roll out',
      detail: 'Standard rate is 3 degrees a second: 90 degrees takes 30 seconds. Count, roll out on time, then check the track.',
      check: c.all(c.onHeadingOrTrack(270, 10), c.wingsLevel(5)),
      holdSec: 10,
    },
    {
      id: 'descend',
      title: (ctx) => `Descend 500 ft to ${formatAltitude(roundedStart(ctx) - 500)} ft at about 500 fpm and level off`,
      check: (ctx) => Math.abs(ctx.derived.indicatedAltitudeFt - (roundedStart(ctx) - 500)) <= 100 && Math.abs(ctx.state.aircraft.verticalSpeedFpm) < 200,
      holdSec: 10,
      hints: { any: 'Reduce power a little (about 200 RPM) and hold the wings level; add it back as you level off.' },
    },
    {
      id: 'divert',
      title: 'Divert: go direct to the nearest airport',
      check: c.directToNearbyAirport(25),
      hints: NEAREST_DIRECT,
    },
  ],
  monitors: [
    {
      id: 'bank',
      label: 'Steepest bank on partial panel',
      during: ['level', 'altitude', 'turn', 'descend', 'divert'],
      sample: ({ state }) => Math.abs(state.aircraft.bankDeg),
      format: (v) => `${Math.round(v)} degrees`,
      limit: 30,
    },
    {
      id: 'altitude',
      label: 'Largest altitude error while holding altitude',
      during: ['altitude'],
      sample: (ctx) => Math.abs(ctx.derived.indicatedAltitudeFt - roundedStart(ctx)),
      format: (v) => `${formatAltitude(v)} ft`,
      limit: 100,
    },
  ],
  tips: [
    'Cover the failed instruments: a spinning-down attitude indicator is convincing, and wrong.',
    'Timed turns: 3 degrees a second at standard rate, 30 seconds for 90 degrees.',
    'Fly with what still works: turn coordinator, GPS track, altimeter, VSI and airspeed.',
  ],
};
