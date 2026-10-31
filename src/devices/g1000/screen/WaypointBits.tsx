import type { AnyWaypoint, WaypointKind } from '../../../core/navdb';
import type { IdentEntry } from '../../../ui/identEntry';

/*
 * Small pieces used wherever a waypoint is shown: the identifier field with
 * the knob-entry cursor, the waypoint symbol and the facility/city text.
 */

/**
 * The identifier field. Highlighted (cyan) when the cursor is on it; while
 * editing, the character under the cursor is shown inverse and the
 * spelled-ahead remainder in white.
 */
export function IdentField({ entry, editing, cursor, width = 6 }: { entry: IdentEntry; editing: boolean; cursor: boolean; width?: number }) {
  const text = entry.text.padEnd(width, editing ? '_' : ' ').slice(0, Math.max(width, entry.text.length));
  if (!editing) {
    return <span class={`g1000-ident${cursor ? ' is-cursor' : ''}`}>{text.trimEnd() || '_'.repeat(width)}</span>;
  }
  return (
    <span class="g1000-ident is-editing">
      {[...text].map((ch, i) => (
        <span key={i} class={i === entry.cursor ? 'g1000-ident-cur' : i < entry.cursor ? 'g1000-ident-set' : 'g1000-ident-ahead'}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}

export function WaypointSymbol({ kind, towered = false }: { kind: WaypointKind; towered?: boolean }) {
  const color = kind === 'airport' ? (towered ? '#3aa0ff' : '#e34fe3') : kind === 'ndb' ? '#b07ad0' : '#3aa0ff';
  return (
    <svg class="g1000-wpsym" viewBox="-10 -10 20 20" aria-hidden="true">
      {kind === 'airport' && (
        <g stroke={color} stroke-width={2.2} fill="none">
          <circle r={6} />
          <path d="M-4.2 -4.2 l-2.5 -2.5 M4.2 -4.2 l2.5 -2.5 M-4.2 4.2 l-2.5 2.5 M4.2 4.2 l2.5 2.5" />
        </g>
      )}
      {kind === 'vor' && <path d="M-7 0 L-3.5 -6 H3.5 L7 0 L3.5 6 H-3.5 Z" fill="none" stroke={color} stroke-width={2} />}
      {kind === 'ndb' && (
        <g fill={color}>
          <circle r={2} />
          {Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={Math.cos((i / 10) * Math.PI * 2) * 7} cy={Math.sin((i / 10) * Math.PI * 2) * 7} r={1.1} />
          ))}
        </g>
      )}
      {kind === 'user' && <rect x={-5} y={-5} width={10} height={10} fill="none" stroke="#fff" stroke-width={2} />}
    </svg>
  );
}

/** "LEESBURG VA" for airports, the facility name otherwise. */
export function cityOf(w: AnyWaypoint | undefined): string {
  if (!w) return '';
  if ('city' in w && typeof w.city === 'string') return `${w.city}${'state' in w && w.state ? ` ${w.state}` : ''}`.toUpperCase();
  return '';
}

export function nameOf(w: AnyWaypoint | undefined): string {
  return w ? w.name.toUpperCase() : '';
}

export function isTowered(w: AnyWaypoint | undefined): boolean {
  return !!w && 'towered' in w && w.towered === true;
}
