import type { ComponentChildren } from 'preact';
import type { Airport, Navaid, Waypoint } from '../../../../core/navdb';
import { entryValue } from '../../../../ui/identEntry';
import { airportOf, cityLine, findWaypoint, frequencyRows, navaidOf, runwayName, SURFACE_LABEL, vorClass } from '../../model/data';
import { LIST_ROWS } from '../../model/page';
import { formatMapRange, MAP_RANGES_NM } from '../../model/pages';
import type { PageId, WptKind } from '../../model/types';
import { WPT_KIND, wptStops, wptWaypoint } from '../../model/wpt';
import { at, DataBox, EntryText, fit, freqNav, latLines, NotInDb, T, Unit, V, type PageProps } from '../kit';
import { FS, MapView } from '../parts';
import { AirportSym, NavaidSym } from '../symbols';

/*
 * WPT group: airport location, runway and frequency pages, the approach,
 * arrival and departure pages (no procedures in the trainer), VOR and NDB
 * pages. The identifier field shows the knob entry while spelling; the page
 * previews whatever the spell-ahead has found.
 */

const LABEL: Record<WptKind, string> = { airport: 'APT', vor: 'VOR', ndb: 'NDB', int: 'INT', usr: 'USR' };

/** The waypoint the page shows: the one being spelled, or the selection. */
function shown(p: PageProps, kind: WptKind): Waypoint | null {
  const entry = p.ui.entry;
  if (entry && entry.target.kind === 'wpt') {
    const found = findWaypoint(p.db, entryValue(entry.e), kind, p.state.aircraft);
    return found ?? null;
  }
  return wptWaypoint(p.ui, p, kind);
}

const ctxOf = (p: PageProps) => ({ state: p.state, nearest: p.nearest, db: p.db });

/** Top row: "APT [KHGR] (symbol) ... Done?". */
function Header({ p, page, kind, wp, extra, symbol }: { p: PageProps; page: PageId; kind: WptKind; wp: Waypoint | null; extra?: string; symbol?: ComponentChildren }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const entry = p.ui.entry?.target.kind === 'wpt' ? p.ui.entry.e : null;
  const boxW = main.w * (p.ui.wptReturn ? 0.62 : 0.72);
  const doneStop = p.ui.wptReturn ? wptStops(page, p.ui, ctxOf(p)) - 1 : -1;
  return (
    <>
      <T x={3} y={3} size={fs.label + 1} color="white" bold>
        {LABEL[kind]}
      </T>
      <DataBox x={fs.label * 2.4} y={0} w={boxW} h={fs.row + 4}>
        <T x={4} y={2} size={fs.row} sel={!entry && p.ui.cursor === 0 && !p.ui.popup}>
          {entry ? <EntryText e={entry} /> : (wp?.ident ?? '_____')}
        </T>
        {symbol && <span style={{ position: 'absolute', left: `${fs.row * 3.9}px`, top: `${2 + fs.row * 0.08}px` }}>{symbol}</span>}
        {extra && (
          <T x={fs.row * 5} y={2} size={fs.row} color="green">
            {extra}
          </T>
        )}
      </DataBox>
      {p.ui.wptReturn && (
        <T x={0} y={2} w={main.w - 3} size={fs.row - 1} color="white" align="right" sel={p.ui.cursor === doneStop && !p.ui.popup}>
          Done?
        </T>
      )}
    </>
  );
}

function airportShown(p: PageProps): Airport | undefined {
  return airportOf(p.db, shown(p, 'airport'));
}

export function AirportLocationPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = airportShown(p);
  const w = main.w - 4;
  const top = fs.row + 6;
  const nameH = fs.row * 2 + 6;
  const posY = top + fs.label + 2 + nameH + fs.label + 4;
  const posH = fs.row * 2 + 6;
  const [lat, lon] = a ? latLines(a.lat, a.lon) : ['_ __°__.__\'', '____°__.__\''];
  const bottomY = posY + posH + 3;
  return (
    <>
      <Header p={p} page="wpt.apt" kind="airport" wp={a ?? null} symbol={a && <AirportSym a={a} size={fs.row * 0.85} />} />
      <T x={4} y={top} size={fs.label} color="cyan" bold>
        FACILITY &amp; CITY NAME
      </T>
      <DataBox x={2} y={top + fs.label + 2} w={w} h={nameH}>
        <T x={4} y={3} size={fs.row}>
          {a ? fit(a.name.toUpperCase(), p.ui.model === '430' ? 26 : 32) : ''}
        </T>
        <T x={4} y={fs.row + 4} size={fs.row}>
          {a ? cityLine(a) : ''}
        </T>
      </DataBox>
      <T x={2} y={posY - fs.label - 2} w={w * 0.53} size={fs.label} color="cyan" align="center" bold>
        POSITION
      </T>
      <T x={2 + w * 0.53} y={posY - fs.label - 2} w={w * 0.24} size={fs.label} color="cyan" align="center" bold>
        ELEV
      </T>
      <T x={2 + w * 0.77} y={posY - fs.label - 2} w={w * 0.23} size={fs.label} color="cyan" align="center" bold>
        FUEL
      </T>
      <DataBox x={2} y={posY} w={w * 0.53} h={posH}>
        <T x={0} y={2} w={w * 0.53 - 4} size={fs.row} align="right">
          {lat}
        </T>
        <T x={0} y={fs.row + 3} w={w * 0.53 - 4} size={fs.row} align="right">
          {lon}
        </T>
      </DataBox>
      <DataBox x={2 + w * 0.53} y={posY} w={w * 0.24} h={posH}>
        <T x={0} y={(posH - fs.row) / 2} w={w * 0.24 - 4} size={fs.row} align="right">
          <V v={a ? String(a.elevationFt) : '____'} u="ft" />
        </T>
      </DataBox>
      <DataBox x={2 + w * 0.77} y={posY} w={w * 0.23} h={posH}>
        <T x={0} y={(posH - fs.row) / 2} w={w * 0.23} size={fs.row} align="center">
          ____
        </T>
      </DataBox>
      {(
        [
          ['APR', 0, 0.26],
          ['RADAR', 0.34, 0.6],
          ['ARSPC', 0.68, 0.94],
        ] as const
      ).map(([label, lx, bx]) => (
        <div key={label}>
          <T x={2 + w * lx} y={bottomY + 3} size={fs.label} color="cyan" bold>
            {label}
          </T>
          <DataBox x={2 + w * (bx - 0.12)} y={bottomY} w={w * 0.18} h={fs.row + 4}>
            <T x={0} y={2} w={w * 0.18} size={fs.row} align="center">
              ___
            </T>
          </DataBox>
        </div>
      ))}
    </>
  );
}

export function AirportRunwayPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = airportShown(p);
  const rwy = a?.runways[Math.min(p.ui.wpt.runway, Math.max((a?.runways.length ?? 1) - 1, 0))];
  const top = fs.row + 6;
  const mapW = main.w * 0.58;
  const mapH = main.h - top - 2;
  const right = mapW + 6;
  const rw = main.w - right - 3;
  const range = MAP_RANGES_NM[p.ui.rwyRange] ?? 3.5;
  const r = formatMapRange(range);
  const ac = p.state.aircraft;
  return (
    <>
      <Header p={p} page="wpt.rwy" kind="airport" wp={a ?? null} symbol={a && <AirportSym a={a} size={fs.row * 0.85} />} />
      <DataBox x={2} y={top} w={mapW} h={mapH}>
        {a && (
          <MapView
            x={1}
            y={1}
            w={mapW - 2}
            h={mapH - 2}
            db={p.db}
            rangeNm={range}
            center={a}
            ownship={{ lat: ac.lat, lon: ac.lon, headingTrue: ac.headingTrue }}
            symbolScale={p.ui.model === '430' ? 0.55 : 0.68}
            label={`Runway diagram of ${a.ident}`}
          />
        )}
        <T x={3} y={mapH - fs.small - 5} size={fs.small + 1.5} color="white">
          {r.value}
          <Unit u={r.unit} />
        </T>
      </DataBox>
      <T x={right} y={top} size={fs.label} color="cyan" bold>
        RUNWAY
      </T>
      <DataBox x={right} y={top + fs.label + 2} w={rw} h={fs.row + 5}>
        <T x={0} y={2.5} w={rw} size={fs.row} align="center" sel={p.ui.cursor === 1 && !p.ui.popup}>
          {rwy ? runwayName(rwy) : '___-___'}
        </T>
      </DataBox>
      <T x={right} y={top + fs.label + fs.row + 11} size={fs.label} color="cyan" bold>
        INFO
      </T>
      <DataBox x={right} y={top + fs.label * 2 + fs.row + 13} w={rw} h={main.h - (top + fs.label * 2 + fs.row + 13) - 2}>
        {rwy && (
          <>
            <T x={3} y={3} size={fs.row}>
              <V v={String(rwy.lengthFt)} u="ft" />
            </T>
            <T x={0} y={fs.row + 4} w={rw - 4} size={fs.row} align="right">
              x<V v={String(rwy.widthFt)} u="ft" />
            </T>
            <T x={3} y={fs.row * 2 + 6} size={fs.row}>
              {SURFACE_LABEL[rwy.surface]}
            </T>
            <T x={3} y={fs.row * 3 + 8} size={fs.row}>
              {rwy.lighted ? 'LIGHTED' : 'NO LIGHTS'}
            </T>
          </>
        )}
      </DataBox>
    </>
  );
}

export function AirportFrequencyPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = airportShown(p);
  const rows = a ? frequencyRows(a) : [];
  const visible = LIST_ROWS[p.ui.model].freq;
  const top = fs.row + 6;
  const listH = main.h - top - 2;
  const rowH = listH / visible;
  const w = main.w - 8;
  return (
    <>
      <Header p={p} page="wpt.freq" kind="airport" wp={a ?? null} symbol={a && <AirportSym a={a} size={fs.row * 0.85} />} />
      <DataBox x={2} y={top} w={w} h={listH}>
        {rows.length === 0 && (
          <T x={0} y={listH / 2 - fs.label} w={w} size={fs.label} color="cyan" align="center">
            No frequencies
          </T>
        )}
        {rows.slice(p.ui.scroll, p.ui.scroll + visible).map((r, i) => {
          const stop = p.ui.scroll + i + 1;
          const y = 2 + i * rowH + (rowH - fs.row) / 2 - 1;
          return (
            <div key={`${r.label}${r.khz}${i}`}>
              <T x={3} y={y} size={fs.row}>
                {r.label}
              </T>
              <T x={0} y={y} w={w - 4} size={fs.row} align="right" sel={p.ui.cursor === stop && !p.ui.popup}>
                {r.receiveOnly && <small style={{ fontSize: '0.5em', verticalAlign: '0.7em' }}>Rx </small>}
                {(r.khz / 1000).toFixed(r.khz >= 118000 ? 3 : 2)}
              </T>
            </div>
          );
        })}
      </DataBox>
      {rows.length > visible && (
        <div class="gns-scrollbar" style={at(main.w - 5, top + 2, 3, listH - 4)}>
          <i style={{ top: `${(p.ui.scroll / rows.length) * 100}%`, height: `${(visible / rows.length) * 100}%` }} />
        </div>
      )}
    </>
  );
}

const PROC_PAGE: Partial<Record<PageId, { field: string; text: string }>> = {
  'wpt.apr': { field: 'APR', text: 'Approaches are not in the' },
  'wpt.arvl': { field: 'ARRIVAL', text: 'Arrivals are not in the' },
  'wpt.dep': { field: 'DEP', text: 'Departures are not in the' },
};

export function AirportProcedurePage(p: PageProps & { page: PageId }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const a = airportShown(p);
  const info = PROC_PAGE[p.page]!;
  const top = fs.row + 6;
  const leftW = main.w * 0.62;
  const right = leftW + 6;
  const rw = main.w - right - 3;
  return (
    <>
      <Header p={p} page={p.page} kind="airport" wp={a ?? null} symbol={a && <AirportSym a={a} size={fs.row * 0.85} />} />
      <NotInDb x={2} y={top} w={leftW} h={main.h - top - 2} size={fs.label} lines={[info.text, 'trainer database']} />
      <T x={right} y={top} size={fs.label} color="cyan" bold>
        {info.field}
      </T>
      <DataBox x={right} y={top + fs.label + 2} w={rw} h={fs.row + 5}>
        <T x={0} y={2.5} w={rw} size={fs.row} align="center">
          NONE
        </T>
      </DataBox>
      <T x={right} y={top + fs.label + fs.row + 11} size={fs.label} color="cyan" bold>
        TRANS
      </T>
      <DataBox x={right} y={top + fs.label * 2 + fs.row + 13} w={rw} h={fs.row + 5}>
        <T x={0} y={2.5} w={rw} size={fs.row} align="center">
          ____
        </T>
      </DataBox>
    </>
  );
}

/** VOR and NDB pages: facility, magnetic variation, position and frequency (ENT tunes a VOR). */
export function NavaidPage(p: PageProps & { kind: 'vor' | 'ndb' }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const page: PageId = p.kind === 'vor' ? 'wpt.vor' : 'wpt.ndb';
  const n: Navaid | undefined = navaidOf(p.db, shown(p, p.kind), p.kind);
  const w = main.w - 4;
  const top = fs.row + 6;
  const boxH = fs.row * 3 + 8;
  const posY = top + fs.label + 2 + boxH + fs.label + 4;
  const posH = fs.row * 2 + 6;
  const [lat, lon] = n ? latLines(n.lat, n.lon) : ['_ __°__.__\'', '____°__.__\''];
  const varText = n ? `${n.magVar >= 0 ? 'E' : 'W'}${String(Math.round(Math.abs(n.magVar))).padStart(3, '0')}°` : '____°';
  return (
    <>
      <Header p={p} page={page} kind={p.kind} wp={n ?? null} symbol={n && <NavaidSym n={n} size={fs.row * 0.85} />} {...(n && p.kind === 'vor' && { extra: vorClass(n) })} />
      <T x={4} y={top} size={fs.label} color="cyan" bold>
        FACILITY, CITY &amp; REGION
      </T>
      <DataBox x={2} y={top + fs.label + 2} w={w} h={boxH}>
        <T x={4} y={3} size={fs.row}>
          {n ? fit(n.name.toUpperCase(), p.ui.model === '430' ? 26 : 32) : ''}
        </T>
        <T x={4} y={fs.row + 5} size={fs.row}>
          {n ? n.type : ''}
        </T>
        <DataBox x={w * 0.56} y={boxH - fs.row - 6} w={w * 0.44} h={fs.row + 6}>
          <T x={4} y={3.5} size={fs.label} color="cyan" bold>
            VAR
          </T>
          <T x={0} y={2.5} w={w * 0.44 - 4} size={fs.row} align="right">
            {varText}
          </T>
        </DataBox>
      </DataBox>
      <T x={2} y={posY - fs.label - 2} w={w * 0.62} size={fs.label} color="cyan" align="center" bold>
        POSITION
      </T>
      <T x={2 + w * 0.66} y={posY - fs.label - 2} w={w * 0.34} size={fs.label} color="cyan" align="center" bold>
        FREQ
      </T>
      <DataBox x={2} y={posY} w={w * 0.62} h={posH}>
        <T x={0} y={2} w={w * 0.62 - 6} size={fs.row} align="right">
          {lat}
        </T>
        <T x={0} y={fs.row + 3} w={w * 0.62 - 6} size={fs.row} align="right">
          {lon}
        </T>
      </DataBox>
      <DataBox x={2 + w * 0.66} y={posY} w={w * 0.34} h={posH}>
        <T x={0} y={(posH - fs.row) / 2} w={w * 0.34} size={fs.row} align="center" sel={p.kind === 'vor' && p.ui.cursor === 1 && !p.ui.popup}>
          {n ? (p.kind === 'vor' ? freqNav(n.freqKhz) : n.freqKhz.toFixed(1)) : '___.__'}
        </T>
      </DataBox>
    </>
  );
}

export function MissingWaypointPage(p: PageProps & { page: PageId }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const kind = WPT_KIND[p.page]!;
  const top = fs.row + 6;
  return (
    <>
      <Header p={p} page={p.page} kind={kind} wp={null} />
      <NotInDb
        x={2}
        y={top}
        w={main.w - 4}
        h={main.h - top - 2}
        size={fs.label + 1}
        lines={[kind === 'int' ? 'Intersections are not in the' : 'User waypoints are not in the', 'trainer database']}
      />
    </>
  );
}
