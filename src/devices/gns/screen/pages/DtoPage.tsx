import type { AnyWaypoint } from '../../../../core/navdb';
import { entryValue } from '../../../../ui/identEntry';
import { bearingDistance, facilityLines, findWaypoint } from '../../model/data';
import { DTO_STOP } from '../../model/dto';
import { brg, DataBox, EntryText, fit, latLines, T, V, type PageProps } from '../kit';
import { FS } from '../parts';
import { DtoGlyph, WaypointSym } from '../symbols';

/*
 * SELECT DIRECT-TO WAYPOINT: identifier (spell-ahead), facility and city,
 * the FPL and NRST pick lists, position, course from here, "Activate?".
 */

export function DtoPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const entry = p.ui.entry?.target.kind === 'dto' ? p.ui.entry.e : null;
  const pos = p.state.aircraft;
  // While spelling, the page shows what the spell-ahead has found.
  const wp: AnyWaypoint | undefined = entry
    ? findWaypoint(p.db, entryValue(entry), null, pos)
    : p.ui.dto.wp
      ? (p.db.find(p.ui.dto.wp.ident).find((w) => w.kind === p.ui.dto.wp!.kind) ?? p.ui.dto.wp)
      : undefined;
  const { name, city } = facilityLines(wp);
  const course = wp ? bearingDistance(p.mag, pos, wp).brg : null;
  const [lat, lon] = wp ? latLines(wp.lat, wp.lon) : ["_ __°__.__'", "____°__.__'"];
  const sel = (stop: number) => !entry && !p.ui.popup && p.ui.cursor === stop;
  const nrst = p.nearest.airports[0];
  const fplIdent = p.ui.dto.planIndex !== null ? p.ui.dto.wp?.ident : undefined;
  // The NRST field always offers the nearest airport; it shows dimmed until it is the chosen source.
  const fromNrst = !!p.ui.dto.wp && p.ui.dto.planIndex === null && p.nearest.airports.some((a) => a.ident === p.ui.dto.wp!.ident);
  const nrstIdent = fromNrst ? p.ui.dto.wp!.ident : nrst?.ident;
  const w = main.w - 4;
  const top = fs.title + 3 + (big ? fs.label + 2 : 0);
  const boxH = fs.row * 3 + 8;
  const rowY = top + boxH + 4;
  const fieldH = fs.row + 4;
  const bottomY = rowY + fieldH + (big ? fs.label + 8 : 4);
  const posH = fs.row * 2 + 6;
  return (
    <>
      <T x={0} y={1} w={main.w} size={fs.title} color="white" align="center" bold>
        SELECT <DtoGlyph w={fs.title * 2} /> WAYPOINT
      </T>
      {big && (
        <T x={4} y={fs.title + 3} size={fs.label} color="cyan" bold>
          IDENT, FACILITY &amp; CITY
        </T>
      )}
      <DataBox x={2} y={top} w={w} h={boxH}>
        <T x={4} y={3} size={fs.row} sel={sel(DTO_STOP.ident)}>
          {entry ? <EntryText e={entry} /> : (p.ui.dto.wp?.ident ?? '_____')}
        </T>
        {wp && (
          <span style={{ position: 'absolute', left: `${fs.row * 4.4}px`, top: `${3 + fs.row * 0.05}px` }}>
            <WaypointSym w={wp} size={fs.row * 0.85} />
          </span>
        )}
        <T x={4} y={fs.row + 5} size={fs.row}>
          {fit(name, big ? 30 : 24)}
        </T>
        <T x={4} y={fs.row * 2 + 7} size={fs.row}>
          {city}
        </T>
      </DataBox>
      <T x={3} y={rowY + 3} size={fs.label} color="cyan" bold>
        FPL
      </T>
      <DataBox x={fs.label * 2.3} y={rowY} w={w * 0.34} h={fieldH}>
        <T x={4} y={2} size={fs.row} sel={sel(DTO_STOP.fpl)}>
          {fplIdent ?? (sel(DTO_STOP.fpl) ? '_____' : '')}
        </T>
      </DataBox>
      <T x={w * 0.52} y={rowY + 3} size={fs.label} color="cyan" bold>
        NRST
      </T>
      <DataBox x={w * 0.52 + fs.label * 2.8} y={rowY} w={w * 0.48 - fs.label * 2.8 + 2} h={fieldH}>
        <T x={4} y={2} size={fs.row} sel={sel(DTO_STOP.nrst)}>
          <span class={fromNrst || sel(DTO_STOP.nrst) ? '' : 'gns-dim-value'}>{nrstIdent ?? ''}</span>
        </T>
      </DataBox>
      {big && (
        <>
          <T x={4} y={bottomY - fs.label - 3} size={fs.label} color="cyan" bold>
            POSITION
          </T>
          <T x={w * 0.62} y={bottomY - fs.label - 3} size={fs.label} color="cyan" bold>
            CRS
          </T>
        </>
      )}
      <DataBox x={2} y={bottomY} w={w * 0.52} h={posH}>
        <T x={0} y={2} w={w * 0.52 - 4} size={fs.row} align="right">
          {lat}
        </T>
        <T x={0} y={fs.row + 3} w={w * 0.52 - 4} size={fs.row} align="right">
          {lon}
        </T>
      </DataBox>
      {!big && (
        <T x={w * 0.56} y={bottomY + 3} size={fs.label} color="cyan" bold>
          CRS
        </T>
      )}
      <DataBox x={w * 0.62 + (big ? 0 : fs.label * 1.2)} y={bottomY} w={w * 0.38 - (big ? 0 : fs.label * 1.2) + 2} h={fieldH}>
        <T x={0} y={2} w={w * 0.38 - (big ? 0 : fs.label * 1.2) - 2} size={fs.row} align="right">
          <V v={brg(course)} u="mag" />
        </T>
      </DataBox>
      <T x={0} y={main.h - fs.row - 3} w={main.w - 4} size={fs.row} color="white" align="right" sel={sel(DTO_STOP.activate)}>
        Activate?
      </T>
    </>
  );
}
