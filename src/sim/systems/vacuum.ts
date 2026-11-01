import { angleDiff } from '../../core/geo';
import { hash01, smoothNoise } from './noise';

/*
 * The vacuum system: an engine-driven pump spins the gyros of the analog
 * attitude indicator and heading indicator. When suction is lost (pump
 * failure, or a stopped engine) nothing is flagged: the rotors keep their
 * rigidity for a little while, then spin down over several minutes. The
 * attitude indicator slowly tips over to a wrong attitude and stops
 * following the airplane, and the heading indicator precesses quickly and
 * then stops turning with it, which is what makes the failure dangerous.
 */

export const VACUUM = {
  /** Suction above idle with a working pump, inHg (green arc 4.5 to 5.5). */
  normalInHg: 5.0,
  /** LOW VACUUM below this. */
  lowInHg: 3.0,
  /** Rotor spin-down and spin-up time constants, s. */
  spinDownS: 150,
  spinUpS: 45,
  /** Heading indicator precession at its worst (rotor half spun down), deg/s: 9 degrees a minute. */
  headingDriftMaxDps: 0.15,
  /** Where a fully tumbled attitude indicator settles: bank 30 to 60 degrees either way, pitch within 15. */
  tumbleBankMinDeg: 30,
  tumbleBankSpanDeg: 30,
  tumblePitchSpanDeg: 30,
  /** Slow wander of a spun-down gyro, deg RMS. */
  wanderDeg: 2,
} as const;

/** Suction from the engine-driven pump: about 5 inHg above idle, none with a failed pump or a stopped engine. */
export function suctionInHg(pumpFailed: boolean, rpm: number): number {
  return pumpFailed ? 0 : Math.min(VACUUM.normalInHg, (Math.max(rpm, 0) / 1000) * 4.6);
}

/** Gyro rotor speed after `dt` seconds: spins down slowly without suction, back up faster when it returns. */
export function stepGyroRotor(rotor: number, suction: number, dt: number): number {
  const target = Math.min(Math.max(suction / VACUUM.lowInHg, 0), 1);
  if (rotor === target) return rotor;
  const tau = target < rotor ? VACUUM.spinDownS : VACUUM.spinUpS;
  const next = target + (rotor - target) * Math.exp(-dt / tau);
  // Settle exactly so a recovered system stops changing the state.
  return Math.abs(next - target) < 1e-4 ? target : next;
}

/**
 * How firmly the gyros hold their reference. A rotor above 85 % speed is as
 * good as new; below 10 % it holds nothing.
 */
export function gyroRigidity(rotor: number): number {
  return Math.min(Math.max((rotor - 0.1) / 0.75, 0), 1);
}

const seedFor = (lostAt: number) => Math.floor(lostAt * 20);

/**
 * What the attitude indicator shows: the truth while the gyro is rigid,
 * blending toward a tumbled attitude (seeded by when the vacuum was lost)
 * that no longer follows the airplane as the rotor spins down.
 */
export function vacuumAttitude(
  pitchDeg: number,
  bankDeg: number,
  rigidity: number,
  lostAt: number | null,
  time: number,
): { readonly pitchDeg: number; readonly bankDeg: number } {
  if (rigidity >= 1 || lostAt === null) return { pitchDeg, bankDeg };
  const seed = seedFor(lostAt);
  const side = hash01(seed) < 0.5 ? -1 : 1;
  const tumbleBank = side * (VACUUM.tumbleBankMinDeg + VACUUM.tumbleBankSpanDeg * hash01(seed + 1));
  const tumblePitch = (hash01(seed + 2) - 0.5) * VACUUM.tumblePitchSpanDeg;
  const loose = 1 - rigidity;
  const wander = loose * VACUUM.wanderDeg * smoothNoise(time, 0.02, seed + 3);
  return {
    pitchDeg: rigidity * pitchDeg + loose * tumblePitch + 0.5 * wander,
    bankDeg: rigidity * bankDeg + loose * tumbleBank + wander,
  };
}

/**
 * Heading indicator error after `dt` seconds. A weakening gyro follows only
 * part of each turn (the card stops turning once it has spun down) and
 * precesses fastest when half spun down.
 */
export function stepHeadingIndicatorError(
  errorDeg: number,
  rigidity: number,
  turnRateDps: number,
  lostAt: number | null,
  dt: number,
): number {
  if (rigidity >= 1) return errorDeg;
  const seed = lostAt === null ? 0 : seedFor(lostAt);
  const sign = hash01(seed + 4) < 0.5 ? -1 : 1;
  const drift = sign * 4 * rigidity * (1 - rigidity) * VACUUM.headingDriftMaxDps;
  return angleDiff(errorDeg + ((rigidity - 1) * turnRateDps + drift) * dt, 0);
}
