import type { NavDatabase, Waypoint } from '../../../core/navdb';
import type { ActiveLeg } from '../../../sim/types';
import { MapView, ORIENTATION_LABEL, rangeLabel, type MapOrientation } from '../screen/MapView';

/*
 * The PFD inset map in the lower left corner (INSET softkey). RANGE on the
 * PFD changes its range and pushing the joystick shows the map pointer.
 * TRAFFIC and TERRAIN have no data in the trainer and say so on the map
 * instead of drawing nothing silently.
 */

/** Inset map position on the PFD (native px). */
export const INSET_RECT = { x: 8, y: 508, w: 228, h: 208 } as const;
const RECT = INSET_RECT;

export interface InsetMapProps {
  readonly db: NavDatabase;
  readonly ownship: { lat: number; lon: number; headingTrue: number; trackTrue: number };
  readonly rangeNm: number;
  readonly orientation: MapOrientation;
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  readonly planRevision: number;
  readonly declutter: number;
  readonly topo: boolean;
  readonly traffic: boolean;
  readonly terrain: boolean;
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** Identifier under the pointer, offered to the D-> key. */
  readonly pointerLabel: string | null;
}

export function InsetMap(p: InsetMapProps) {
  return (
    <div class="g1000-inset" style={{ left: `${RECT.x}px`, top: `${RECT.y}px`, width: `${RECT.w}px`, height: `${RECT.h}px` }}>
      <MapView
        x={0}
        y={0}
        w={RECT.w}
        h={RECT.h}
        db={p.db}
        ownship={p.ownship}
        rangeNm={p.rangeNm}
        orientation={p.orientation}
        plan={p.plan}
        activeLeg={p.activeLeg}
        planRevision={p.planRevision}
        declutter={p.declutter}
        topo={p.topo}
        pointer={p.pointer}
        label="Inset map"
      />
      <div class="g1000-maptag g1000-maptag-tr">{ORIENTATION_LABEL[p.orientation]}</div>
      {p.declutter > 0 && <div class="g1000-maptag g1000-maptag-tl">DCLTR {p.declutter}</div>}
      {p.pointer && p.pointerLabel && <div class="g1000-maptag g1000-maptag-tl g1000-cyan">{p.pointerLabel}</div>}
      {(p.traffic || p.terrain) && (
        <div class="g1000-maptag g1000-maptag-bl g1000-yellow">{p.traffic ? 'TRAFFIC NO DATA' : 'TERRAIN NO DATA'}</div>
      )}
      <div class="g1000-maptag g1000-maptag-br">
        {rangeLabel(p.rangeNm)}
        <small class="g1000-unit">NM</small>
      </div>
    </div>
  );
}
