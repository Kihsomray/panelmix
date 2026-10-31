import { bearingDistance, trafficFrequency } from '../../model/data';
import { LIST_ROWS } from '../../model/page';
import type { PageId } from '../../model/types';
import { at, brg, DataBox, dis, freqCom, freqNav, NotInDb, T, Title, V, type PageProps } from '../kit';
import { FS } from '../parts';
import { AirportSym, NavaidSym } from '../symbols';

/*
 * NRST group: nearest airports (identifier, bearing, distance, approach,
 * traffic frequency and longest runway), VORs and NDBs with live bearing and
 * distance. The trainer has no intersections, user waypoints, ARTCC, FSS or
 * airspace, so those pages say so.
 */

function ScrollBar({ x, y, h, first, visible, total }: { x: number; y: number; h: number; first: number; visible: number; total: number }) {
  if (total <= visible) return null;
  return (
    <div class="gns-scrollbar" style={at(x, y, 3, h)}>
      <i style={{ top: `${(first / total) * 100}%`, height: `${(visible / total) * 100}%` }} />
    </div>
  );
}

export function NrstAirportPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const visible = LIST_ROWS[p.ui.model].nrstApt;
  const list = p.nearest.airports;
  const pos = p.state.aircraft;
  const listY = fs.title + fs.label + 5;
  const listH = main.h - listY - 2;
  const rowH = listH / visible;
  const w = main.w - 8;
  const c = big ? { brg: 0.44, dis: 0.7, apr: 0.98 } : { brg: 0.5, dis: 0.74, apr: 0.98 };
  const shown = list.slice(p.ui.scroll, p.ui.scroll + visible);
  return (
    <>
      <Title w={main.w} size={fs.title}>
        NEAREST AIRPORT
      </Title>
      <T x={6} y={fs.title + 3} size={fs.label} color="cyan" bold>
        APT
      </T>
      <T x={0} y={fs.title + 3} w={w * c.brg} size={fs.label} color="cyan" align="right" bold>
        BRG
      </T>
      <T x={0} y={fs.title + 3} w={w * c.dis} size={fs.label} color="cyan" align="right" bold>
        DIS
      </T>
      <T x={0} y={fs.title + 3} w={w * c.apr} size={fs.label} color="cyan" align="right" bold>
        APR
      </T>
      <DataBox x={2} y={listY} w={w} h={listH}>
        {list.length === 0 && (
          <T x={0} y={listH / 2 - fs.label} w={w} size={fs.label} color="cyan" align="center">
            No airports within 200 nm
          </T>
        )}
        {shown.map((a, i) => {
          const index = p.ui.scroll + i;
          const { brg: b, dis: d } = bearingDistance(p.mag, pos, a);
          const f = trafficFrequency(a);
          const y = 2 + i * rowH;
          const line2 = y + rowH * 0.48;
          return (
            <div key={a.ident}>
              {i > 0 && big && <div class="gns-line" style={at(2, y - 2, w - 4, 1)} />}
              <T x={3} y={y} size={fs.row} sel={p.ui.cursor === index * 2}>
                {a.ident}
              </T>
              <span style={{ position: 'absolute', left: `${w * (big ? 0.24 : 0.27)}px`, top: `${y + 1}px` }}>
                <AirportSym a={a} size={fs.row * 0.85} />
              </span>
              <T x={0} y={y} w={w * c.brg} size={fs.row} align="right">
                <V v={brg(b)} u="mag" />
              </T>
              <T x={0} y={y} w={w * c.dis} size={fs.row} align="right">
                <V v={dis(d)} u="nm" />
              </T>
              {/* Approach types are not in the trainer database. */}
              <T x={0} y={y} w={w * c.apr - 2} size={fs.row} align="right">
                ___
              </T>
              <T x={0} y={line2} w={w * 0.2} size={fs.row} align="right">
                {f?.tag ?? '___'}
              </T>
              <T x={w * 0.22} y={line2} size={fs.row} sel={p.ui.cursor === index * 2 + 1}>
                {f ? freqCom(f.khz) : '___.___'}
              </T>
              <T x={0} y={line2} w={w * 0.7} size={fs.row} align="right">
                rwy
              </T>
              <T x={0} y={line2} w={w * c.apr - 2} size={fs.row} align="right">
                <V v={String(a.runways[0]?.lengthFt ?? 0)} u="ft" />
              </T>
            </div>
          );
        })}
      </DataBox>
      <ScrollBar x={main.w - 5} y={listY + 2} h={listH - 4} first={p.ui.scroll} visible={visible} total={list.length} />
    </>
  );
}

export function NrstNavaidPage(p: PageProps & { kind: 'vor' | 'ndb' }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const visible = LIST_ROWS[p.ui.model].nrstNav;
  const list = p.kind === 'vor' ? p.nearest.vors : p.nearest.ndbs;
  const pos = p.state.aircraft;
  const listY = fs.title + fs.label + 5;
  const listH = main.h - listY - 2;
  const rowH = listH / visible;
  const w = main.w - 8;
  const perRow = p.kind === 'vor' ? 2 : 1;
  const shown = list.slice(p.ui.scroll, p.ui.scroll + visible);
  return (
    <>
      <Title w={main.w} size={fs.title}>
        {p.kind === 'vor' ? 'NEAREST VOR' : 'NEAREST NDB'}
      </Title>
      <T x={6} y={fs.title + 3} size={fs.label} color="cyan" bold>
        {p.kind === 'vor' ? 'VOR' : 'NDB'}
      </T>
      {(
        [
          ['BRG', 0.47],
          ['DIS', 0.71],
          ['FREQ', 0.98],
        ] as const
      ).map(([label, frac]) => (
        <T key={label} x={0} y={fs.title + 3} w={w * frac} size={fs.label} color="cyan" align="right" bold>
          {label}
        </T>
      ))}
      <DataBox x={2} y={listY} w={w} h={listH}>
        {shown.map((n, i) => {
          const index = p.ui.scroll + i;
          const { brg: b, dis: d } = bearingDistance(p.mag, pos, n);
          const y = 2 + i * rowH + (rowH - fs.row) / 2 - 1;
          return (
            <div key={`${n.ident}${n.lat}`}>
              <T x={3} y={y} size={fs.row} sel={p.ui.cursor === index * perRow}>
                {n.ident}
              </T>
              <span style={{ position: 'absolute', left: `${w * 0.2}px`, top: `${y + 1}px` }}>
                <NavaidSym n={n} size={fs.row * 0.85} />
              </span>
              <T x={0} y={y} w={w * 0.47} size={fs.row} align="right">
                <V v={brg(b)} u="mag" />
              </T>
              <T x={0} y={y} w={w * 0.71} size={fs.row} align="right">
                <V v={dis(d)} u="nm" />
              </T>
              <T x={0} y={y} w={w * 0.98 - 2} size={fs.row} align="right" sel={p.kind === 'vor' && p.ui.cursor === index * 2 + 1}>
                {p.kind === 'vor' ? freqNav(n.freqKhz) : String(n.freqKhz)}
              </T>
            </div>
          );
        })}
      </DataBox>
      <ScrollBar x={main.w - 5} y={listY + 2} h={listH - 4} first={p.ui.scroll} visible={visible} total={list.length} />
    </>
  );
}

const MISSING: Partial<Record<PageId, { title: string; what: string }>> = {
  'nrst.int': { title: 'NEAREST INTERSECTION', what: 'Intersections are' },
  'nrst.usr': { title: 'NEAREST USER', what: 'User waypoints are' },
  'nrst.artcc': { title: 'NEAREST ARTCC', what: 'ARTCC frequencies are' },
  'nrst.fss': { title: 'NEAREST FSS', what: 'FSS frequencies are' },
  'nrst.asp': { title: 'NEAREST AIRSPACE', what: 'Airspace is' },
};

export function NrstMissingPage(p: PageProps & { page: PageId }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const info = MISSING[p.page]!;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        {info.title}
      </Title>
      <NotInDb x={2} y={fs.title + 5} w={main.w - 4} h={main.h - fs.title - 7} size={fs.label + 1} lines={[`${info.what} not in the`, 'trainer database']} />
    </>
  );
}
