import type { ComponentChildren } from 'preact';
import { bearing, distanceNm } from '../../../../core/geo';
import type { AltitudeConstraint } from '../../../../core/procedures';
import type { Airport, Navaid, Waypoint } from '../../../../core/navdb';
import { buildApproachLegs } from '../../../../sim/fms';
import type { RouteLeg } from '../../../../sim/types';
import { entryValue } from '../../../../ui/identEntry';
import type { MapProjection } from '../../../../ui/map/paintMap';
import { airportOf, cityLine, findWaypoint, fixOf, fixRegion, frequencyRows, navaidOf, runwayName, SURFACE_LABEL, vorClass } from '../../model/data';
import { LIST_ROWS } from '../../model/page';
import { formatMapRange, MAP_RANGES_NM } from '../../model/pages';
import {
  fieldOptions,
  flowButtons,
  PAGE_FIELDS,
  proceduresOf,
  selectedApproach,
  selectedArrival,
  selectedDeparture,
  terminalFixes,
  type ProcPageKind,
} from '../../model/proc';
import type { PageId, ProcField, WptKind } from '../../model/types';
import { WPT_KIND, wptStops, wptWaypoint } from '../../model/wpt';
import { at, brg, DataBox, dis, EntryText, fit, freqNav, latLines, NotInDb, T, Tag, Unit, V, type PageProps } from '../kit';
import { FS, MapView } from '../parts';
import { procColumnX } from '../Popups';
import { AirportSym, FixSym, NavaidSym } from '../symbols';

/*
 * WPT group: airport location, runway and frequency pages, the approach,
 * arrival and departure pages (procedure fields, their windows and a preview
 * map), the intersection page, VOR and NDB pages. The identifier field shows
 * the knob entry while spelling; the page previews whatever the spell-ahead
 * has found.
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

const ctxOf = (p: PageProps) => ({ state: p.state, nearest: p.nearest, db: p.db, procedures: p.procedures });

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

// Approach, arrival and departure pages ----------------------------------------------

const FIELD_LABEL: Record<ProcField, readonly [string, string]> = {
  approach: ['APR', 'APPROACH'],
  transition: ['TRANS', 'TRANS'],
  arrival: ['ARRIVAL', 'ARRIVAL'],
  arrivalTrans: ['TRANS', 'TRANS'],
  arrivalRunway: ['RUNWAY', 'RUNWAY'],
  departure: ['DEPART', 'DEPARTURE'],
  departureRunway: ['RUNWAY', 'RUNWAY'],
  departureTrans: ['TRANS', 'TRANS'],
};

const PAGE_OF_KIND: Record<ProcPageKind, PageId> = { approach: 'wpt.apr', arrival: 'wpt.arvl', departure: 'wpt.dep' };

/** Preview legs are built once per selection (the map repaints when the array changes). */
const previewCache = new Map<string, readonly RouteLeg[]>();
function cached(key: string, build: () => readonly RouteLeg[]): readonly RouteLeg[] {
  let legs = previewCache.get(key);
  if (!legs) {
    legs = build();
    if (previewCache.size > 24) previewCache.clear();
    previewCache.set(key, legs);
  }
  return legs;
}

/** A departure or arrival drawn as straight legs through its fixes. */
const throughFixes = (fixes: readonly Waypoint[]): RouteLeg[] =>
  fixes.map((wp, i) => ({ path: i === 0 ? 'IF' : 'TF', to: wp, segment: 'transition', label: wp.ident }));

/** The selected procedure's legs, and the active leg when it is the loaded approach. */
function previewOf(p: PageProps, kind: ProcPageKind, airport: Waypoint): { legs: readonly RouteLeg[]; activeIndex: number | null } | null {
  const procs = proceduresOf(p, airport);
  if (!procs) return null;
  const fms = p.state.fms;
  if (kind === 'approach') {
    const sel = selectedApproach(p.ui, fms, airport, procs);
    if (!sel) return null;
    const loaded = fms.approach;
    if (loaded && loaded.airport.ident === airport.ident && loaded.approach.id === sel.approach.id && loaded.transition === sel.transition) {
      return { legs: loaded.legs, activeIndex: p.derived.approach?.activeLegIndex ?? null };
    }
    const key = `apr|${airport.ident}|${sel.approach.id}|${sel.transition ?? '-'}`;
    return { legs: cached(key, () => buildApproachLegs(sel.approach, sel.transition, airport, { mag: p.mag, db: p.db })), activeIndex: null };
  }
  const sel = kind === 'arrival' ? selectedArrival(p.ui, airport, procs) : selectedDeparture(p.ui, airport, procs);
  if (!sel) return null;
  const key = `${kind}|${airport.ident}|${sel.proc.id}|${sel.runway ?? '-'}|${sel.transition ?? '-'}`;
  return { legs: cached(key, () => throughFixes(terminalFixes(sel.proc, sel.runway, sel.transition, p.db))), activeIndex: null };
}

/** The smallest map scale that holds every fix of the procedure. */
function previewRange(legs: readonly RouteLeg[], airport: Waypoint): number {
  let far = 0;
  for (const l of legs) if (l.to) far = Math.max(far, distanceNm(airport, l.to));
  const wanted = Math.max(far * 2.3, 3);
  return MAP_RANGES_NM.find((r) => r >= wanted) ?? MAP_RANGES_NM[MAP_RANGES_NM.length - 1]!;
}

/** Charted altitudes as the trainer labels them on the preview: "3000", "2600A" (at or above), "5000B" (at or below). */
function altitudeText(c: AltitudeConstraint): string {
  switch (c.kind) {
    case 'at':
    case 'glideslope':
      return String(c.ft);
    case 'atOrAbove':
      return `${c.ft}A`;
    case 'atOrBelow':
      return `${c.ft}B`;
    case 'between':
      return `${c.belowFt}B ${c.aboveFt}A`;
  }
}

/** Altitude labels under the fixes of the preview. */
function drawAltitudes(legs: readonly RouteLeg[], size: number) {
  return (ctx: CanvasRenderingContext2D, proj: MapProjection) => {
    ctx.save();
    ctx.font = `600 ${size}px 'Barlow Semi Condensed', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const done = new Set<string>();
    for (const l of legs) {
      if (!l.to || !l.altitude || done.has(l.to.ident)) continue;
      done.add(l.to.ident);
      const at = proj.toScreen(l.to);
      const text = altitudeText(l.altitude);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(text, at.x, at.y + size * 0.55);
      ctx.fillStyle = '#12dcff';
      ctx.fillText(text, at.x, at.y + size * 0.55);
    }
    ctx.restore();
  };
}

/**
 * The airport's approach, arrival or departure page: a preview of the
 * selected procedure on the left, its fields on the right, and "Load?"
 * ("Activate?" for approaches) when the page was opened with PROC.
 */
export function AirportProcedurePage(p: PageProps & { kind: ProcPageKind }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const page = PAGE_OF_KIND[p.kind];
  const a = airportShown(p);
  const wp = shown(p, 'airport');
  const procs = proceduresOf(p, wp);
  const top = fs.row + 6;
  const colX = procColumnX(main);
  const colW = main.w - colX - 2;
  const mapW = colX - 6;
  const mapH = main.h - top - 2;
  const fields = PAGE_FIELDS[p.kind];
  const sel = (stop: number) => p.ui.cursor === stop && !p.ui.popup && !p.ui.entry;
  const preview = wp ? previewOf(p, p.kind, wp) : null;
  const range = preview && wp ? previewRange(preview.legs, wp) : 10;
  const r = formatMapRange(range);
  const ac = p.state.aircraft;
  const step = fs.label + fs.row + 9;
  const flow = p.ui.proc.flow === p.kind && !!procs;
  const buttons = flow ? flowButtons(p.kind) : [];
  const buttonsY = top + fields.length * step + (big ? 6 : 1);
  return (
    <>
      <Header p={p} page={page} kind="airport" wp={a ?? null} symbol={a && <AirportSym a={a} size={fs.row * 0.85} />} />
      <DataBox x={2} y={top} w={mapW} h={mapH}>
        {wp && preview && (
          <MapView
            x={1}
            y={1}
            w={mapW - 2}
            h={mapH - 2}
            db={p.db}
            rangeNm={range}
            center={wp}
            ownship={{ lat: ac.lat, lon: ac.lon, headingTrue: ac.headingTrue }}
            approach={preview}
            declutter={1}
            symbolScale={p.ui.model === '430' ? 0.55 : 0.68}
            label={`Procedure preview for ${wp.ident}`}
            overlayKey={`${preview.legs.length}|${preview.legs[0]?.label ?? ''}`}
            overlay={drawAltitudes(preview.legs, big ? 11 : 10)}
          />
        )}
        {procs === undefined && wp && (
          <T x={4} y={3} size={fs.label + 1} color="white" bold>
            LOADING...
          </T>
        )}
        {preview && (
          <T x={3} y={mapH - fs.small - 5} size={fs.small + 1.5} color="white">
            {r.value}
            <Unit u={r.unit} />
          </T>
        )}
      </DataBox>
      {fields.map((field, i) => {
        const y = top + i * step;
        const opts = wp && procs ? fieldOptions(p.ui, p.state.fms, field, wp, procs) : null;
        const chosen = opts?.options.find((o) => o.value === opts.selected) ?? (opts && opts.options.length === 1 ? opts.options[0] : undefined);
        const empty = procs === null || (procs && opts && opts.options.length === 0);
        return (
          <div key={field}>
            <T x={colX + 1} y={y} size={fs.label} color="cyan" bold>
              {FIELD_LABEL[field][big ? 1 : 0]}
            </T>
            <DataBox x={colX} y={y + fs.label + 2} w={colW} h={fs.row + 5}>
              <T x={3} y={2.5} size={fs.row} sel={sel(1 + i)}>
                {chosen ? (
                  <>
                    {chosen.label}
                    {chosen.gps && <span class="gns-gps">GPS</span>}
                    <Tag t={chosen.tag} />
                  </>
                ) : empty ? (
                  'NONE'
                ) : (
                  '_____'
                )}
              </T>
            </DataBox>
          </div>
        );
      })}
      {buttons.map((b, i) => {
        const y = buttonsY + i * (fs.row + (big ? 10 : 1));
        return (
          <div key={b}>
            {big && i > 0 && (
              <T x={colX} y={y - fs.row * 0.55 - 2} w={colW} size={fs.label} color="cyan" align="center">
                or
              </T>
            )}
            <T x={colX} y={y} w={colW - 2} size={fs.row} color="white" align="right" sel={sel(1 + fields.length + i)}>
              {b === 'load' ? 'Load?' : 'Activate?'}
            </T>
          </div>
        );
      })}
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

/**
 * The intersection page: region, position, and the nearest VOR with the
 * radial and distance from it ("the nearest VOR, not necessarily the VOR
 * used to define the intersection").
 */
export function IntersectionPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const f = fixOf(p.db, shown(p, 'int'));
  const w = main.w - 4;
  const top = fs.row + 6;
  const leftW = w * 0.6;
  const rightX = 2 + leftW + 4;
  const rightW = main.w - rightX - 2;
  const fieldH = fs.row + 5;
  const posY = top + fs.label + 2 + fieldH + 4;
  const posH = fs.row * 2 + 6;
  const [lat, lon] = f ? latLines(f.lat, f.lon) : ["_ __°__.__'", "____°__.__'"];
  const vor = f ? p.db.nearestNavaids(f, 1, 'vor', 200)[0]?.item : undefined;
  const radial = f && vor ? bearing(vor, f) - vor.magVar : null;
  const dist = f && vor ? distanceNm(vor, f) : null;
  const half = rightW / 2 - 1;
  return (
    <>
      <Header p={p} page="wpt.int" kind="int" wp={f ?? null} symbol={f && <FixSym size={fs.row * 0.85} />} />
      <T x={4} y={top} size={fs.label} color="cyan" bold>
        REGION
      </T>
      <DataBox x={2} y={top + fs.label + 2} w={leftW} h={fieldH}>
        <T x={4} y={2.5} size={fs.row}>
          {f ? fit(fixRegion(f), p.ui.model === '430' ? 14 : 18) : ''}
        </T>
      </DataBox>
      <T x={4} y={posY} size={fs.label} color="cyan" bold>
        POSITION
      </T>
      <DataBox x={2} y={posY + fs.label + 2} w={leftW} h={posH}>
        <T x={0} y={2} w={leftW - 5} size={fs.row} align="right">
          {lat}
        </T>
        <T x={0} y={fs.row + 3} w={leftW - 5} size={fs.row} align="right">
          {lon}
        </T>
      </DataBox>
      <T x={rightX + 1} y={top} size={fs.label} color="cyan" bold>
        NEAREST VOR
      </T>
      <DataBox x={rightX} y={top + fs.label + 2} w={rightW} h={fieldH}>
        <T x={4} y={2.5} size={fs.row}>
          {vor?.ident ?? '___'}
          {vor && (
            <span style={{ marginLeft: '4px' }}>
              <NavaidSym n={vor} size={fs.row * 0.8} />
            </span>
          )}
        </T>
      </DataBox>
      <T x={rightX + 1} y={posY} size={fs.label} color="cyan" bold>
        RAD
      </T>
      <T x={rightX + half + 3} y={posY} size={fs.label} color="cyan" bold>
        DIS
      </T>
      <DataBox x={rightX} y={posY + fs.label + 2} w={half} h={fieldH}>
        <T x={0} y={2.5} w={half - 3} size={fs.row} align="right">
          <V v={brg(radial)} u="mag" />
        </T>
      </DataBox>
      <DataBox x={rightX + half + 2} y={posY + fs.label + 2} w={half} h={fieldH}>
        <T x={0} y={2.5} w={half - 3} size={fs.row} align="right">
          <V v={dis(dist)} u="nm" />
        </T>
      </DataBox>
    </>
  );
}

/** User waypoints: the trainer has none. */
export function MissingWaypointPage(p: PageProps & { page: PageId }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const kind = WPT_KIND[p.page]!;
  const top = fs.row + 6;
  return (
    <>
      <Header p={p} page={p.page} kind={kind} wp={null} />
      <NotInDb x={2} y={top} w={main.w - 4} h={main.h - top - 2} size={fs.label + 1} lines={['User waypoints are not in the', 'trainer database']} />
    </>
  );
}
