import type { PlanLegInfo } from '../../../sim/fms';
import type { ActiveLeg } from '../../../sim/types';
import { formatBearing, formatDistance } from '../../../ui/format';
import type { FplCursor } from '../shared/flightPlan';
import { IdentField } from './WaypointBits';

/*
 * Flight plan rows: identifier, desired track and leg distance, with the
 * magenta active-leg arrow in the left gutter (from the leg's origin to the
 * active waypoint) and the cursor on the selected row. While an identifier
 * is being entered it appears as a new row above the cursor row, where ENT
 * will insert it. An empty row at the end takes new waypoints.
 */

export interface FplListProps {
  readonly legs: readonly PlanLegInfo[];
  readonly activeLeg: ActiveLeg | null;
  readonly cursor: FplCursor;
  /** First visible row. */
  readonly scroll: number;
  readonly rows: number;
  readonly rowH: number;
  /** Show the altitude column (MFD). */
  readonly wide?: boolean;
}

type Row = { kind: 'leg'; leg: PlanLegInfo } | { kind: 'entry' } | { kind: 'end' };

/** Display rows, including the entry row while inserting and the empty end row. */
function fplRows(legs: readonly PlanLegInfo[], cursor: FplCursor): Row[] {
  const rows: Row[] = legs.map((leg) => ({ kind: 'leg', leg }));
  rows.push({ kind: 'end' });
  if (cursor.entry && cursor.index !== null) rows.splice(cursor.index, 0, { kind: 'entry' });
  return rows;
}

export function FplList({ legs, activeLeg, cursor, scroll, rows, rowH, wide = false }: FplListProps) {
  const all = fplRows(legs, cursor);
  const shown = all.slice(scroll, scroll + rows);
  const entryAt = cursor.entry && cursor.index !== null ? cursor.index : null;
  // Display row of a plan index, accounting for the entry row inserted above the cursor.
  const rowOf = (planIndex: number) => planIndex + (entryAt !== null && planIndex >= entryAt ? 1 : 0) - scroll;
  const toIndex = activeLeg?.planIndex ?? null;
  const fromIndex = toIndex !== null && !activeLeg?.isDirectTo && toIndex > 0 ? toIndex - 1 : null;

  let arrow = null;
  if (toIndex !== null) {
    const yTo = rowOf(toIndex) * rowH + rowH / 2;
    const yFrom = fromIndex !== null ? rowOf(fromIndex) * rowH + rowH / 2 : null;
    const top = Math.max(yFrom ?? yTo, -4);
    if (yTo >= 0 && yTo <= rows * rowH) {
      arrow =
        yFrom !== null ? (
          <path d={`M12 ${top} H4 V${yTo} H12 M8 ${yTo - 5} L13 ${yTo} L8 ${yTo + 5}`} stroke="#ff40ff" stroke-width={3} fill="none" />
        ) : (
          // Direct-to: the Garmin direct-to arrow points at the active waypoint.
          <path d={`M1 ${yTo} H12 M8 ${yTo - 5} L13 ${yTo} L8 ${yTo + 5}`} stroke="#ff40ff" stroke-width={3} fill="none" />
        );
    }
  }

  return (
    <div class={`g1000-fpl${wide ? ' is-wide' : ''}`} style={{ height: `${rows * rowH}px` }}>
      <svg class="g1000-fpl-arrow" width={16} height={rows * rowH} aria-hidden="true">
        {arrow}
      </svg>
      {shown.map((row, i) => {
        const index = scroll + i;
        const y = { top: `${i * rowH}px`, height: `${rowH}px` };
        if (row.kind === 'entry') {
          return (
            <div key="entry" class="g1000-fpl-row" style={y}>
              <span class="g1000-fpl-id">{cursor.entry && <IdentField entry={cursor.entry} editing cursor />}</span>
            </div>
          );
        }
        if (row.kind === 'end') {
          const onEnd = entryAt === null && cursor.index === legs.length;
          return (
            <div key="end" class="g1000-fpl-row" style={y}>
              <span class={`g1000-fpl-id${onEnd ? ' is-cursor' : ''}`}>_____</span>
            </div>
          );
        }
        const { leg } = row;
        const isCursor = entryAt === null && cursor.index === leg.index;
        const active = leg.isActive;
        // The active waypoint shows the distance still to go; the others their leg length.
        const dis = active && leg.cumulativeNm !== null ? leg.cumulativeNm : leg.legNm;
        return (
          <div key={`${leg.index}-${index}`} class={`g1000-fpl-row${active ? ' is-active' : ''}`} style={y}>
            <span class={`g1000-fpl-id${isCursor ? ' is-cursor' : ''}`}>{leg.waypoint.ident}</span>
            <span class="g1000-fpl-dtk">{leg.dtkMag !== null ? formatBearing(leg.dtkMag) : '___°'}</span>
            <span class="g1000-fpl-dis">
              {dis !== null ? formatDistance(dis) : '____'}
              <small class="g1000-unit">NM</small>
            </span>
            {wide && (
              <span class="g1000-fpl-alt">
                _____<small class="g1000-unit">FT</small>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
