import { angleDiff, bearing, distanceNm } from '../../../core/geo';
import type { MagneticModel } from '../../../core/magvar';
import type { Waypoint } from '../../../core/navdb';
import { holdEntry, type GpsSolution } from '../../../sim/fms';
import type { FmsState, RouteLeg } from '../../../sim/types';

/*
 * Turn advisories and waypoint alerts shown in place of the page indicator
 * ("This part of the screen is also used to display the turn advisories
 * (e.g. "DTK 313° 9 S", or "LT TO 030° NOW") and waypoint alerts (e.g.
 * "ARRIVING WPT" or "HOLD TEARDROP")"). On an approach the next course is the
 * next leg's own (a climb to an altitude, a heading), the MAP gets "ARRIVING
 * WPT" (sequencing stops there) and a hold coming up gets its entry.
 */

const ADVISORY_SECONDS = 10;
/** The hold entry is recommended "just prior to crossing" the holding fix. */
const HOLD_ENTRY_SECONDS = 30;
const HOLDS = new Set(['HM', 'HA', 'HF']);

/**
 * Distance before the waypoint where the next leg starts: a standard-rate
 * turn's lead, the same rule the simulator sequences legs with.
 */
function turnLeadNm(groundSpeedKt: number, turnDeg: number): number {
  if (turnDeg < 5) return 0.05;
  const radius = groundSpeedKt / (20 * Math.PI);
  return Math.min(radius * Math.tan(((Math.min(turnDeg, 120) / 2) * Math.PI) / 180), 3);
}

const sameFix = (a: Waypoint, b: Waypoint) => a.ident === b.ident && distanceNm(a, b) < 0.5;

type Next =
  | { readonly kind: 'course'; readonly courseMag: number }
  | { readonly kind: 'hold'; readonly inboundTrue: number; readonly turn: 'L' | 'R' }
  | { readonly kind: 'arrive' };

/** What follows the active waypoint: the next course, a hold entered there, or the end (arrival). */
function nextAfter(gps: GpsSolution, fms: FmsState, mag: MagneticModel): Next {
  const to = gps.to!;
  const a = fms.approach;
  const index = fms.activeLeg?.approachIndex;
  if (a && index !== null && index !== undefined) {
    const leg: RouteLeg | undefined = a.legs[index];
    // At the MAP sequencing suspends: the unit announces the arrival, not a turn.
    if (!leg || leg.role === 'MAP') return { kind: 'arrive' };
    const next = a.legs[index + 1];
    if (!next) return { kind: 'arrive' };
    if (HOLDS.has(next.path) && next.to && sameFix(next.to, to) && next.courseTrue !== undefined) {
      return { kind: 'hold', inboundTrue: next.courseTrue, turn: next.turn ?? 'R' };
    }
    if (next.courseMag !== undefined && !next.to) return { kind: 'course', courseMag: next.courseMag };
    if (next.to && !sameFix(next.to, to)) return { kind: 'course', courseMag: mag.toMagnetic(bearing(to, next.to), to.lat, to.lon) };
    if (next.courseMag !== undefined) return { kind: 'course', courseMag: next.courseMag };
    return { kind: 'arrive' };
  }
  if (!gps.next || sameFix(gps.next, to)) return { kind: 'arrive' };
  return { kind: 'course', courseMag: mag.toMagnetic(bearing(to, gps.next), to.lat, to.lon) };
}

const deg = (mag: number) => String(Math.round(((mag % 360) + 360) % 360) || 360).padStart(3, '0');

export function advisory(gps: GpsSolution, fms: FmsState, groundSpeedKt: number, trackTrue: number, mag: MagneticModel): string | null {
  if (!gps.active || gps.valid === false || gps.obsMode || !gps.to || gps.distanceNm === null || groundSpeedKt < 30) return null;
  const seconds = (nm: number) => (nm / groundSpeedKt) * 3600;

  // A hold set up at the active waypoint (an OBS hold doesn't come here: OBS mode returned above).
  const h = fms.hold;
  if (h && h.entryStep === 'toFix' && sameFix(h.fix, gps.to)) {
    if (seconds(gps.distanceNm) > HOLD_ENTRY_SECONDS) return null;
    const inboundTrue = h.inboundCourseTrue ?? mag.toTrue(h.inboundCourseMag, h.fix.lat, h.fix.lon);
    return `HOLD ${holdEntry(trackTrue, inboundTrue, h.turn).toUpperCase()}`;
  }

  const next = nextAfter(gps, fms, mag);
  if (next.kind === 'arrive') return seconds(gps.distanceNm) <= ADVISORY_SECONDS ? 'ARRIVING WPT' : null;
  if (next.kind === 'hold') {
    return seconds(gps.distanceNm) <= HOLD_ENTRY_SECONDS ? `HOLD ${holdEntry(trackTrue, next.inboundTrue, next.turn).toUpperCase()}` : null;
  }
  const turn = gps.dtkMag === null ? 0 : angleDiff(next.courseMag, gps.dtkMag);
  const left = seconds(gps.distanceNm - turnLeadNm(groundSpeedKt, Math.abs(turn)));
  if (left > ADVISORY_SECONDS) return null;
  const when = left > 0.5 ? `${Math.ceil(left)} S` : 'NOW';
  if (Math.abs(turn) < 5) return `DTK ${deg(next.courseMag)}° ${when}`;
  return `${turn > 0 ? 'RT' : 'LT'} TO ${deg(next.courseMag)}° ${when}`;
}
