import { bearingDistance } from '../../model/data';
import { navcomRows } from '../../model/navPages';
import { at, brg, clock, DataBox, dis, latLines, speed, T, V, type PageProps } from '../kit';
import { FS } from '../parts';
import { AirportSym } from '../symbols';

/*
 * The NAV group's information pages: NAVCOM (frequencies of the flight plan
 * airports, ENT loads one), Position (430W) and Satellite Status. The
 * TERRAIN page is in TerrainPage.tsx.
 */

export function NavcomPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const { airports, chosen, rows } = navcomRows(p.ui, { state: p.state, nearest: p.nearest, db: p.db });
  const apt = chosen ? p.db.airport(chosen.wp.ident) : undefined;
  const rowH = fs.row * 1.42;
  const visible = p.ui.model === '430' ? 5 : 8;
  const listY = fs.row + 6;
  return (
    <>
      <T x={3} y={3} size={fs.label + 0.6} color="white" bold>
        {chosen?.role ?? 'NAVCOM'}
      </T>
      <DataBox x={main.w * 0.4} y={0} w={main.w * 0.6 - 2} h={fs.row + 4}>
        <T x={4} y={2} size={fs.row} sel={p.ui.cursor === 0}>
          {chosen?.wp.ident ?? '_____'}
        </T>
        {apt && (
          <span style={{ position: 'absolute', left: `${fs.row * 3.6}px`, top: '2px' }}>
            <AirportSym a={apt} size={fs.row} />
          </span>
        )}
      </DataBox>
      <DataBox x={2} y={listY} w={main.w - 4} h={main.h - listY - 2}>
        {airports.length === 0 ? (
          <T x={0} y={(main.h - listY) / 2 - fs.label} w={main.w - 4} size={fs.label} color="cyan" align="center">
            No flight plan airports
          </T>
        ) : (
          rows.slice(p.ui.scroll, p.ui.scroll + visible).map((r, i) => {
            const stop = p.ui.scroll + i + 1;
            return (
              <div key={`${r.label}${r.khz}${i}`}>
                <T x={3} y={3 + i * rowH} size={fs.row}>
                  {r.label}
                </T>
                <T x={0} y={3 + i * rowH} w={main.w - 10} size={fs.row} align="right" sel={p.ui.cursor === stop}>
                  {r.receiveOnly && <small style={{ fontSize: '0.5em', verticalAlign: '0.6em' }}>Rx </small>}
                  {(r.khz / 1000).toFixed(r.khz >= 118000 ? 3 : 2)}
                </T>
              </div>
            );
          })
        )}
      </DataBox>
    </>
  );
}

/** Track-up compass ribbon of the position page. */
function Ribbon({ w, h, trackMag }: { w: number; h: number; trackMag: number }) {
  const pxPerDeg = w / 140;
  const marks = [];
  const first = Math.ceil((trackMag - 70) / 5) * 5;
  for (let d = first; d <= trackMag + 70; d += 5) {
    const x = w / 2 + (d - trackMag) * pxPerDeg;
    const deg = ((d % 360) + 360) % 360;
    const major = deg % 30 === 0;
    marks.push(<rect key={`t${d}`} x={x - 0.6} y={h - (deg % 10 === 0 ? 7 : 4)} width="1.2" height={deg % 10 === 0 ? 7 : 4} fill="#fff" />);
    if (major) {
      const card = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : null;
      marks.push(
        <text key={`l${d}`} x={x} y={card ? h - 9 : h - 10} text-anchor="middle" font-size={card ? 17 : 10} font-weight="700" fill="var(--gns-green)">
          {card ?? String(deg).padStart(3, '0')}
        </text>,
      );
    }
  }
  return (
    <svg class="gns-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={at(0, 0)} aria-hidden="true">
      {marks}
      <path d={`M${w / 2} ${h - 7}L${w / 2 + 5} ${h}L${w / 2 - 5} ${h}Z`} fill="#fff" />
    </svg>
  );
}

export function PositionPage(p: PageProps) {
  const fs = FS['430'];
  const w = p.lcd.main.w - 4;
  const a = p.state.aircraft;
  const near = p.nearest.airports[0];
  // Bearing FROM the reference airport to the airplane.
  const ref = near ? bearingDistance(p.mag, near, a) : null;
  const [lat, lon] = latLines(a.lat, a.lon);
  const col = w / 3;
  return (
    <>
      <DataBox x={2} y={1} w={w} h={28}>
        <Ribbon w={w} h={27} trackMag={p.derived.trackMag} />
      </DataBox>
      {(['TRK', 'GS', 'GSL'] as const).map((k, i) => (
        <T key={k} x={2 + col * i} y={32} w={col} size={fs.label} color="cyan" align="center" bold>
          {k}
        </T>
      ))}
      {[<V v={brg(p.derived.trackMag)} u="mag" />, <V v={speed(a.groundSpeedKt)} u="kt" />, <V v={String(Math.round(a.altitudeFt))} u="ft" />].map((v, i) => (
        <DataBox key={i} x={2 + col * i + 6} y={41} w={col - 12} h={18}>
          <T x={0} y={2} w={col - 16} size={fs.field} align="right">
            {v}
          </T>
        </DataBox>
      ))}
      <T x={2} y={62} w={w * 0.56} size={fs.label} color="cyan" align="center" bold>
        POSITION
      </T>
      <T x={2 + w * 0.56} y={62} w={w * 0.44} size={fs.label} color="cyan" align="center" bold>
        TIME
      </T>
      <DataBox x={2} y={71} w={w * 0.56} h={27}>
        <T x={0} y={2} w={w * 0.56 - 4} size={fs.row} align="right">
          {lat}
        </T>
        <T x={0} y={14} w={w * 0.56 - 4} size={fs.row} align="right">
          {lon}
        </T>
      </DataBox>
      <DataBox x={2 + w * 0.56} y={71} w={w * 0.44} h={27}>
        <T x={0} y={7} w={w * 0.44 - 4} size={fs.field} align="center">
          {clock(new Date())}
          <span class="gns-u">
            <b>L</b>
            <b>CL</b>
          </span>
        </T>
      </DataBox>
      <T x={3} y={105} size={fs.label} color="cyan" bold>
        APT
      </T>
      <DataBox x={22} y={102} w={44} h={16}>
        <T x={3} y={2} size={fs.row}>
          {near?.ident ?? '____'}
        </T>
      </DataBox>
      <T x={69} y={105} size={fs.label} color="cyan" bold>
        FROM
      </T>
      <DataBox x={95} y={102} w={40} h={16}>
        <T x={0} y={2} w={37} size={fs.row} align="right">
          <V v={brg(ref?.brg)} u="mag" />
        </T>
      </DataBox>
      <DataBox x={135} y={102} w={46} h={16}>
        <T x={0} y={2} w={43} size={fs.row} align="right">
          <V v={dis(ref?.dis)} u="nm" />
        </T>
      </DataBox>
    </>
  );
}

/** A fixed, healthy constellation: the trainer doesn't model satellites. */
const SATS = [
  { id: 2, az: 40, el: 60, snr: 0.7 },
  { id: 5, az: 120, el: 35, snr: 0.8 },
  { id: 7, az: 200, el: 70, snr: 0.9 },
  { id: 10, az: 260, el: 25, snr: 0.6 },
  { id: 13, az: 300, el: 50, snr: 0.85 },
  { id: 15, az: 80, el: 15, snr: 0.45 },
  { id: 21, az: 160, el: 10, snr: 0.4 },
  { id: 26, az: 230, el: 45, snr: 0.75 },
  { id: 29, az: 340, el: 20, snr: 0.65 },
  { id: 35, az: 190, el: 40, snr: 0.7 },
];

export function SatellitePage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const skyW = big ? 112 : 84;
  const skyH = big ? 100 : 72;
  const r = skyH / 2 - 3;
  const barY = skyH + 4;
  const barH = big ? 34 : 30;
  const sat = (s: (typeof SATS)[number]) => {
    const rr = r * (1 - s.el / 90);
    const ang = (s.az * Math.PI) / 180;
    return { x: skyW / 2 + Math.sin(ang) * rr, y: skyH / 2 - Math.cos(ang) * rr };
  };
  const a = p.state.aircraft;
  const [lat, lon] = latLines(a.lat, a.lon);
  const rightX = skyW + 6;
  const rightW = main.w - rightX - 2;
  return (
    <>
      <DataBox x={2} y={1} w={skyW} h={skyH}>
        <svg class="gns-svg" style={at(0, 0)} width={skyW} height={skyH} viewBox={`0 0 ${skyW} ${skyH}`} aria-hidden="true">
          <circle cx={skyW / 2} cy={skyH / 2} r={r} fill="none" stroke="var(--gns-green)" stroke-width="1" />
          <circle cx={skyW / 2} cy={skyH / 2} r={r / 2} fill="none" stroke="var(--gns-green)" stroke-width="1" />
          {SATS.map((s) => {
            const q = sat(s);
            return (
              <g key={s.id}>
                <rect x={q.x - 6} y={q.y - 4.5} width="12" height="9" rx="2" fill="var(--gns-green)" />
                <text x={q.x} y={q.y + 3} text-anchor="middle" font-size="8" font-weight="700" fill="#000">
                  {String(s.id).padStart(2, '0')}
                </text>
              </g>
            );
          })}
        </svg>
        <T x={3} y={3} size={fs.label} color="cyan" bold>
          N
        </T>
      </DataBox>
      <T x={rightX} y={3} size={fs.label} color="cyan" bold>
        STATUS
      </T>
      <DataBox x={rightX} y={fs.label + 5} w={rightW} h={fs.row + 5}>
        <T x={0} y={2.5} w={rightW} size={fs.row} align="center">
          3D DIFF NAV
        </T>
      </DataBox>
      {(['HFOM', 'VFOM', 'EPU'] as const).map((k, i) => (
        <T key={k} x={rightX} y={fs.label + fs.row + 14 + i * (fs.row + 1)} size={fs.label} color="cyan" bold>
          {k}
        </T>
      ))}
      <DataBox x={rightX + rightW * 0.45} y={fs.label + fs.row + 12} w={rightW * 0.55} h={(fs.row + 1) * 3 + 2}>
        {[
          <V v="16" u="ft" />,
          <V v="23" u="ft" />,
          <V v="0.03" u="nm" />,
        ].map((v, i) => (
          <T key={i} x={0} y={2 + i * (fs.row + 1)} w={rightW * 0.55 - 4} size={fs.row} align="right">
            {v}
          </T>
        ))}
      </DataBox>
      <DataBox x={2} y={barY} w={main.w - 4} h={barH + fs.small + 4}>
        <svg class="gns-svg" style={at(0, 0)} width={main.w - 4} height={barH + fs.small + 4} aria-hidden="true">
          {SATS.map((s, i) => {
            const bw = (main.w - 12) / SATS.length;
            const x = 4 + i * bw;
            const h = (barH - 4) * s.snr;
            return (
              <g key={s.id}>
                <rect x={x + 1} y={barH - h} width={bw - 3} height={h} fill="var(--gns-green)" />
                <text x={x + bw / 2} y={barH + fs.small + 1} text-anchor="middle" font-size={fs.small + 1} fill="#fff">
                  {String(s.id).padStart(2, '0')}
                </text>
              </g>
            );
          })}
        </svg>
      </DataBox>
      {big && (
        <>
          <T x={2} y={barY + barH + fs.small + 8} size={fs.label} color="cyan" bold>
            POSITION
          </T>
          <DataBox x={2} y={barY + barH + fs.small + 8 + fs.label + 2} w={main.w * 0.45} h={fs.row * 2 + 6}>
            <T x={0} y={2} w={main.w * 0.45 - 4} size={fs.row} align="right">
              {lat}
            </T>
            <T x={0} y={fs.row + 4} w={main.w * 0.45 - 4} size={fs.row} align="right">
              {lon}
            </T>
          </DataBox>
          <T x={main.w * 0.5} y={barY + barH + fs.small + 8} size={fs.label} color="cyan" bold>
            TIME
          </T>
          <DataBox x={main.w * 0.5} y={barY + barH + fs.small + 8 + fs.label + 2} w={main.w * 0.27} h={fs.row * 2 + 6}>
            <T x={0} y={fs.row * 0.6} w={main.w * 0.27} size={fs.row} align="center">
              {clock(new Date())}
            </T>
          </DataBox>
          <T x={main.w * 0.79} y={barY + barH + fs.small + 8} size={fs.label} color="cyan" bold>
            GSL
          </T>
          <DataBox x={main.w * 0.79} y={barY + barH + fs.small + 8 + fs.label + 2} w={main.w * 0.2} h={fs.row * 2 + 6}>
            <T x={0} y={fs.row * 0.6} w={main.w * 0.2 - 4} size={fs.row} align="right">
              <V v={String(Math.round(a.altitudeFt))} u="ft" />
            </T>
          </DataBox>
        </>
      )}
    </>
  );
}
