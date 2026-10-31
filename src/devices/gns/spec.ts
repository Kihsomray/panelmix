import type { ControlHelp, DeviceSpec } from '../types';

/*
 * The GNS 430W (6.25 x 2.65 in) and 530W (6.25 x 4.60 in): one
 * implementation, a bezel layout per model.
 */

function help(model: '430' | '530'): ControlHelp[] {
  return [
    { control: 'C knob (COM power / volume)', action: 'Turn: COM volume (shown on the screen). Push: automatic squelch off or on ("RX" in the COM window).' },
    { control: 'V knob (VLOC volume)', action: 'Turn: VLOC volume. Push: Morse ident audio on or off ("ID" in the VLOC window).' },
    { control: 'C key (COM flip-flop)', action: 'Swaps the active and standby COM frequencies. Hold for two seconds: 121.500 becomes the active COM.' },
    { control: 'V key (VLOC flip-flop)', action: 'Swaps the active and standby VLOC frequencies.' },
    { control: 'Large left knob', action: 'MHz of the standby frequency under the tuning cursor (cyan bar).' },
    {
      control: 'Small left knob',
      action: 'kHz of the standby frequency. Push: moves the tuning cursor between COM and VLOC; it returns to COM after 30 seconds.',
    },
    {
      control: 'Large right knob',
      action: 'Page group: NAV, WPT, AUX, NRST (shown in the lower right corner). With the cursor on: moves it between fields and down lists.',
    },
    {
      control: 'Small right knob',
      action:
        'Page within the group. With the cursor on: changes the highlighted field. Spelling an identifier: the small knob picks the letter, the large knob moves to the next one; the rest spells ahead from the database.',
    },
    {
      control: 'Push small right knob (CRSR)',
      action: 'Cursor on or off. On the map page it shows the panning pointer: small knob north and south, large knob east and west; ENT on a waypoint opens its page, D-> flies to it.',
    },
    { control: 'RNG key', action: `Down arrow zooms in, up arrow zooms out: map page${model === '530' ? ', the map on the default NAV page' : ''} and the runway page.` },
    {
      control: 'D-> key (direct-to)',
      action:
        'Opens SELECT DIRECT-TO WAYPOINT with the waypoint under the cursor (NRST list, flight plan, WPT page) or the active one. Spell another, or pick from the FPL or NRST field with the small knob. ENT, then ENT on "Activate?". MENU on this page: "Cancel Direct-To NAV?".',
    },
    { control: 'MENU key', action: 'Page menu. Active flight plan: Activate Leg?, Invert Flight Plan?, Delete Flight Plan?. Map: data fields on or off.' },
    {
      control: 'CLR key',
      action: 'Cancels an entry or window and goes back. On a flight plan waypoint: "Remove?" On the map: declutter (-1 to -3). Hold: default NAV page.',
    },
    {
      control: 'ENT key',
      action: 'Confirms. On a frequency (NRST, WPT, NAVCOM pages) loads it into the COM or VLOC standby. On a list identifier opens its WPT pages ("Done?" returns).',
    },
    { control: 'CDI key', action: 'Switches the external CDI or HSI between GPS (green "GPS") and the VLOC receiver (white "VLOC"), above the key.' },
    { control: 'OBS key', action: 'OBS mode: waypoint sequencing stops ("OBS" above the key); set the course with the CDI or HSI course knob. Press again to resume.' },
    { control: 'MSG key', action: 'Message page; "MSG" flashes yellow above the key while there are unread messages. Press again to go back.' },
    {
      control: 'FPL key',
      action:
        'Active flight plan: DTK and DIS per leg, magenta arrow on the active leg. CRSR, highlight a waypoint and turn the small knob to insert one in front of it (or on the blank line to add). Small knob without cursor: flight plan catalog.',
    },
    ...(model === '530' ? [{ control: 'VNAV key', action: 'Vertical navigation page: target altitude, position before or after the waypoint, profile and the vertical speed required.' }] : []),
    { control: 'PROC key', action: 'Procedures page: Select Approach, Arrival or Departure. Procedures are not in the trainer database, and the unit says so.' },
  ];
}

export const gns430Spec: DeviceSpec = {
  id: 'gns430w',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GNS 430W',
  summary: 'The classic GPS/NAV/COM: knob-driven pages, flight plans, direct-to, nearest and VLOC tuning.',
  width: 625,
  height: 265,
  provides: { gps: true, nav: 1, com: 1 },
  load: () => import('./Gns430'),
  help: help('430'),
};

export const gns530Spec: DeviceSpec = {
  id: 'gns530w',
  slot: 'nav',
  maker: 'Garmin',
  name: 'GNS 530W',
  summary: 'The 430W with a larger screen: map on the default NAV page, VOR readout and a VNAV key.',
  width: 625,
  height: 460,
  provides: { gps: true, nav: 1, com: 1 },
  load: () => import('./Gns530'),
  help: help('530'),
};
