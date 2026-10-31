import type { DeviceSpec } from '../types';
import { BEZEL_H, BEZEL_W } from './bezel/geometry';

/*
 * Garmin G1000 for the Cessna 172S (Nav III): two GDU 1040 displays, or
 * GDU 1044B with the GFC 700 autopilot keys. The bezel is 11.80 x 7.70 in.
 */

const COMMON_HELP = [
  { control: 'NAV knob (left, dual)', action: 'Large knob MHz, small knob kHz of the NAV standby in the cyan tuning box. Push to move the box between NAV1 and NAV2.' },
  { control: 'NAV flip-flop key', action: 'Swaps the active and standby NAV frequencies of the radio with the tuning box.' },
  { control: 'NAV VOL knob', action: 'NAV audio volume (shown for two seconds). Push to turn the Morse ident on or off (ID).' },
  { control: 'HDG knob', action: 'Moves the cyan heading bug. Push to sync the bug to the current heading.' },
  { control: 'ALT knob (dual)', action: 'Selected altitude above the altimeter: large knob 1000 ft, small knob 100 ft. The autopilot captures it (ALTS).' },
  { control: 'COM knob (right, dual)', action: 'Large knob MHz, small knob kHz of the COM standby in the tuning box. Push to switch COM1 and COM2.' },
  { control: 'COM flip-flop key', action: 'Swaps active and standby COM. Hold for two seconds to put 121.5 in the active COM.' },
  { control: 'COM VOL knob', action: 'COM volume. Push to turn automatic squelch off (SQ) or on.' },
  { control: 'CRS/BARO knob (dual)', action: 'Large knob: altimeter setting. Small knob: selected course (VOR, or GPS in OBS mode). Push to center the needle on the bearing to the station or waypoint.' },
  { control: 'RANGE joystick', action: 'Turn for map range. Push for the map pointer; the arrow marks around it move the pointer, and D-> then offers the waypoint under it.' },
  { control: 'FMS knob (dual)', action: 'Moves the cursor and enters data in the open window or page (small knob spells identifiers ahead). Push for the cursor.' },
  { control: 'D-> key', action: 'Direct-to: enter or accept the identifier, ENT, then ENT on ACTIVATE?. MENU in the window cancels a direct-to.' },
  { control: 'FPL key', action: 'Active flight plan. Small FMS knob adds a waypoint above the cursor, CLR removes one (OK to confirm), MENU has Activate Leg, Invert and Delete.' },
  { control: 'PROC key', action: 'Procedures menu. The trainer has no departures, arrivals or approaches and says so.' },
  { control: 'MENU, CLR, ENT keys', action: 'Page menu; cancel or close (CLR held on the MFD: default navigation map); accept.' },
] as const;

const AFCS_HELP = {
  control: 'GFC 700 keys (with the integrated autopilot)',
  action:
    'AP engages the autopilot, FD the flight director. HDG, ALT, VS and FLC select modes (press again for the default ROL or PIT); NOSE UP/DN change the PIT, VS or FLC reference. NAV captures at once within one dot of course; further out it arms (GPS or VOR in white) while HDG or ROL keeps flying, and captures as the needle comes in. APR with a VOR is the VOR approach mode (VAPP). Active modes are green, armed ones white. VNV, BC and GPS or LOC approaches have no data in the trainer.',
};

export const g1000PfdSpec: DeviceSpec = {
  id: 'g1000-pfd',
  slot: 'pfd',
  maker: 'Garmin',
  name: 'G1000 PFD',
  summary: 'G1000 primary flight display (Cessna 172S Nav III): attitude and tapes, HSI, inset map, radios, transponder and GFC 700 status.',
  width: BEZEL_W,
  height: BEZEL_H,
  requires: { nav: ['g1000-mfd'], xpdr: ['integrated'] },
  provides: { xpdrControl: true },
  load: () => import('./G1000Pfd'),
  help: [
    { control: 'Softkeys', action: 'INSET (map, declutter, TOPO), PFD (wind options, DME window, BRG1/BRG2, HSI FRMT 360 or ARC, ALT UNIT, STD BARO, DFLTS), OBS, CDI (GPS, VOR1, VOR2), DME tuning, XPDR, IDENT, TMR/REF, NRST, ALERTS.' },
    { control: 'XPDR softkey', action: 'STBY, ON, ALT, GND, VFR (1200) and CODE: enter four digits with the 0-7 softkeys (BKSP steps back); the code becomes active five seconds after the fourth digit.' },
    { control: 'TMR/REF softkey', action: 'Timer (UP/DN, START?/STOP?/RESET?), Glide/Vr/Vx/Vy flags on the speed tape and BARO minimums. Large FMS knob picks the field, small knob changes it, ENT runs the timer command.' },
    { control: 'NRST softkey', action: 'The 25 nearest airports. Turn the FMS knob to a frequency and press ENT to load it into the COM standby, or D-> to go direct.' },
    ...COMMON_HELP,
    AFCS_HELP,
  ],
};

export const g1000MfdSpec: DeviceSpec = {
  id: 'g1000-mfd',
  slot: 'nav',
  maker: 'Garmin',
  name: 'G1000 MFD',
  summary: 'G1000 multi-function display: engine indication, moving map, waypoint, nearest and flight plan pages.',
  width: BEZEL_W,
  height: BEZEL_H,
  requires: { pfd: ['g1000-pfd'], xpdr: ['integrated'] },
  provides: { gps: true, nav: 2, com: 2, autopilot: true },
  load: () => import('./G1000Mfd'),
  help: [
    { control: 'FMS knob, page selection', action: 'With no cursor, the large knob picks the page group (MAP, WPT, AUX, FPL, NRST) and the small knob the page in it, shown at the bottom right.' },
    { control: 'Softkeys', action: 'ENGINE (LEAN, SYSTEM, fuel totalizer), MAP (TOPO, TERRAIN, TRAFFIC, AIRWAYS, PROFILE), DCLTR, and page softkeys such as ACT LEG, INFO, APT/VOR/FREQ.' },
    { control: 'RANGE joystick', action: 'Map range on the map pages. Push for the map pointer, move it with the arrow marks, D-> goes direct to what it points at.' },
    { control: 'CLR held', action: 'Returns to the Navigation Map page.' },
    ...COMMON_HELP,
    AFCS_HELP,
  ],
};
