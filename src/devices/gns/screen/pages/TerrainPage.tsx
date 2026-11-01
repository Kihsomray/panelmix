import { memo } from 'preact/compat';
import type { NavDatabase } from '../../../../core/navdb';
import type { TerrainProvider } from '../../../../core/terrain';
import { MAP_STYLES, paintMap, terrainRevision, type MapStyle } from '../../../../ui/map/paintMap';
import { paintTerrain, type MapFrame } from '../../../../ui/map/terrainLayer';
import { ScreenCanvas } from '../../../../ui/Screen';
import { TERRAIN_RANGES_NM } from '../../model/navPages';
import { T, type PageProps } from '../kit';
import { FS } from '../parts';

/*
 * The TERRAIN page (Section 2): terrain relative to the airplane, track up,
 * red where it is within 100 ft below the airplane or higher, yellow within
 * 1,000 ft below, black lower down; a 360 degree view around the airplane or
 * 120 degrees ahead; RNG from 1 to 100 nm; aviation data on or off (CLR);
 * the GPS altitude (GSL) top right. Without a GPS position it shows
 * "TERRAIN NOT AVAILABLE".
 */

/** The terrain page's map: nothing but airports and navaids over the terrain (no basemap lines). */
const AVIATION_STYLE: MapStyle = {
  ...MAP_STYLES.gns,
  fontSize: 11,
  airportTowered: MAP_STYLES.gns.airportUntowered,
  coast: 'rgba(0,0,0,0)',
  lakeFill: 'rgba(0,0,0,0)',
  states: 'rgba(0,0,0,0)',
  borders: 'rgba(0,0,0,0)',
};

interface TerrainViewProps {
  readonly w: number;
  readonly h: number;
  readonly lat: number;
  readonly lon: number;
  readonly trackTrue: number;
  readonly altitudeFt: number;
  readonly rangeNm: number;
  readonly view: 360 | 120;
  readonly aviation: boolean;
  readonly available: boolean;
  readonly provider: TerrainProvider;
  readonly db: NavDatabase;
  readonly symbolScale: number;
}

/** Where the airplane sits, as a share of the height: the middle (360), or near the bottom (120). */
const ownshipAt = (view: 360 | 120) => (view === 360 ? 0.55 : 0.9);

function drawAirplane(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(1.4, -2);
  ctx.lineTo(7, 1);
  ctx.lineTo(7, 2.6);
  ctx.lineTo(1.2, 1.4);
  ctx.lineTo(1, 5);
  ctx.lineTo(3, 6.6);
  ctx.lineTo(3, 7.6);
  ctx.lineTo(-3, 7.6);
  ctx.lineTo(-3, 6.6);
  ctx.lineTo(-1, 5);
  ctx.lineTo(-1.2, 1.4);
  ctx.lineTo(-7, 2.6);
  ctx.lineTo(-7, 1);
  ctx.lineTo(-1.4, -2);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** What the picture depends on, quantized (a terrain repaint costs several milliseconds). */
function signature(p: TerrainViewProps): string {
  const q = (0.33 * p.rangeNm) / p.h / 60;
  return [
    p.w,
    p.h,
    Math.round(p.lat / q),
    Math.round(p.lon / q),
    Math.round(p.trackTrue / 2),
    Math.round(p.altitudeFt / 50),
    p.rangeNm,
    p.view,
    p.aviation,
    p.available,
    terrainRevision(p.provider),
  ].join('|');
}

const TerrainView = memo(
  function TerrainView(p: TerrainViewProps) {
    return (
      <ScreenCanvas
        w={p.w}
        h={p.h}
        label={`Terrain, ${p.view} degree view, ${p.rangeNm} nm`}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
          if (!p.available) return;
          const at = ownshipAt(p.view);
          const oy = h * at;
          const ox = w / 2;
          // The full range reaches from the airplane to just inside the top edge.
          const scale = (oy - 4) / p.rangeNm;
          const own = { lat: p.lat, lon: p.lon };
          const layer = { provider: p.provider, mode: 'relative' as const, altitudeFt: p.altitudeFt };
          if (p.aviation) {
            const f = p.symbolScale;
            ctx.save();
            ctx.scale(f, f);
            paintMap(ctx, {
              width: w / f,
              height: h / f,
              db: p.db,
              ownship: null,
              center: own,
              rangeNm: oy / scale,
              upTrue: p.trackTrue,
              ownshipAt: at,
              style: AVIATION_STYLE,
              declutter: 1,
              terrain: layer,
            });
            ctx.restore();
          } else {
            const frame: MapFrame = { width: w, height: h, origin: own, ox, oy, scale, upTrue: p.trackTrue };
            paintTerrain(ctx, layer, frame, '#000');
          }

          ctx.strokeStyle = '#12dcff';
          ctx.fillStyle = '#12dcff';
          ctx.lineWidth = 1;
          const r = p.rangeNm * scale;
          if (p.view === 360) {
            // The half-range ring, dashed, with its four cardinal ticks.
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.arc(ox, oy, r / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            for (let k = 0; k < 4; k++) {
              const a = (k * Math.PI) / 2;
              ctx.fillRect(ox + Math.sin(a) * (r / 2) - 1.5, oy - Math.cos(a) * (r / 2) - 1.5, 3, 3);
            }
          } else {
            // The 120 degree sector ahead, and the half-range arc.
            const half = Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox - Math.sin(half) * r, oy - Math.cos(half) * r);
            ctx.arc(ox, oy, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.arc(ox, oy, r / 2, -Math.PI / 2 - half, -Math.PI / 2 + half);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          drawAirplane(ctx, ox, oy, h > 150 ? 1.25 : 0.95);
        }}
      />
    );
  },
  (a, b) => a.db === b.db && a.provider === b.provider && signature(a) === signature(b),
);

const rangeText = (nm: number) => (Number.isInteger(nm) ? String(nm) : nm.toFixed(1));

export function TerrainPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = p.state.aircraft;
  const t = p.ui.terrain;
  const range = TERRAIN_RANGES_NM[t.range] ?? 10;
  const available = p.derived.systems.gpsValid;
  // GPS-derived MSL altitude, "shown in increments of 20 feet".
  const gsl = Math.round(a.altitudeFt / 20) * 20;
  const at = ownshipAt(t.view);
  const ringY = main.h * at - ((main.h * at - 4) / 2) * (t.view === 360 ? 1 : 0.95);
  return (
    <>
      <TerrainView
        w={main.w}
        h={main.h}
        lat={a.lat}
        lon={a.lon}
        trackTrue={a.trackTrue}
        altitudeFt={a.altitudeFt}
        rangeNm={range}
        view={t.view}
        aviation={t.aviation}
        available={available}
        provider={p.terrain}
        db={p.db}
        symbolScale={p.ui.model === '430' ? 0.55 : 0.68}
      />
      <T x={3} y={2} size={fs.label} color="cyan" bold>
        TERRAIN
      </T>
      <T x={0} y={2} w={main.w * 0.62} size={fs.label} color="cyan" align="right" bold>
        {t.view === 360 ? 'TRACK' : 'TRK'}
      </T>
      <T x={0} y={2} w={main.w - 3} size={fs.label} color="cyan" align="right" bold>
        GSL
      </T>
      <T x={0} y={fs.label + 3} w={main.w - 3} size={fs.row} color="green" align="right">
        {available ? gsl : '_____'}
        <span class="gns-u">
          <b>f</b>
          <b>t</b>
        </span>
      </T>
      <T x={main.w / 2 + 4} y={ringY - fs.small - 3} size={fs.small + 1.5} color="cyan">
        {rangeText(range / 2)}
        <span class="gns-u">
          <b>n</b>
          <b>m</b>
        </span>
      </T>
      <T x={3} y={main.h - fs.small - 4} size={fs.small + 1.5} color="white">
        {rangeText(range)}
        <span class="gns-u">
          <b>n</b>
          <b>m</b>
        </span>
      </T>
      {!available && (
        <div class="gns-box" style={{ left: `${main.w * 0.2}px`, top: `${main.h * 0.38}px`, width: `${main.w * 0.6}px`, height: `${fs.row * 2.6}px`, boxShadow: 'none' }}>
          <T x={0} y={fs.row * 0.2} w={main.w * 0.6} size={fs.row} color="yellow" align="center" bold>
            TERRAIN
          </T>
          <T x={0} y={fs.row * 1.35} w={main.w * 0.6} size={fs.row} color="yellow" align="center" bold>
            NOT AVAILABLE
          </T>
        </div>
      )}
    </>
  );
}
