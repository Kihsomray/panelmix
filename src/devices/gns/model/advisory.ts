import { angleDiff, bearing } from '../../../core/geo';
import type { MagneticModel } from '../../../core/magvar';
import type { GpsSolution } from '../../../sim/fms';

/*
 * Turn advisories and waypoint alerts shown in place of the page indicator
 * ("This part of the screen is also used to display the turn advisories
 * (e.g. "DTK 313° 9 S", or "LT TO 030° NOW") and waypoint alerts").
 */

const ADVISORY_SECONDS = 10;

/**
 * Distance before the waypoint where the next leg starts: a standard-rate
 * turn's lead, the same rule the simulator sequences legs with.
 */
function turnLeadNm(groundSpeedKt: number, turnDeg: number): number {
  if (turnDeg < 5) return 0.05;
  const radius = groundSpeedKt / (20 * Math.PI);
  return Math.min(radius * Math.tan(((Math.min(turnDeg, 120) / 2) * Math.PI) / 180), 3);
}

export function advisory(gps: GpsSolution, groundSpeedKt: number, mag: MagneticModel): string | null {
  if (!gps.active || gps.obsMode || !gps.to || gps.distanceNm === null || groundSpeedKt < 30) return null;
  if (!gps.next) {
    return (gps.distanceNm / groundSpeedKt) * 3600 <= ADVISORY_SECONDS ? 'ARRIVING WPT' : null;
  }
  const to = gps.to;
  const nextDtk = mag.toMagnetic(bearing(to, gps.next), to.lat, to.lon);
  const turn = gps.dtkMag === null ? 0 : angleDiff(nextDtk, gps.dtkMag);
  const seconds = ((gps.distanceNm - turnLeadNm(groundSpeedKt, Math.abs(turn))) / groundSpeedKt) * 3600;
  if (seconds > ADVISORY_SECONDS) return null;
  const course = String(Math.round(nextDtk) % 360 || 360).padStart(3, '0');
  const when = seconds > 0.5 ? `${Math.ceil(seconds)} S` : 'NOW';
  if (Math.abs(turn) < 5) return `DTK ${course}° ${when}`;
  return `${turn > 0 ? 'RT' : 'LT'} TO ${course}° ${when}`;
}
