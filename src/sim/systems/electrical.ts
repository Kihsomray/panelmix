/*
 * A Cessna 172S style 28 V electrical system: the alternator regulates the
 * bus at about 28 V and keeps a 24 V lead-acid battery charged. With the
 * alternator off line the battery alone carries the bus: the voltage drops
 * at once to about 24 V (LOW VOLTS), sags as the charge goes, collapses near
 * the end, and the avionics drop off line when it is flat, a little over
 * half an hour later at the trainer's fixed load (there are no switches to
 * shed load with).
 */

export const ELECTRICAL = {
  /** Usable capacity down to flat, Ah (a 24 V, 13.6 Ah main battery at a heavy load). */
  capacityAh: 10.5,
  /** Drawn from the battery with the alternator off line, A: avionics, flight instruments, lights off. */
  loadAmps: 18,
  /** LOW VOLTS below this (main bus). */
  lowVolts: 24.5,
  /** The alternator needs the engine, or a windmilling propeller, turning at least this fast. */
  alternatorMinRpm: 650,
  maxChargeAmps: 25,
  chargeEfficiency: 0.85,
  /** A flat battery's voltage: too low for any avionics. */
  flatVolts: 17.2,
} as const;

export interface ElectricalSolution {
  readonly busVolts: number;
  /** Positive while charging. */
  readonly batteryAmps: number;
  readonly alternatorOnline: boolean;
  readonly avionicsPowered: boolean;
}

/**
 * Terminal voltage of the battery delivering `amps`: open-circuit voltage
 * from 23.0 V (empty) to 25.2 V (full), an internal resistance that rises as
 * it discharges, and the knee of a lead-acid cell near empty.
 */
export function batteryTerminalVolts(charge: number, amps: number): number {
  const c = Math.min(Math.max(charge, 0), 1);
  const openCircuit = 23.0 + 2.2 * c;
  const resistance = 0.05 + 0.05 * (1 - c);
  const knee = c < 0.15 ? 4 * ((0.15 - c) / 0.15) ** 2 : 0;
  return openCircuit - amps * resistance - knee;
}

export function electricalSolution(charge: number, alternatorFailed: boolean, rpm: number, throttle: number): ElectricalSolution {
  if (!alternatorFailed && rpm >= ELECTRICAL.alternatorMinRpm) {
    // A discharged battery takes a large charge that tapers off as it fills.
    const amps = Math.min(ELECTRICAL.maxChargeAmps, 1 + 40 * (1 - charge));
    return { busVolts: 28 + 0.1 * Math.min(Math.max(throttle, 0), 1), batteryAmps: amps, alternatorOnline: true, avionicsPowered: true };
  }
  if (charge <= 0) return { busVolts: ELECTRICAL.flatVolts, batteryAmps: 0, alternatorOnline: false, avionicsPowered: false };
  return {
    busVolts: batteryTerminalVolts(charge, ELECTRICAL.loadAmps),
    batteryAmps: -ELECTRICAL.loadAmps,
    alternatorOnline: false,
    avionicsPowered: true,
  };
}

/** State of charge after `dt` seconds at `amps` (positive charging). */
export function stepBattery(charge: number, amps: number, dt: number): number {
  if (amps === 0) return charge;
  const ah = ((amps > 0 ? amps * ELECTRICAL.chargeEfficiency : amps) * dt) / 3600;
  return Math.min(Math.max(charge + ah / ELECTRICAL.capacityAh, 0), 1);
}

/** Minutes the battery can carry the bus on its own from this state of charge. */
export function batteryMinutes(charge: number): number {
  return ((Math.max(charge, 0) * ELECTRICAL.capacityAh) / ELECTRICAL.loadAmps) * 60;
}
