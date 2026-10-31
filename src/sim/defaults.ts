import type { Waypoint } from '../core/navdb';
import { EMPTY_FMS } from './fms';
import { pitchForVerticalSpeed } from './flight';
import type { SimState } from './types';

/*
 * The session starts in cruise west of Leesburg, Virginia (KJYO): 3,500 ft,
 * heading west toward the Martinsburg VORTAC with a short flight plan loaded,
 * so every display has something real to show from the first second.
 */

const START = { lat: 39.075, lon: -77.62, altitudeFt: 3500, headingTrue: 300, iasKt: 105 };

const KJYO: Waypoint = { kind: 'airport', ident: 'KJYO', name: 'Leesburg Executive Airport', lat: 39.078, lon: -77.5575 };
const MRB: Waypoint = { kind: 'vor', ident: 'MRB', name: 'Martinsburg', lat: 39.3856, lon: -77.8484 };
const KHGR: Waypoint = { kind: 'airport', ident: 'KHGR', name: 'Hagerstown Regional', lat: 39.70877, lon: -77.72801 };

export function initialSimState(): SimState {
  const cruisePitch = pitchForVerticalSpeed(0, START.iasKt, START.iasKt * 1.05, 0);
  return {
    time: 0,
    paused: false,
    rate: 1,
    aircraft: {
      lat: START.lat,
      lon: START.lon,
      altitudeFt: START.altitudeFt,
      iasKt: START.iasKt,
      tasKt: START.iasKt * 1.05,
      groundSpeedKt: START.iasKt,
      headingTrue: START.headingTrue,
      trackTrue: START.headingTrue,
      pitchDeg: cruisePitch,
      bankDeg: 0,
      verticalSpeedFpm: 0,
      turnRateDps: 0,
      slip: 0,
      engine: {
        throttle: 0.72,
        rpm: 2350,
        fuelFlowGph: 8.1,
        fuelGal: [24, 24],
        oilPressPsi: 70,
        oilTempF: 195,
        egtF: 1350,
        chtF: 370,
        volts: 28.1,
        amps: 4,
      },
    },
    attitudeHold: { pitchDeg: cruisePitch, bankDeg: 0 },
    env: { windFromTrue: 280, windKt: 12, qnhInHg: 30.12, isaDeviationC: 0 },
    radios: {
      com: [
        { activeKhz: 126100, standbyKhz: 122975 },
        { activeKhz: 125225, standbyKhz: 121500 },
      ],
      nav: [
        { activeKhz: 112100, standbyKhz: 113500 },
        { activeKhz: 114300, standbyKhz: 116300 },
      ],
      micCom: 0,
      navIdent: [false, false],
    },
    xpdr: { code: '1200', mode: 'ALT', identUntil: null },
    bugs: {
      headingMag: 310,
      altitudeFt: 3500,
      verticalSpeedFpm: 500,
      airspeedKt: 90,
      baroInHg: 30.12,
      baroStd: false,
      minimumsFt: null,
    },
    nav: { cdiSource: 'GPS', obsMag: [310, 360], bearing1: 'OFF', bearing2: 'OFF' },
    fms: {
      ...EMPTY_FMS,
      plan: [KJYO, MRB, KHGR],
      activeLeg: { from: KJYO, to: MRB, planIndex: 1, isDirectTo: false },
      revision: 1,
    },
    ap: {
      engaged: false,
      flightDirector: false,
      lateral: 'ROL',
      vertical: 'PIT',
      altitudeArmed: false,
      lateralArmed: null,
      gpss: false,
      pitchRefDeg: cruisePitch,
      altitudeRefFt: START.altitudeFt,
      rollRefDeg: 0,
    },
    controls: { roll: 0, pitch: 0 },
    messages: [],
  };
}
