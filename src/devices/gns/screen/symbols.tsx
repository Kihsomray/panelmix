import type { Airport, AnyWaypoint, Navaid } from '../../../core/navdb';
import { isAirportRecord, isNavaidRecord } from '../model/data';

/*
 * Small symbols of the GNS screens: the Garmin direct-to glyph, airport,
 * VOR and NDB symbols as they appear in lists and on identifier lines.
 */

/** The direct-to glyph: a D crossed by an arrow. Magenta on the screen, white on the key. */
export function DtoGlyph({ w, color = 'currentColor' }: { w: number; color?: string }) {
  return (
    <svg class="gns-sym" width={w} height={w * 0.55} viewBox="0 0 22 12" aria-hidden="true">
      <path d="M1 6H19.5" stroke={color} stroke-width="1.8" fill="none" />
      <path d="M15.5 2.2L20.5 6L15.5 9.8" stroke={color} stroke-width="1.8" fill="none" stroke-linejoin="miter" />
      <path d="M6.5 1.4H10.2A4.6 4.6 0 0 1 10.2 10.6H6.5Z" stroke={color} stroke-width="1.8" fill="none" />
    </svg>
  );
}

/** Airport: magenta disc with the longest runway drawn across it; an open circle for soft fields. */
export function AirportSym({ a, size }: { a: Airport; size: number }) {
  const hdg = a.runways[0]?.ends[0].headingTrue ?? 0;
  return (
    <svg class="gns-sym" width={size} height={size} viewBox="-6 -6 12 12" aria-hidden="true">
      {a.hardSurface ? (
        <>
          <circle r="5.2" fill="#d63aa0" />
          <path d={`M0 -4V4`} stroke="#fff" stroke-width="1.8" transform={`rotate(${hdg})`} />
        </>
      ) : (
        <circle r="4.4" fill="none" stroke="#d63aa0" stroke-width="1.6" />
      )}
    </svg>
  );
}

/** VOR (cyan compass hexagon) or NDB (dotted ring). */
export function NavaidSym({ n, size }: { n: Navaid; size: number }) {
  if (n.kind === 'ndb') {
    const dots = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return <circle key={i} cx={Math.cos(a) * 4.4} cy={Math.sin(a) * 4.4} r="0.85" fill="#c77ad8" />;
    });
    return (
      <svg class="gns-sym" width={size} height={size} viewBox="-6 -6 12 12" aria-hidden="true">
        {dots}
        <circle r="1.3" fill="#c77ad8" />
      </svg>
    );
  }
  return (
    <svg class="gns-sym" width={size} height={size} viewBox="-6 -6 12 12" aria-hidden="true">
      <path d="M-4.6 0L-2.3 -4L2.3 -4L4.6 0L2.3 4L-2.3 4Z" fill="none" stroke="#2ad8ff" stroke-width="1.4" />
      {n.type === 'VORTAC' && <path d="M-1.5 -4.8H1.5M3.4 2.9L4.9 0.3M-3.4 2.9L-4.9 0.3" stroke="#2ad8ff" stroke-width="2" />}
      <circle r="1.1" fill="#2ad8ff" />
    </svg>
  );
}

/** The magenta leg arrow between two identifiers. */
export function LegArrow({ w }: { w: number }) {
  return (
    <svg class="gns-sym" width={w} height={w * 0.5} viewBox="0 0 20 10" aria-hidden="true">
      <path d="M0 5H13" stroke="#ff40ff" stroke-width="2.6" />
      <path d="M11 0.8L19.5 5L11 9.2Z" fill="#ff40ff" />
    </svg>
  );
}

/** The symbol for whatever kind of waypoint a record is (nothing for user waypoints). */
export function WaypointSym({ w, size }: { w: AnyWaypoint | undefined; size: number }) {
  if (w && isAirportRecord(w)) return <AirportSym a={w} size={size} />;
  if (w && isNavaidRecord(w)) return <NavaidSym n={w} size={size} />;
  return null;
}
