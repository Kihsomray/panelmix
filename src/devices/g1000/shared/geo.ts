import { bearing, distanceNm, type LatLon } from '../../../core/geo';
import type { MagneticModel } from '../../../core/magvar';

/** Magnetic bearing and distance from the airplane to a point, as Garmin pages show them. */
export function bearingDistance(from: LatLon, to: LatLon, mag: MagneticModel): { bearingMag: number; distanceNm: number } {
  return { bearingMag: mag.toMagnetic(bearing(from, to), from.lat, from.lon), distanceNm: distanceNm(from, to) };
}
