import type { ControlHelp, DeviceSpec } from '../types';

/*
 * Garmin GTN 650Xi and 750Xi. Bezel sizes from Garmin: 6.25 x 2.65 in and
 * 6.25 x 6.00 in, drawn at 100 px per inch.
 */

const shared = (homeHold: string, knobPage: string): ControlHelp[] => [
  {
    control: 'Volume/squelch knob (top left)',
    action: 'Turn: COM volume (NAV volume while the knob is on NAV). Push: COM squelch open, "SQ" (NAV: Morse ident on, "ID"). Hold: 121.50 MHz becomes the active COM (emergency); on touch, the 121.5 button in the knob controls.',
  },
  { control: 'HOME key', action: `Back to the Home page from anywhere. Hold: ${homeHold}.` },
  {
    control: 'Direct-To key',
    action: 'Opens Direct To, filled with the waypoint selected on the page (flight plan line, nearest list line, waypoint page or map pick) or else the active waypoint. Press again to close.',
  },
  {
    control: 'Dual knob, push',
    action: 'Cycles the knob focus: COM standby (cyan box), NAV standby, back to page navigation. On keypads and keyboards it is Enter; on Direct To it activates. Push and hold while on a radio: flip-flops it (on touch, the flip-flop button in the knob controls).',
  },
  {
    control: 'Dual knob, turn',
    action: `On a standby frequency: large knob MHz, small knob kHz. In page navigation: large knob steps the page shortcuts in the bar at the bottom right; small knob ${knobPage}. In entry pages: large knob moves the cursor, small knob changes the character, digit or course.`,
  },
  { control: 'COM / NAV active window', action: 'Tap to swap active and standby.' },
  {
    control: 'COM / NAV standby window',
    action: 'Tap for the standby keypad: type 2 1 5 for 121.50 (the leading 1 and the rest autofill), Enter loads standby, XFER also makes it active. Find lists nearby airport and VOR frequencies, recent ones and the flight plan. COM has Monitor.',
  },
  {
    control: 'XPDR window',
    action: 'Shows code, mode and R (reply). Tap for the XPDR page: keys 0-7, Backspace, VFR (1200), Enter, and Standby / On / Altitude Reporting. On that page the window becomes IDENT (ENT+ID after a new code).',
  },
  { control: 'Back / Cancel key', action: 'Previous page, or closes a pop-up; Cancel abandons an entry.' },
  { control: 'MSG key', action: 'Appears and flashes while messages are unread. Tap for the list; tap again to acknowledge them all.' },
  { control: 'Menu key', action: 'Page options: Flight Plan (Delete, Invert), Map (orientation, detail, change or restore user fields).' },
  { control: 'CDI key', action: 'Switches the external CDI/HSI between GPS (magenta) and VLOC (green); the source shows in the bar at the bottom.' },
  {
    control: 'OBS key',
    action: 'Holds the active waypoint (no sequencing) and opens Select OBS Course; type or turn the course, Enter. Tap again to resume. "OBS" shows in the bottom bar.',
  },
  { control: 'In / Out keys, map', action: 'Zoom the map. Tap a waypoint on the map to select it (its banner opens its information page).' },
  {
    control: 'Flight Plan',
    action: 'Active leg in magenta with DTK and distance. Tap a waypoint: Activate Leg, Insert Before / After, Waypoint Info, Remove. Add Waypoint at the end. Menu: Delete, Invert.',
  },
  {
    control: 'Waypoint keyboard',
    action: 'Type an identifier; the rest autofills in cyan from the database with the name below. FastFind offers the nearest match; Find opens Recent / Nearest / Flight Plan lists. Enter accepts.',
  },
  {
    control: 'Nearest, Waypoint Info',
    action: 'Nearest airports (bearing, distance, longest runway, a frequency key that loads COM), VORs and NDBs. Airport pages have Info, Runways and Frequencies tabs; VOR pages a NAV frequency key.',
  },
];

export const gtn650Spec: DeviceSpec = {
  id: 'gtn650xi',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GTN 650Xi',
  summary: 'Touchscreen GPS/NAV/COM: COM or NAV window and transponder on the right, Default Navigation, map, flight plan, Direct-To and nearest pages.',
  width: 625,
  height: 265,
  provides: { gps: true, nav: 1, com: 1, xpdrControl: true },
  load: () => import('./Gtn650'),
  help: [
    ...shared('Default Navigation page', 'scrolls lists and Home panes and zooms the map'),
    { control: 'Default NAV (650Xi)', action: 'From / to / next waypoints over a GPS deviation scale and six data fields; Menu > Configure User Fields.' },
    { control: 'Home panes (650Xi)', action: 'Swipe, tap the dots or turn the small knob to see the second row of apps.' },
  ],
};

export const gtn750Spec: DeviceSpec = {
  id: 'gtn750xi',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GTN 750Xi',
  summary: 'Large touchscreen GPS/NAV/COM: radio and transponder bar on top, map with CDI and user fields, flight plan, Direct-To, nearest and waypoint pages.',
  width: 625,
  height: 600,
  provides: { gps: true, nav: 1, com: 1, xpdrControl: true },
  load: () => import('./Gtn750'),
  help: shared('the moving map', 'scrolls lists and zooms the map'),
};
