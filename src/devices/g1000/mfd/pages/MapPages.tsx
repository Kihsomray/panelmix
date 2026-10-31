import type { LatLon } from '../../../../core/geo';
import type { AnyWaypoint, NavDatabase, Waypoint } from '../../../../core/navdb';
import type { ActiveLeg } from '../../../../sim/types';
import { formatBearing, formatDistance } from '../../../../ui/format';
import { AV } from '../../../../ui/instruments/palette';
import type { Rect } from '../../screen/Frames';
import { MapView, ORIENTATION_LABEL, rangeLabel, type MapOrientation } from '../../screen/MapView';
import type { MapSettings } from '../mfdSoftkeys';
import { PAGE } from '../layout';

/*
 * The MAP group: the Navigation Map (range, declutter, TOPO, map pointer,
 * profile view) and the Traffic and Terrain Proximity pages, which show
 * their real frame and say plainly that the trainer has no traffic or
 * terrain data.
 */

export interface MapBase {
  readonly db: NavDatabase;
  readonly ownship: { lat: number; lon: number; headingTrue: number; trackTrue: number };
  readonly orientation: MapOrientation;
  readonly plan: readonly Waypoint[];
  readonly activeLeg: ActiveLeg | null;
  readonly planRevision: number;
  readonly settings: MapSettings;
  readonly rangeNm: number;
}

export function PageMap({
  base,
  rect,
  center,
  highlight,
  pointer = null,
}: {
  base: MapBase;
  rect: Rect;
  center?: LatLon;
  highlight?: Waypoint | null;
  pointer?: { x: number; y: number } | null;
}) {
  return (
    <div class="g1000-pagemap" style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}>
      <MapView
        x={0}
        y={0}
        w={rect.w}
        h={rect.h}
        db={base.db}
        ownship={base.ownship}
        rangeNm={base.rangeNm}
        orientation={base.orientation}
        plan={base.plan}
        activeLeg={base.activeLeg}
        planRevision={base.planRevision}
        declutter={base.settings.declutter}
        topo={base.settings.topo}
        {...(center ? { center } : {})}
        highlight={highlight ?? null}
        pointer={pointer}
        label="Moving map"
      />
      <div class="g1000-maptag g1000-maptag-tr">{center ? ORIENTATION_LABEL.north : ORIENTATION_LABEL[base.orientation]}</div>
      <div class="g1000-maptag g1000-maptag-br g1000-range">
        {rangeLabel(base.rangeNm)}
        <small class="g1000-unit">NM</small>
      </div>
    </div>
  );
}

export interface PointerInfo {
  readonly target: AnyWaypoint | null;
  readonly bearingMag: number | null;
  readonly distanceNm: number | null;
}

/** Vertical profile strip (PROFILE softkey): altitude scale, the airplane and the selected altitude. */
function Profile({ altitudeFt, selectedFt, rangeNm }: { altitudeFt: number; selectedFt: number; rangeNm: number }) {
  const h = 120;
  const top = PAGE.h - h;
  const maxFt = Math.max(Math.ceil((Math.max(altitudeFt, selectedFt) + 2000) / 2000) * 2000, 4000);
  const y = (ft: number) => top + h - 14 - (ft / maxFt) * (h - 28);
  const marks = [0, maxFt / 2, maxFt];
  return (
    <svg class="g1000-layer" style={{ left: `${PAGE.x}px`, top: `${PAGE.y}px` }} width={PAGE.w} height={PAGE.h} aria-hidden="true">
      <rect x={0} y={top} width={PAGE.w} height={h} fill="rgba(0,0,0,0.88)" stroke="#8a949e" />
      {marks.map((ft) => (
        <g key={ft}>
          <line x1={46} x2={PAGE.w} y1={y(ft)} y2={y(ft)} stroke="#3c434a" />
          <text x={42} y={y(ft) + 5} text-anchor="end" font-size={13} fill={AV.white}>
            {ft}
          </text>
        </g>
      ))}
      <line x1={46} x2={PAGE.w} y1={y(selectedFt)} y2={y(selectedFt)} stroke={AV.cyan} stroke-dasharray="8 6" stroke-width={2} />
      <path d={`M60 ${y(altitudeFt)} l-14 -7 v14 Z`} fill={AV.white} />
      <text x={PAGE.w - 8} y={top + 16} text-anchor="end" font-size={13} fill={AV.white}>
        {rangeLabel(rangeNm)}NM
      </text>
    </svg>
  );
}

export function NavMapPage({
  base,
  pointer,
  pointerInfo,
  altitudeFt,
  selectedFt,
}: {
  base: MapBase;
  pointer: { x: number; y: number } | null;
  pointerInfo: PointerInfo | null;
  altitudeFt: number;
  selectedFt: number;
}) {
  const s = base.settings;
  return (
    <>
      <PageMap base={base} rect={PAGE} pointer={pointer} highlight={pointerInfo?.target ?? null} />
      {pointer && pointerInfo && (
        <div class="g1000-pointerinfo">
          <div class="g1000-cyan">{pointerInfo.target ? pointerInfo.target.ident : 'MAP POINTER'}</div>
          {pointerInfo.target && <div>{pointerInfo.target.name.toUpperCase()}</div>}
          {pointerInfo.bearingMag !== null && (
            <div>
              {formatBearing(pointerInfo.bearingMag)} {formatDistance(pointerInfo.distanceNm)}
              <small class="g1000-unit">NM</small>
            </div>
          )}
        </div>
      )}
      {(s.traffic || s.terrain) && (
        <div class="g1000-maptag g1000-yellow" style={{ left: `${PAGE.x}px`, top: `${PAGE.y}px` }}>
          {[s.traffic && 'TRAFFIC NO DATA', s.terrain && 'TERRAIN NO DATA'].filter(Boolean).join('  ')}
        </div>
      )}
      {s.profile && <Profile altitudeFt={altitudeFt} selectedFt={selectedFt} rangeNm={base.rangeNm} />}
    </>
  );
}

/** Traffic Map and Terrain Proximity: the ownship and range rings, with the honest status. */
export function RingsPage({ kind, rangeNm, headingUp }: { kind: 'traffic' | 'terrain'; rangeNm: number; headingUp: number }) {
  const cx = PAGE.w / 2;
  const cy = PAGE.h / 2;
  const outer = PAGE.h / 2 - 30;
  const rings = kind === 'traffic' ? [2, 6] : [rangeNm / 4, rangeNm / 2];
  const maxNm = kind === 'traffic' ? 6 : rangeNm / 2;
  return (
    <div class="g1000-pagemap" style={{ left: `${PAGE.x}px`, top: `${PAGE.y}px`, width: `${PAGE.w}px`, height: `${PAGE.h}px` }}>
      <svg class="g1000-layer" width={PAGE.w} height={PAGE.h} aria-hidden="true">
        {rings.map((nm) => (
          <g key={nm}>
            <circle cx={cx} cy={cy} r={(nm / maxNm) * outer} fill="none" stroke="#9aa0a6" stroke-dasharray="3 6" stroke-width={1.5} />
            <text x={cx + (nm / maxNm) * outer * 0.72} y={cy - (nm / maxNm) * outer * 0.72} font-size={14} fill={AV.white}>
              {formatDistance(nm)}
            </text>
          </g>
        ))}
        <g transform={`rotate(${-headingUp} ${cx} ${cy})`}>
          <text x={cx} y={cy - outer - 6} text-anchor="middle" font-size={16} fill={AV.white}>
            N
          </text>
        </g>
        <path d={`M${cx} ${cy - 14} l10 26 l-10 -6 l-10 6 Z`} fill={AV.white} stroke="#000" />
      </svg>
      <div class="g1000-maptag g1000-maptag-tl">{kind === 'traffic' ? 'TIS' : 'TERRAIN'}</div>
      <div class="g1000-maptag g1000-maptag-tr">HDG UP</div>
      <div class="g1000-pagenote">
        {kind === 'traffic' ? 'NO DATA: the trainer has no traffic (TIS) information' : 'TERRAIN UNAVAILABLE: no terrain database in the trainer'}
      </div>
    </div>
  );
}
