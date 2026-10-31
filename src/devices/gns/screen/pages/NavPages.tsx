import { angleDiff } from '../../../../core/geo';
import type { MapProjection } from '../../../../ui/map/paintMap';
import { formatEte } from '../../../../ui/format';
import { bearingDistance } from '../../model/data';
import { formatMapRange, MAP_RANGES_NM, NAV_MAP_RANGES_NM } from '../../model/pages';
import { pointedWaypoint } from '../../model/navPages';
import { at, brg, DataBox, dis, fit, latLines, speed, T, Unit, V, type PageProps } from '../kit';
import { CdiBar, FS, LegLine, MapView } from '../parts';

/*
 * NAV group: the Default NAV page (CDI, active leg and six data fields on
 * the 430W; the 530W adds the look-ahead map with a compass arc) and the
 * Map page with its panning pointer.
 */

/** Labels and values of the default NAV data fields. */
function navFields(p: PageProps) {
  const g = p.derived.gps;
  return {
    DIS: <V v={dis(g.distanceNm, true)} u="nm" />,
    DTK: <V v={brg(g.dtkMag)} u="mag" />,
    BRG: <V v={brg(g.bearingMag)} u="mag" />,
    GS: <V v={speed(p.state.aircraft.groundSpeedKt)} u="kt" />,
    TRK: <V v={brg(p.derived.trackMag)} u="mag" />,
    ETE: <V v={formatEte(g.eteSec)} />,
  };
}

export function DefaultNav430(p: PageProps) {
  const fs = FS['430'];
  const f = navFields(p);
  const w = p.lcd.main.w - 4;
  const cols = (i: number) => 2 + (w / 3) * i;
  const top = ['DIS', 'DTK', 'BRG'] as const;
  const bottom = ['GS', 'TRK', 'ETE'] as const;
  return (
    <>
      <CdiBar x={2} y={3} w={w} h={27} gps={p.derived.gps} dots={5} labels />
      <DataBox x={2} y={34} w={w} h={19}>
        <LegLine x={0} y={0} w={w} h={19} gps={p.derived.gps} size={fs.row + 1} />
      </DataBox>
      {top.map((k, i) => (
        <T key={k} x={cols(i)} y={56} w={w / 3} size={fs.label} color="cyan" align="center" bold>
          {k}
        </T>
      ))}
      <DataBox x={2} y={65} w={w} h={42}>
        {top.map((k, i) => (
          <T key={k} x={(w / 3) * i} y={3} w={w / 3 - 4} size={fs.big} align="center">
            {f[k]}
          </T>
        ))}
        {bottom.map((k, i) => (
          <T key={k} x={(w / 3) * i} y={22} w={w / 3 - 4} size={fs.big} align="center">
            {f[k]}
          </T>
        ))}
      </DataBox>
      {bottom.map((k, i) => (
        <T key={k} x={cols(i)} y={110} w={w / 3} size={fs.label} color="cyan" align="center" bold>
          {k}
        </T>
      ))}
    </>
  );
}

/** The 530W arc: compass card segment around the track, ticks every 10°, labels every 30°. */
function drawArc(ctx: CanvasRenderingContext2D, ox: number, oy: number, r: number, upMag: number) {
  ctx.save();
  ctx.strokeStyle = '#12dcff';
  ctx.fillStyle = '#12dcff';
  ctx.lineWidth = 1.6;
  const half = 62;
  ctx.beginPath();
  ctx.arc(ox, oy, r, ((-90 - half) * Math.PI) / 180, ((-90 + half) * Math.PI) / 180);
  ctx.stroke();
  ctx.font = "700 15px 'Barlow Semi Condensed', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const first = Math.ceil((upMag - half) / 10) * 10;
  for (let d = first; d <= upMag + half; d += 10) {
    const rel = ((d - upMag) * Math.PI) / 180;
    const sx = Math.sin(rel);
    const cy = -Math.cos(rel);
    const len = d % 30 === 0 ? 10 : 6;
    ctx.beginPath();
    ctx.moveTo(ox + sx * r, oy + cy * r);
    ctx.lineTo(ox + sx * (r - len), oy + cy * (r - len));
    ctx.stroke();
    const deg = ((d % 360) + 360) % 360;
    if (deg % 30 === 0) {
      const text = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg / 10);
      ctx.fillText(text, ox + sx * (r - 20), oy + cy * (r - 20));
    }
  }
  // Track line: white dashes from the airplane to the arc.
  ctx.strokeStyle = '#ffffff';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ox, oy - 14);
  ctx.lineTo(ox, oy - r);
  ctx.stroke();
  ctx.restore();
}

export function DefaultNav530(p: PageProps) {
  const fs = FS['530'];
  const { main } = p.lcd;
  const a = p.state.aircraft;
  const g = p.derived.gps;
  const range = NAV_MAP_RANGES_NM[p.ui.navRange] ?? 10;
  const at0 = 0.74;
  const mapH = 168;
  const trackMag = p.derived.trackMag;
  const f = navFields(p);
  const r = formatMapRange(range);
  const bugOff = g.dtkMag === null ? null : angleDiff(g.dtkMag, trackMag);
  return (
    <>
      <MapView
        x={1}
        y={1}
        w={main.w - 2}
        h={mapH}
        db={p.db}
        rangeNm={range}
        ownship={{ lat: a.lat, lon: a.lon, headingTrue: a.headingTrue }}
        upTrue={a.trackTrue}
        ownshipAt={at0}
        route={{ plan: p.state.fms.plan, activeLeg: p.state.fms.activeLeg }}
        symbolScale={0.62}
        label="Look-ahead map, track up"
        overlayKey={`${Math.round(trackMag * 2)}|${bugOff === null ? '-' : Math.round(bugOff)}`}
        overlay={(ctx, proj: MapProjection, w) => {
          const own = proj.toScreen(a);
          drawArc(ctx, own.x, own.y, Math.min(w * 0.46, own.y - 52), trackMag);
          if (bugOff !== null && Math.abs(bugOff) < 60) {
            // Desired track bug on the arc.
            const rel = (bugOff * Math.PI) / 180;
            const rr = Math.min(w * 0.46, own.y - 52);
            ctx.fillStyle = '#ff40ff';
            ctx.beginPath();
            ctx.arc(own.x + Math.sin(rel) * rr, own.y - Math.cos(rel) * rr, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }}
      />
      <T x={4} y={3} size={fs.label} color="cyan" bold>
        DTK
      </T>
      <T x={4} y={13} size={fs.big} color="green">
        {f.DTK}
      </T>
      <T x={main.w / 2 - 36} y={3} size={fs.label} color="cyan" bold>
        TRK
      </T>
      <T x={main.w / 2 - 16} y={1} size={fs.big} color="green">
        {f.TRK}
      </T>
      <T x={main.w - 50} y={3} w={46} size={fs.label} color="cyan" align="right" bold>
        DIS
      </T>
      <T x={main.w - 80} y={13} w={76} size={fs.big} color="green" align="right">
        {f.DIS}
      </T>
      <T x={4} y={mapH * at0 - 6} size={fs.small + 2} color="white">
        {r.value}
        <Unit u={r.unit} />
      </T>
      <LegLine x={20} y={mapH - 6} w={main.w - 40} h={22} gps={g} size={fs.row + 3} />
      <T x={6} y={188} size={fs.label} color="cyan" bold>
        GS
      </T>
      <T x={4} y={199} size={fs.big - 1} color="green">
        {f.GS}
      </T>
      <CdiBar x={58} y={194} w={136} h={22} gps={g} dots={2} labels={false} />
      <T x={main.w - 40} y={188} w={36} size={fs.label} color="cyan" align="right" bold>
        ETE
      </T>
      <T x={main.w - 66} y={199} w={62} size={fs.big - 1} color="green" align="right">
        {f.ETE}
      </T>
    </>
  );
}

/** The map page's data fields along the right side. */
function mapFields(p: PageProps) {
  const g = p.derived.gps;
  const base = [
    ['WPT', <>{g.to?.ident ?? '_____'}</>],
    ['DTK', <V v={brg(g.dtkMag)} u="mag" />],
    ['TRK', <V v={brg(p.derived.trackMag)} u="mag" />],
    ['DIS', <V v={dis(g.distanceNm)} u="nm" />],
    ['GS', <V v={speed(p.state.aircraft.groundSpeedKt)} u="kt" />],
  ] as const;
  // The 430W shows four fields: WPT, DTK, DIS, GS.
  return p.ui.model === '430' ? base.filter(([k]) => k !== 'TRK') : base;
}

/** Garmin's panning pointer: a white arrow with a black edge, its tip on the point. */
function drawPointer(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.5, 13);
  ctx.lineTo(8, 20);
  ctx.lineTo(11, 18.5);
  ctx.lineTo(7.5, 11.5);
  ctx.lineTo(13, 11.5);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.6;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The window at the top of the map while panning: what is under the pointer, and its bearing and distance. */
function PointerInfo({ p, w }: { p: PageProps; w: number }) {
  const fs = FS[p.ui.model];
  const pointer = p.ui.map.pointer!;
  const wp = pointedWaypoint(p.ui, p.db);
  const { brg: b, dis: d } = bearingDistance(p.mag, p.state.aircraft, pointer);
  const [lat, lon] = latLines(pointer.lat, pointer.lon);
  const h = fs.row * 2 + 6;
  return (
    <DataBox x={2} y={2} w={w - 4} h={h}>
      {wp ? (
        <>
          <T x={4} y={2} size={fs.row}>
            {wp.ident}
          </T>
          <T x={4} y={fs.row + 4} size={fs.row - 1} color="white">
            {fit(wp.name.toUpperCase(), p.ui.model === '430' ? 14 : 20)}
          </T>
        </>
      ) : (
        <>
          <T x={4} y={2} size={fs.row}>
            {lat}
          </T>
          <T x={4} y={fs.row + 4} size={fs.row}>
            {lon}
          </T>
        </>
      )}
      <T x={0} y={2} w={w - 8} size={fs.row} align="right">
        <V v={brg(b)} u="mag" />
      </T>
      <T x={0} y={fs.row + 4} w={w - 8} size={fs.row} align="right">
        <V v={dis(d)} u="nm" />
      </T>
    </DataBox>
  );
}

export function MapPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = p.state.aircraft;
  const fieldsW = p.ui.model === '430' ? 54 : 56;
  const mapW = p.ui.map.fields ? main.w - fieldsW : main.w;
  const range = MAP_RANGES_NM[p.ui.map.range] ?? 10;
  const r = formatMapRange(range);
  const fields = mapFields(p);
  const fh = (main.h - 2) / fields.length;
  // Panning: the map centres on the pointer, which stays in the middle.
  const pointer = p.ui.cursor !== null ? p.ui.map.pointer : null;
  const pointed = pointer ? pointedWaypoint(p.ui, p.db) : undefined;
  return (
    <>
      <MapView
        x={0}
        y={0}
        w={mapW}
        h={main.h}
        db={p.db}
        rangeNm={range}
        ownship={{ lat: a.lat, lon: a.lon, headingTrue: a.headingTrue }}
        {...(pointer && { center: pointer })}
        route={{ plan: p.state.fms.plan, activeLeg: p.state.fms.activeLeg }}
        declutter={p.ui.map.declutter}
        symbolScale={p.ui.model === '430' ? 0.55 : 0.68}
        label={pointer ? 'Moving map, panning pointer' : 'Moving map, north up'}
        highlight={pointed ?? null}
        overlayKey={pointer ? 'pan' : ''}
        overlay={(ctx, _proj, w, h) => {
          if (pointer) drawPointer(ctx, w / 2, h / 2);
        }}
      />
      {pointer && <PointerInfo p={p} w={mapW} />}
      {!pointer && <NorthArrow x={4} y={3} size={p.ui.model === '430' ? 15 : 20} />}
      <T x={3} y={main.h - fs.small - 4} size={fs.small + 1.5} color="white">
        {r.value}
        <Unit u={r.unit} />
        {p.ui.map.declutter > 0 ? `-${p.ui.map.declutter}` : ''}
      </T>
      {p.ui.map.fields && (
        <div class="gns-panel" style={at(mapW, 0, fieldsW, main.h)}>
          {fields.map(([k, v], i) => (
            <div key={k}>
              <T x={4} y={i * fh + 2} size={fs.label} color="cyan" bold>
                {k}
              </T>
              <DataBox x={2} y={i * fh + fs.label + 3} w={fieldsW - 4} h={fh - fs.label - 4}>
                <T x={0} y={(fh - fs.label - 4 - fs.field) / 2} w={fieldsW - 7} size={fs.field} align="right">
                  {v}
                </T>
              </DataBox>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NorthArrow({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <svg class="gns-svg" style={at(x, y)} width={size * 0.8} height={size} viewBox="0 0 16 20" aria-hidden="true">
      <path d="M8 1L14.5 19L8 14.5L1.5 19Z" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M5.6 12V6.6L10.4 12V6.6" fill="none" stroke="#fff" stroke-width="1.3" />
    </svg>
  );
}
