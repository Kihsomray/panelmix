import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import type { AirspaceSource } from '../../../core/airspace';
import type { LatLon } from '../../../core/geo';
import type { NavDatabase, Waypoint } from '../../../core/navdb';
import type { GpsSolution } from '../../../sim/fms';
import type { ActiveLeg, RouteLeg } from '../../../sim/types';
import { getBasemap } from '../../../ui/map/basemap';
import { MAP_STYLES, paintMap, type MapProjection, type MapStyle } from '../../../ui/map/paintMap';
import { ScreenCanvas } from '../../../ui/Screen';
import type { LegEnd, LegView } from '../model/legView';
import type { Model } from '../model/types';
import { at, T, Tag } from './kit';
import { ArcGlyph, DtoGlyph, HoldGlyph, LegArrow, ProcTurnGlyph } from './symbols';

/*
 * Pieces several pages share: font sizes, the on-screen GPS CDI, the
 * active-leg line ("KJYO -> MRB", "D-> KHGR", "VTF -> DANMO FA") and the
 * moving map canvas.
 */

interface FontSizes {
  readonly title: number;
  readonly label: number;
  readonly row: number;
  readonly field: number;
  readonly big: number;
  readonly small: number;
}

export const FS: Record<Model, FontSizes> = {
  '430': { title: 9.5, label: 8.6, row: 12, field: 13.5, big: 16.5, small: 7 },
  '530': { title: 11, label: 10.5, row: 15, field: 16, big: 21, small: 8.5 },
};

/** CDI full-scale label: "1.0", "0.3", and finer as LPV angular scaling tightens toward the runway. */
const scaleText = (nm: number) => (nm >= 0.095 ? nm.toFixed(1) : nm.toFixed(2).replace(/^0/, ''));

/**
 * The graphic GPS CDI: dots each side, the TO/FROM triangle in the middle
 * and the needle. Without a GPS position "the To/From flag is removed from
 * the CDI" and so is the needle.
 */
export function CdiBar({ x, y, w, h, gps, dots, labels }: { x: number; y: number; w: number; h: number; gps: GpsSolution; dots: number; labels: boolean }) {
  const cx = w / 2;
  const span = w / 2 - (labels ? 9 : 8);
  const spacing = span / dots;
  const dotY = h * (labels ? 0.42 : 0.5);
  const tri = Math.min(h * 0.42, 11);
  const needleX = cx + gps.needle * span;
  const label = scaleText(gps.fullScaleNm);
  const shown = gps.active && gps.valid !== false;
  return (
    <div class="gns-box" style={at(x, y, w, h)}>
      <svg class="gns-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={at(0, 0)} aria-hidden="true">
        {Array.from({ length: dots * 2 }, (_, i) => {
          const k = i < dots ? -(i + 1) : i - dots + 1;
          return <rect key={i} x={cx + k * spacing - 1.5} y={dotY - 1.5} width="3" height="3" fill="var(--gns-cyan)" />;
        })}
        {shown && gps.toFrom && (
          <>
            <path
              d={
                gps.toFrom === 'TO'
                  ? `M${cx} ${2} L${cx + tri * 0.85} ${2 + tri} L${cx - tri * 0.85} ${2 + tri}Z`
                  : `M${cx} ${h - 2} L${cx + tri * 0.85} ${h - 2 - tri} L${cx - tri * 0.85} ${h - 2 - tri}Z`
              }
              fill="var(--gns-green)"
            />
            <rect x={needleX - 2} y={1.5} width="4" height={h - 3} fill="none" stroke="var(--gns-green)" stroke-width="1.4" />
          </>
        )}
      </svg>
      {labels && (
        <>
          <T x={2} y={h - 8.5} size={7.5} color="cyan">
            {label}
          </T>
          <T x={w - 16} y={h - 8.5} w={14} size={7.5} color="cyan" align="right">
            {label}
          </T>
        </>
      )}
    </div>
  );
}

const End = ({ e }: { e: LegEnd }) => (
  <>
    {e.ident}
    <Tag t={e.tag} />
  </>
);

/** The active leg line, centred in its box (see model/legView.ts for what each kind shows). */
export function LegLine({ x, y, w, h, view, size }: { x: number; y: number; w: number; h: number; view: LegView; size: number }) {
  const ty = (h - size) / 2;
  const glyph = (node: ComponentChildren, gw: number) => (
    <div style={{ position: 'absolute', left: `${w / 2 - gw / 2}px`, top: `${(h - gw * 0.5) / 2}px` }}>{node}</div>
  );
  const left = (children: ComponentChildren) => (
    <T x={0} y={ty} w={w / 2 - size * 1.2} size={size} color="green" align="right">
      {children}
    </T>
  );
  const right = (children: ComponentChildren) => (
    <T x={w / 2 + size * 1.1} y={ty} size={size} color="green">
      {children}
    </T>
  );
  switch (view.kind) {
    case 'none':
      return null;
    case 'direct':
    case 'obs':
      return (
        <div class="gns-t" style={at(x, y, w, h)}>
          <div style={{ position: 'absolute', left: `${w / 2 - size * 2.4}px`, top: `${(h - size * 0.62) / 2}px` }}>
            {view.kind === 'obs' ? <LegArrow w={size * 1.6} /> : <DtoGlyph w={size * 1.7} color="var(--gns-magenta)" />}
          </div>
          <T x={w / 2 - size * 0.3} y={ty} size={size} color="green">
            <End e={view.to} />
          </T>
        </div>
      );
    case 'hold':
      return (
        <div class="gns-t" style={at(x, y, w, h)}>
          {left(view.timer)}
          {glyph(<HoldGlyph w={size * 1.9} />, size * 1.9)}
          {right(<End e={view.to} />)}
        </div>
      );
    case 'pt': {
      // Outbound: "FIX -> [PT]"; turning back: "[PT] -> NEXT".
      const pt = (px: number) => (
        <div style={{ position: 'absolute', left: `${px}px`, top: `${(h - size * 0.95) / 2}px` }}>
          <ProcTurnGlyph w={size * 2.1} />
        </div>
      );
      return (
        <div class="gns-t" style={at(x, y, w, h)}>
          {view.from ? left(<End e={view.from} />) : pt(w / 2 - size * 3.4)}
          {glyph(<LegArrow w={size * 1.6} />, size * 1.6)}
          {view.from ? pt(w / 2 + size * 1.1) : view.to && right(<End e={view.to} />)}
        </div>
      );
    }
    case 'leg':
      return (
        <div class="gns-t" style={at(x, y, w, h)}>
          {left(<End e={view.from} />)}
          {glyph(view.arc ? <ArcGlyph w={size * 1.6} /> : <LegArrow w={size * 1.6} />, size * 1.6)}
          {right(<End e={view.to} />)}
        </div>
      );
  }
}

export interface MapViewProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly db: NavDatabase;
  /** Top-to-bottom distance shown, nm (Garmin's map scale). */
  readonly rangeNm: number;
  readonly ownship: { readonly lat: number; readonly lon: number; readonly headingTrue: number } | null;
  readonly center?: LatLon;
  readonly upTrue?: number;
  readonly ownshipAt?: number;
  readonly route?: { readonly plan: readonly Waypoint[]; readonly activeLeg: ActiveLeg | null };
  /** The loaded approach (or a procedure preview) and its active leg. */
  readonly approach?: { readonly legs: readonly RouteLeg[]; readonly activeIndex: number | null } | null;
  /** Class B, C and D boundaries. */
  readonly airspace?: AirspaceSource | null;
  /** Intersections at short ranges. */
  readonly fixes?: boolean;
  /** Dead reckoning: the airplane symbol turns yellow. */
  readonly dr?: boolean;
  readonly declutter?: number;
  /** Symbols are drawn this much smaller than the shared map's defaults to suit the small LCD. */
  readonly symbolScale: number;
  readonly label: string;
  readonly overlay?: (ctx: CanvasRenderingContext2D, proj: MapProjection, w: number, h: number) => void;
  /** Whatever the overlay draws from, quantized: the map repaints when it changes. */
  readonly overlayKey?: string;
  /** The waypoint under the panning pointer, boxed in cyan. */
  readonly highlight?: Waypoint | null;
}

/**
 * The GNS map: shared GNS colours, smaller labels, every airport in magenta
 * as on the real unit (the shared style draws towered ones blue), Class D
 * airspace as the green dashed ring of the guide's map captures.
 */
const GNS_MAP_STYLE: MapStyle = {
  ...MAP_STYLES.gns,
  fontSize: 11,
  airportTowered: MAP_STYLES.gns.airportUntowered,
  airspace: { classB: '#3d8bff', classC: '#e050e0', classD: '#2fae4a' },
  fix: '#2ad8ff',
};
const GNS_DR_STYLE: MapStyle = { ...GNS_MAP_STYLE, ownship: '#ffe23a' };

/**
 * What the picture depends on, rounded to what can show: the ownship moving
 * a third of a pixel, half a degree of turn. The component re-renders every
 * frame; the canvas repaints only when this changes.
 */
function mapSignature(p: MapViewProps): string {
  const own = p.ownship;
  const qLat = (0.33 * p.rangeNm) / p.h / 60;
  const pos = own ? `${Math.round(own.lat / qLat)},${Math.round((own.lon * Math.cos((own.lat * Math.PI) / 180)) / qLat)},${Math.round(own.headingTrue * 2)}` : '-';
  const center = p.center ? `${p.center.lat},${p.center.lon}` : '';
  const highlight = p.highlight ? `${p.highlight.ident}${p.highlight.lat}` : '';
  const layers = `${p.airspace ? 'a' : ''}${p.fixes ? 'f' : ''}${p.dr ? 'd' : ''}${p.approach?.activeIndex ?? ''}`;
  return [p.w, p.h, p.rangeNm, p.declutter ?? 0, Math.round((p.upTrue ?? 0) * 2), pos, center, p.overlayKey ?? '', highlight, layers, getBasemap() ? 1 : 0].join('|');
}

const sameMap = (a: MapViewProps, b: MapViewProps) =>
  a.route?.plan === b.route?.plan &&
  a.route?.activeLeg === b.route?.activeLeg &&
  a.approach?.legs === b.approach?.legs &&
  a.label === b.label &&
  mapSignature(a) === mapSignature(b);

/** The moving map (shared painter) in LCD pixels. */
export const MapView = memo(function MapView(p: MapViewProps) {
  return (
    <ScreenCanvas
      x={p.x}
      y={p.y}
      w={p.w}
      h={p.h}
      label={p.label}
      draw={(ctx, w, h) => {
        const f = p.symbolScale;
        ctx.save();
        ctx.scale(f, f);
        const at = p.ownshipAt ?? 0.5;
        const proj = paintMap(ctx, {
          width: w / f,
          height: h / f,
          db: p.db,
          ownship: p.ownship,
          ...(p.center && { center: p.center }),
          // paintMap's range is ownship-to-top; Garmin's scale is the whole height.
          rangeNm: p.rangeNm * at,
          upTrue: p.upTrue ?? 0,
          ownshipAt: at,
          ...(p.route && { route: p.route }),
          style: p.dr ? GNS_DR_STYLE : GNS_MAP_STYLE,
          declutter: p.declutter ?? 0,
          ...(p.highlight && { highlight: p.highlight }),
          ...(p.airspace && { airspace: p.airspace }),
          ...(p.fixes && { fixes: true }),
          ...(p.approach && { approach: p.approach }),
        });
        p.overlay?.(ctx, proj, w / f, h / f);
        ctx.restore();
      }}
    />
  );
}, sameMap);
