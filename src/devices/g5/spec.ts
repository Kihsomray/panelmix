import type { DeviceSpec } from '../types';

export const g5Spec: DeviceSpec = {
  id: 'g5',
  slot: 'pfd',
  maker: 'Garmin',
  name: 'G5 (attitude + HSI)',
  summary: 'Two Garmin G5 units: the electronic attitude indicator on top, the HSI below, with GFC 500 annunciations.',
  // Each G5 bezel is 3.4 x 3.6 in; the pair stacks in the six-pack's center column.
  width: 340,
  height: 736,
  provides: {},
  load: () => import('./G5Pair'),
  help: [
    { control: 'Knob, PFD page (top unit)', action: 'Turn to set the altimeter (baro) setting. Push for the menu.' },
    { control: 'Knob, HSI page (bottom unit)', action: 'Turn to move the heading bug. Push and hold to sync the bug to the current heading. Push for the menu.' },
    { control: 'Menu', action: 'Turn the knob to move along the tiles and push to pick one: Back, Heading, Altitude, HSI or PFD (switch this unit\'s page), ESP (GFC 500), GPSS (KAP 140 or the sim autopilot: GPS steering, the autopilot in HDG flies the GPS course; the heading bug turns hollow) and, on the HSI, Course or OBS and Setup.' },
    { control: 'Heading / Altitude tiles', action: 'Open a pop-up: turn to set the heading bug or selected altitude (100 ft steps), push to accept, push and hold to sync to the current heading or altitude.' },
    { control: 'Course tile (VOR/LOC) or OBS tile (GPS OBS)', action: 'Turn to set the selected course; push and hold to center the needle with a TO indication.' },
    { control: 'Setup tile (HSI)', action: 'Bearing Pointer 1 (single line) and 2 (double line): None, GPS or VLOC.' },
    { control: 'Power button', action: 'Press for the backlight page (knob sets the level, power button toggles Auto). Hold to turn the unit off; any control cancels during the 5 s countdown. Hold or press again to turn it back on.' },
    { control: 'GFC 500 status box', action: 'With a GFC 500: armed and active lateral modes left (NAV shows as GPS, VOR or LOC), AP or FD in the middle, vertical mode and reference right; active modes green, armed white, a capture flashes. The magenta command bars are hollow when hand flying, solid with the autopilot on.' },
    { control: 'CDI source', action: "The navigator's CDI key picks GPS (magenta needle) or VLOC (green)." },
  ],
};
