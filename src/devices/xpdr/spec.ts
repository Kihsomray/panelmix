import type { DeviceSpec } from '../types';

export const gtx345Spec: DeviceSpec = {
  id: 'gtx345',
  slot: 'xpdr',
  maker: 'Garmin',
  name: 'GTX 345',
  summary: 'ADS-B Out transponder with a squawk keypad, VFR key and FUNC pages for timers and altitude.',
  // Bezel 6.25 x 1.65 in.
  width: 625,
  height: 165,
  provides: {},
  load: () => import('./Gtx345'),
  help: [
    { control: 'Squawk code', action: 'Type four digits with the 0 to 7 keys; the code activates on the fourth digit. Untyped digits show as blanks.' },
    { control: 'CLR (in code entry)', action: 'Steps back one digit; on the first digit it cancels and keeps the old code. Hold CLR to go back to the first digit.' },
    { control: 'CRSR / ENT (in code entry)', action: 'CRSR cancels the entry. ENT accepts a partly typed code with zeros for the rest (a trainer shortcut; the guide only documents the fourth digit).' },
    { control: 'VFR', action: 'Squawks 1200. Press again to return to the previous code; further presses toggle between the two.' },
    { control: 'IDNT', action: 'Ident for 18 seconds: IDENT shows at the top left of the display.' },
    { control: 'ON / ALT / SBY / OFF', action: 'ON replies without altitude, ALT with pressure altitude (normal in flight), SBY does not reply, OFF powers down. From OFF the mode keys start the unit (start-up screen first).' },
    { control: 'Display', action: 'Left: mode, IDENT, and the inverse R when the transponder replies. Middle: the code (LOST COMM under 7600, EMERGENCY under 7700). Right: the function page.' },
    { control: 'FUNC', action: 'Cycles the groups XPDR, TMR, ALT and SYS (the name shows in the scroll column for two seconds).' },
    { control: '8▲ / 9▼', action: 'Previous or next page in the group (scroll bar at the right edge). With the cursor on, they adjust the value or type 8 and 9 in a count-down time.' },
    { control: 'XPDR group', action: 'FLIGHT ID (N172SP) and 1090ES TX CTRL (ADS-B Out, ON).' },
    { control: 'TMR group', action: 'UP COUNTER, DOWN COUNTER, FLIGHT TIMER and TRIP TIMER. ENT starts and stops, CLR resets. DOWN COUNTER: CRSR, then type HHMMSS; EXPIRED flashes at zero.' },
    { control: 'ALT group', action: 'PRESSURE ALT in flight levels (this unit is configured for FLIGHT LVL units) with a climb or descent arrow, ALT MONITOR (CRSR then ENT turns it on at the current altitude; LEAVING ALTITUDE beyond 250 ft, CLR stops the flashing) and SAT/DALT.' },
    { control: 'SYS group', action: 'BACKLIGHT and CONTRAST (CRSR then 8/9 change the offset), MESSAGES, BLUETOOTH and GPS STATUS.' },
  ],
};

export const kt76aSpec: DeviceSpec = {
  id: 'kt76a',
  slot: 'xpdr',
  maker: 'Bendix/King',
  name: 'KT 76A',
  summary: 'The classic transponder: four code knobs over mechanical drums, a function selector and a reply lamp.',
  // Bezel 6.25 x 1.63 in.
  width: 625,
  height: 163,
  provides: {},
  load: () => import('./Kt76a'),
  help: [
    { control: 'Function selector', action: 'OFF, SBY (standby, no replies), ON (replies without altitude), ALT (replies with altitude, normal in flight) and TST.' },
    { control: 'TST', action: 'Spring-loaded test position: the reply lamp lights steadily while held. Here the knob springs back to ALT after a second and a half.' },
    { control: 'Code knobs', action: 'Each knob turns the drum above it through 0 to 7. Set the code in SBY: turning through other codes while replying is what ATC sees.' },
    { control: 'IDENT button', action: 'Ident for 18 seconds; the reply lamp stays lit meanwhile.' },
    { control: 'Reply lamp', action: 'Flashes each time the transponder replies to a radar (the trainer simulates a terminal and an en-route radar).' },
    { control: 'Warm-up', action: 'After switching on from OFF the KT 76A needs about 45 seconds before it replies; the lamp stays dark until then.' },
  ],
};
