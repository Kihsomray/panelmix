import type { AnyWaypoint } from '../../../core/navdb';
import { formatBearing, formatDistance } from '../../../ui/format';
import type { DirectToLists, DirectToState } from '../shared/directTo';
import { Field, Group, Win, type Rect } from './Frames';
import { cityOf, IdentField, isTowered, nameOf, WaypointSymbol } from './WaypointBits';

/*
 * The Direct-to window: compact on the PFD (Figure 5-52), a column of boxes
 * beside the map on the MFD (Figure 5-51). The VNV altitude/offset and HOLD
 * fields are shown as on the unit but are not used by the trainer (no
 * vertical navigation or holds), so the cursor skips them.
 */

export interface DirectToView {
  readonly state: DirectToState;
  /** Flight plan and nearest identifiers for the waypoint submenu. */
  readonly lists: DirectToLists;
  /** The database record the identifier resolves to, if any. */
  readonly waypoint: AnyWaypoint | undefined;
  /** From the present position, magnetic. */
  readonly bearingMag: number | null;
  readonly distanceNm: number | null;
}

function Identity({ v }: { v: DirectToView }) {
  const s = v.state;
  return (
    <>
      <div class="g1000-row">
        <IdentField entry={s.entry} editing={s.editing} cursor={s.field === 'ident'} />
        {v.waypoint && <WaypointSymbol kind={v.waypoint.kind} towered={isTowered(v.waypoint)} />}
        <span class="g1000-dim">{cityOf(v.waypoint)}</span>
      </div>
      <div class="g1000-row g1000-wpname">{nameOf(v.waypoint) || ' '}</div>
    </>
  );
}

/** The waypoint submenu (small FMS knob counter-clockwise): FPL and NRST lists. */
function WaypointLists({ v }: { v: DirectToView }) {
  const open = v.state.list;
  if (!open) return null;
  const items = v.lists[open.kind];
  const first = Math.min(Math.max(open.index - 3, 0), Math.max(items.length - 7, 0));
  return (
    <div class="g1000-wplist">
      <div class="g1000-wplist-tabs">
        {(['FPL', 'NRST'] as const).map((k) => (
          <span key={k} class={k === open.kind ? 'is-current' : ''}>
            {k}
          </span>
        ))}
      </div>
      {items.length === 0 && <div class="g1000-menu-item is-disabled">{open.kind === 'FPL' ? 'No flight plan' : 'NONE WITHIN 200NM'}</div>}
      {items.slice(first, first + 7).map((ident, i) => (
        <div key={`${ident}${first + i}`} class={`g1000-menu-item${first + i === open.index ? ' is-cursor' : ''}`}>
          {ident}
        </div>
      ))}
    </div>
  );
}

function Commands({ v }: { v: DirectToView }) {
  return (
    <div class="g1000-row g1000-dto-cmds">
      <Field on={v.state.field === 'activate'} class="g1000-cmd">
        ACTIVATE?
      </Field>
      <span class="g1000-cmd is-disabled">HOLD?</span>
    </div>
  );
}

export function DirectToWindow({ v, rect }: { v: DirectToView; rect: Rect }) {
  return (
    <Win rect={rect} title="DIRECT TO" class="g1000-dto">
      <Group title="">
        <Identity v={v} />
      </Group>
      <Group title="" class="is-disabled">
        <div class="g1000-row g1000-split">
          <span>
            ALT <span class="g1000-dim">_____FT</span>
          </span>
          <span>
            OFFSET <span class="g1000-dim">+0NM</span>
          </span>
        </div>
      </Group>
      <Group title="">
        <div class="g1000-row g1000-split">
          <span>
            BRG <b class="g1000-cyan">{formatBearing(v.bearingMag)}</b>
          </span>
          <span>
            DIS <b class="g1000-cyan">{formatDistance(v.distanceNm)}</b>
            <small class="g1000-unit">NM</small>
          </span>
        </div>
        <div class="g1000-row">
          CRS <b class="g1000-cyan">{formatBearing(v.bearingMag)}</b>
        </div>
      </Group>
      <Commands v={v} />
      <WaypointLists v={v} />
    </Win>
  );
}

export function DirectToColumn({ v, rect }: { v: DirectToView; rect: Rect }) {
  return (
    <Win rect={rect} title="DIRECT TO" class="g1000-dto g1000-dto-mfd">
      <Group title="IDENT, FACILITY, CITY">
        <Identity v={v} />
        <div class="g1000-row g1000-dim">{cityOf(v.waypoint) || ' '}</div>
      </Group>
      <Group title="VNV" class="is-disabled">
        <div class="g1000-row g1000-split">
          <span class="g1000-dim">_____FT</span>
          <span class="g1000-dim">+0NM</span>
        </div>
      </Group>
      <Group title="LOCATION">
        <div class="g1000-row g1000-split">
          <span>
            BRG <b class="g1000-cyan">{formatBearing(v.bearingMag)}</b>
          </span>
          <span>
            DIS <b class="g1000-cyan">{formatDistance(v.distanceNm)}</b>
            <small class="g1000-unit">NM</small>
          </span>
        </div>
      </Group>
      <Group title="COURSE">
        <div class="g1000-row">
          <b class="g1000-cyan">{formatBearing(v.bearingMag)}</b>
        </div>
      </Group>
      <Commands v={v} />
      <WaypointLists v={v} />
    </Win>
  );
}
