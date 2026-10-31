import { memo } from 'preact/compat';
import type { LatLon } from '../../../core/geo';
import type { NavDatabase, Waypoint } from '../../../core/navdb';
import type { GpsSolution } from '../../../sim/fms';
import type { ActiveLeg } from '../../../sim/types';
import { getBasemap } from '../../../ui/map/basemap';
import { MAP_STYLES, paintMap, type MapProjection } from '../../../ui/map/paintMap';
import { ScreenCanvas } from '../../../ui/Screen';
import type { Model } from '../model/types';
import { at, T } from './kit';
import { DtoGlyph, LegArrow } from './symbols';

/*
 * Pieces several pages share: font sizes, the on-screen GPS CDI, the
 * active-leg line ("KJYO -> MRB", "D-> KHGR") and the moving map canvas.
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

/** The graphic GPS CDI: dots each side, the TO/FROM triangle in the middle and the needle. */
export function CdiBar({ x, y, w, h, gps, dots, labels }: { x: number; y: number; w: number; h: number; gps: GpsSolution; dots: number; labels: boolean }) {
  const cx = w / 2;
  const span = w / 2 - (labels ? 9 : 8);
  const spacing = span / dots;
  const dotY = h * (labels ? 0.42 : 0.5);
  const tri = Math.min(h * 0.42, 11);
  const needleX = cx + gps.needle * span;
  const scaleLabel = gps.fullScaleNm.toFixed(1);
  return (
    <div class="gns-box" style={at(x, y, w, h)}>
      <svg class="gns-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={at(0, 0)} aria-hidden="true">
        {Array.from({ length: dots * 2 }, (_, i) => {
          const k = i < dots ? -(i + 1) : i - dots + 1;
          return <rect key={i} x={cx + k * spacing - 1.5} y={dotY - 1.5} width="3" height="3" fill="var(--gns-cyan)" />;
        })}
        {gps.active && gps.toFrom && (
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
            {scaleLabel}
          </T>
          <T x={w - 14} y={h - 8.5} size={7.5} color="cyan">
            {scaleLabel}
          </T>
        </>
      )}
    </div>
  );
}

/** The active leg: "FROM -> TO", the direct-to glyph and the waypoint, or OBS course to the waypoint. */
export function LegLine({ x, y, w, h, gps, size }: { x: number; y: number; w: number; h: number; gps: GpsSolution; size: number }) {
  const ty = (h - size) / 2;
  if (!gps.active || !gps.to) return null;
  if (gps.isDirectTo || gps.obsMode || !gps.from) {
    return (
      <div class="gns-t" style={at(x, y, w, h)}>
        <div style={{ position: 'absolute', left: `${w / 2 - size * 2.4}px`, top: `${(h - size * 0.62) / 2}px` }}>
          {gps.obsMode ? <LegArrow w={size * 1.6} /> : <DtoGlyph w={size * 1.7} color="var(--gns-magenta)" />}
        </div>
        <T x={w / 2 - size * 0.3} y={ty} size={size} color="green">
          {gps.to.ident}
        </T>
      </div>
    );
  }
  return (
    <div class="gns-t" style={at(x, y, w, h)}>
      <T x={0} y={ty} w={w / 2 - size * 1.2} size={size} color="green" align="right">
        {gps.from.ident}
      </T>
      <div style={{ position: 'absolute', left: `${w / 2 - size * 0.8}px`, top: `${(h - size * 0.8) / 2}px` }}>
        <LegArrow w={size * 1.6} />
      </div>
      <T x={w / 2 + size * 1.1} y={ty} size={size} color="green">
        {gps.to.ident}
      </T>
    </div>
  );
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
 * The GNS map: shared GNS colours, smaller labels, and every airport in
 * magenta as on the real unit (the shared style draws towered ones blue).
 */
const GNS_MAP_STYLE = { ...MAP_STYLES.gns, fontSize: 11, airportTowered: MAP_STYLES.gns.airportUntowered };

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
  return [p.w, p.h, p.rangeNm, p.declutter ?? 0, Math.round((p.upTrue ?? 0) * 2), pos, center, p.overlayKey ?? '', highlight, getBasemap() ? 1 : 0].join('|');
}

const sameMap = (a: MapViewProps, b: MapViewProps) =>
  a.route?.plan === b.route?.plan && a.route?.activeLeg === b.route?.activeLeg && a.label === b.label && mapSignature(a) === mapSignature(b);

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
          style: GNS_MAP_STYLE,
          declutter: p.declutter ?? 0,
          ...(p.highlight && { highlight: p.highlight }),
        });
        p.overlay?.(ctx, proj, w / f, h / f);
        ctx.restore();
      }}
    />
  );
}, sameMap);
