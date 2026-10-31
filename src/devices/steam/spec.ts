import type { DeviceSpec } from '../types';

export const steamSpec: DeviceSpec = {
  id: 'steam',
  slot: 'pfd',
  maker: 'Analog',
  name: 'Six-pack + CDI',
  summary: 'Round gauges: airspeed, attitude, altimeter, turn coordinator, heading indicator, VSI and a GPS/VLOC CDI.',
  width: 1380,
  height: 744,
  provides: {},
  load: () => import('./SteamPanel'),
  help: [
    { control: 'Altimeter knob', action: 'Sets the Kollsman window (altimeter setting).' },
    { control: 'OBS knob (CDI)', action: 'Rotates the course card. Sets the VOR course; in GPS OBS mode it also sets the GPS course.' },
    { control: 'Heading indicator, left knob', action: 'Moves the heading bug the autopilot follows in HDG mode.' },
    { control: 'Heading indicator, right knob', action: 'Turn to set the card to the compass. Push snaps it to the compass (a shortcut).' },
    { control: 'CDI source', action: "The navigator's CDI key switches the needle between GPS (blue GPS light) and VLOC (green)." },
  ],
};
