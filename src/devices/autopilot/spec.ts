import type { DeviceSpec } from '../types';

export const kap140Spec: DeviceSpec = {
  id: 'kap140',
  slot: 'ap',
  maker: 'Bendix/King',
  name: 'KAP 140',
  summary: 'Two-axis autopilot with altitude preselect: AP, HDG, NAV, APR, REV, ALT, UP/DN, ARM and BARO.',
  // KC 140 computer, 6.3 x 1.67 in.
  width: 630,
  height: 166,
  provides: {},
  load: () => import('./Kap140'),
  help: [
    { control: 'Power-up', action: 'PFT 1 to 4 and a display test run first; the buttons work once the baro setting flashes. Press BARO (or set it with the knobs) to confirm it.' },
    { control: 'AP', action: 'Hold a quarter second to engage, as on software 03/01 and later (from the keyboard, Enter engages). It engages in ROL (wing leveler) and VS, holding the vertical speed you had; the VS shows for 3 s. Any press disengages: AP flashes for 5 s.' },
    { control: 'HDG', action: 'Flies the heading bug (set it on the HSI or heading indicator). Press again for ROL, which rolls the wings level. Mode buttons do nothing until the autopilot is engaged.' },
    { control: 'NAV', action: 'Couples the CDI course (GPS or VOR, whatever the CDI shows). More than half scale off (about 2.5 dots), NAV ARM shows and ROL or HDG keeps flying until the needle comes in, then NAV captures. Press again to cancel.' },
    { control: 'APR / REV', action: 'Arm and capture like NAV. The trainer has no localizers or glideslopes, so both track the CDI course as NAV does (REV reverses only localizer sensing).' },
    { control: 'ALT', action: 'Holds the altitude at the moment of the press. Press again to return to VS.' },
    { control: 'UP / DN', action: 'In VS: the first press shows the target, each further press changes it 100 fpm (about 300 fpm per second when held). In ALT: 20 ft per press; held, the airplane climbs or descends at 500 fpm and holds the altitude where you let go.' },
    { control: 'Altitude select knobs', action: 'Large knob thousands, small knob hundreds: the selected altitude on the right of the display. With the autopilot engaged this arms the capture (ALT ARM).' },
    { control: 'ARM', action: 'Arms or disarms capture of the selected altitude. Climb or descend in VS toward it and the KAP levels off in ALT.' },
    { control: 'BARO', action: 'Shows the baro setting for 3 s; turn the knobs meanwhile to set it (this is the shared altimeter setting). Hold BARO 2 seconds to switch between IN HG and HPA.' },
    { control: 'ALERT', action: 'Lights 1,000 ft before the selected altitude, goes out inside 200 ft, blinks when you arrive and flashes if you then stray more than 200 ft.' },
    { control: 'Not modelled', action: 'Pitch trim (PT), the red P and R failure lights, the aural alerts and the yoke CWS and disconnect switches (move the sim yoke to disconnect).' },
  ],
};

export const gfc500Spec: DeviceSpec = {
  id: 'gfc500',
  slot: 'ap',
  maker: 'Garmin',
  name: 'GFC 500 (GMC 507)',
  summary: 'Garmin GFC 500 autopilot mode controller with flight director, IAS (flight level change) and LVL mode.',
  // GMC 507 bezel, 6.25 x 2.06 in.
  width: 625,
  height: 206,
  provides: {},
  load: () => import('./Gfc500'),
  help: [
    { control: 'Annunciations', action: 'The active and armed modes show on the G5 or PFD. The small triangle above a key lights while its function is selected.' },
    { control: 'AP', action: 'Engages the autopilot; if the flight director is off it comes on in ROL and PIT. ALTS (altitude capture) arms with PIT, VS and IAS. Press again to disengage.' },
    { control: 'FD', action: 'Flight director alone (command bars, hand flown). Disabled while the autopilot is engaged. Any mode key also turns the director on.' },
    { control: 'LVL', action: 'Engages the autopilot wings level with zero vertical speed and cancels every other mode: the recovery button.' },
    { control: 'HDG / TRK', action: 'HDG flies the heading bug. TRK has no separate track bug in the trainer: it puts the bug on the current ground track and flies it like HDG. Press either again for ROL.' },
    { control: 'NAV', action: 'Couples the CDI course. More than one dot off (half scale) it arms, shown in white on the G5, and the current mode flies until the needle comes in. Press again to cancel.' },
    { control: 'APR', action: 'Arms and captures like NAV. There are no approach glidepaths or glideslopes in the trainer, so GP and GS never arm.' },
    { control: 'ALT / VS / IAS', action: 'Altitude hold at the current altitude, vertical speed hold, or indicated airspeed (flight level change: set power, the pitch holds the speed). Press the active one again for PIT.' },
    { control: 'VNAV', action: 'Arms vertical navigation; the navigators publish no descent profiles in the trainer, so it never captures. Use VS or IAS to descend.' },
    { control: 'YD', action: 'Yaw damper on or off; it comes on with the autopilot. The flight model is always coordinated, so it has no visible effect.' },
    { control: 'NOSE UP/DN wheel', action: 'Changes the reference of the vertical mode: PIT 0.5 degrees, VS 100 fpm, IAS 1 kt (nose up is slower), ALT 10 ft (200 ft at most). Drag, scroll, or use the arrow keys.' },
    { control: 'HDG/TRK knob', action: 'Turns the heading bug. Push: sync to the current heading (to the ground track in TRK).' },
    { control: 'ALT SEL knob', action: 'Sets the selected altitude in 100 ft steps. Push: sync to the current altitude.' },
    { control: 'Not on this panel', action: 'AP DISC / TRIM INT, the go-around button and CWS are on the yoke; move the sim yoke to disconnect.' },
  ],
};
