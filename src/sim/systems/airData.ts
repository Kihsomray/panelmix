import {
  airspeedForImpactPressure,
  densityRatio,
  impactPressureInHg,
  pressureAltitude,
  pressureAltitudeForInHg,
  staticPressureInHg,
  STD_INHG,
  trueAirspeed,
} from '../atmosphere';
import type { SimState } from '../types';
import type { AirDataDerived } from './types';

/*
 * The pitot-static system: what the airspeed indicator, altimeter and VSI
 * show, and what an air data computer computes from the same tubes.
 *
 * A blocked port traps the pressure it had at that moment, and the
 * instruments keep converting the pressures they see:
 * - pitot (ram and drain blocked): trapped total pressure minus a changing
 *   static pressure, so the airspeed rises in a climb and falls in a descent,
 *   like an altimeter, and ignores real speed changes;
 * - static: the altimeter freezes, the VSI reads zero, and the airspeed
 *   reads low above the blockage altitude and high below it (about 10 kt per
 *   100 ft at 100 kt).
 */

/** Readings beyond any airspeed indicator's scale are pegged here. */
const MAX_INDICATED_KT = 300;

/** Pitot (total) pressure for a pressure altitude and indicated airspeed, inHg. */
export function totalPressureInHg(pressureAltitudeFt: number, iasKt: number): number {
  return staticPressureInHg(pressureAltitudeFt) + impactPressureInHg(iasKt);
}

/**
 * Indicated air data. `indicatedAltitudeFt` is what a working altimeter shows
 * with the shared Kollsman setting (the simulator computes it once).
 */
export function airData(state: SimState, indicatedAltitudeFt: number, oatC: number): AirDataDerived {
  const a = state.aircraft;
  const { failures: f, pitotTrappedInHg, staticTrappedInHg } = state.systems;
  const truePa = pressureAltitude(a.altitudeFt, state.env.qnhInHg);
  const valid = !f.adc;
  if (!f.pitot && !f.static) {
    return {
      valid,
      iasKt: a.iasKt,
      altitudeFt: indicatedAltitudeFt,
      pressureAltitudeFt: truePa,
      verticalSpeedFpm: a.verticalSpeedFpm,
      tasKt: a.tasKt,
      oatC,
    };
  }

  // Until the step that traps them, a fresh blockage holds the current pressures.
  const staticNow = staticPressureInHg(truePa);
  const staticSeen = f.static ? staticTrappedInHg ?? staticNow : staticNow;
  const totalSeen = f.pitot ? pitotTrappedInHg ?? staticNow + impactPressureInHg(a.iasKt) : staticNow + impactPressureInHg(a.iasKt);
  const pa = f.static ? pressureAltitudeForInHg(staticSeen) : truePa;
  const setting = state.bugs.baroStd ? STD_INHG : state.bugs.baroInHg;
  const iasKt = Math.min(airspeedForImpactPressure(totalSeen - staticSeen), MAX_INDICATED_KT);
  return {
    valid,
    iasKt,
    altitudeFt: f.static ? pa + (setting - STD_INHG) * 1000 : indicatedAltitudeFt,
    pressureAltitudeFt: pa,
    verticalSpeedFpm: f.static ? 0 : a.verticalSpeedFpm,
    // An air data computer works out TAS from what it measures, so it is wrong too.
    tasKt: trueAirspeed(iasKt, densityRatio(pa, state.env.isaDeviationC)),
    oatC,
  };
}
