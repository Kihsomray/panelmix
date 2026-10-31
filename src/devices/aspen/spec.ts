import type { DeviceSpec } from '../types';

export const aspenSpec: DeviceSpec = {
  id: 'aspen-e1000',
  slot: 'pfd',
  maker: 'Aspen',
  name: 'Evolution E1000 PFD',
  summary: 'Aspen Evolution 1000 Pro PFD: attitude and tapes on top, HSI or ARC with map below, hot keys and MODE/SYNC knobs.',
  // 3.50 x 7.00 in at the bezel (Pilot's Guide 7.5.1): it fills the attitude and heading holes of a six-pack.
  width: 350,
  height: 700,
  provides: {},
  load: () => import('./AspenPfd'),
  help: [
    { control: 'Right knob', action: 'Home function HDG (heading bug). The first click wakes it (label turns magenta); push to cycle HDG, ALT (selected altitude, 100 ft steps) and MIN (when shown). Push and hold about a second to SYNC: heading, current altitude, or 29.92 for BARO. Back to HDG after 10 s idle.' },
    { control: 'Left knob', action: 'Home function CRS (course). Push for IAS (airspeed bug). With a GPS source and Auto Course on, CRS is green with an A and set by the GPS. Hold to SYNC: course straight to the station or waypoint, or the bug to the current airspeed.' },
    { control: 'Hot keys (right edge)', action: '1/2 switches the legend page; MIN shows the minimums and selects them for the right knob; 360/ARC switches the compass; GPSS turns GPS steering on (autopilot in HDG); BARO lets the right knob set the altimeter.' },
    { control: 'Bottom buttons', action: 'Left: single-line bearing pointer source (GPS1, VOR1, off). Middle: CDI source (GPS1, VLOC1). Right: double-line bearing pointer source.' },
    { control: 'RNG + / -', action: 'Map range 2 to 200 nm (measured to the compass scale). Hold for the largest or smallest range; hold again at the end for Auto Range when it is enabled in the menu.' },
    { control: 'MENU', action: 'Opens the menu. Right knob: choose the page; press the key beside an option, then turn the right knob to change it and push it to go back. Left knob: brightness (push for manual). MENU again to exit.' },
    { control: 'REV', action: 'Hold to power down (5 s countdown, any control cancels). Hold again to power up.' },
  ],
};
