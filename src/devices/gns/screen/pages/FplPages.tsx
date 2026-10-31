import { planLegs } from '../../../../sim/fms';
import { entryValue, type IdentEntry } from '../../../../ui/identEntry';
import { facilityLines, findWaypoint } from '../../model/data';
import { LIST_ROWS } from '../../model/page';
import { at, brg, DataBox, dis, EntryText, fit, latLines, T, Title, V, type PageProps } from '../kit';
import { WindowFrame } from '../Popups';
import { WaypointSym } from '../symbols';
import { FS } from '../parts';

/*
 * FPL key pages: the active flight plan ("flight plan 00") with DTK and DIS
 * per leg and the magenta arrow from the leg's origin to its active
 * waypoint, and the flight plan catalog (the trainer keeps no stored plans).
 */

export function ActiveFplPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const fms = p.state.fms;
  const legs = planLegs(fms, p.state.aircraft, p.mag);
  const visible = LIST_ROWS[p.ui.model].fpl;
  const entry = p.ui.entry?.target.kind === 'fpl' ? p.ui.entry : null;
  const headerY = fs.title + 3;
  const colY = headerY + fs.row + 6;
  const listY = colY + fs.label + 2;
  const listH = main.h - listY - 2;
  const rowH = listH / visible;
  const w = main.w - 8;
  const cols = big ? { dtk: 0.52, dis: 0.76, cum: 0.99 } : { dtk: 0.62, dis: 0.96, cum: 0 };
  const first = fms.plan[0]?.ident;
  const last = fms.plan[fms.plan.length - 1]?.ident;
  // Rows: the waypoints, plus the blank row where new waypoints are added; while
  // entering, the new identifier appears in front of the highlighted row.
  type Row = { kind: 'wp'; index: number } | { kind: 'entry' } | { kind: 'blank' };
  const rows: Row[] = legs.map((l) => ({ kind: 'wp' as const, index: l.index }));
  if (entry && entry.target.kind === 'fpl') rows.splice(entry.target.index, 0, { kind: 'entry' });
  rows.push({ kind: 'blank' });
  const scroll = Math.min(p.ui.scroll, Math.max(rows.length - visible, 0));
  const shown = rows.slice(scroll, scroll + visible);
  const active = fms.activeLeg;
  const rowOf = (planIndex: number) => rows.findIndex((r) => r.kind === 'wp' && r.index === planIndex) - scroll;
  const toRow = active?.planIndex !== null && active?.planIndex !== undefined ? rowOf(active.planIndex) : -99;
  const fromRow = active && !active.isDirectTo && active.planIndex !== null ? rowOf(active.planIndex - 1) : -99;
  const yOf = (r: number) => 2 + r * rowH + (rowH - fs.row) / 2 - 1;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        ACTIVE FLIGHT PLAN
      </Title>
      <DataBox x={2} y={headerY} w={fs.row * 1.9} h={fs.row + 5}>
        <T x={0} y={2.5} w={fs.row * 1.9} size={fs.row} align="center">
          00
        </T>
      </DataBox>
      <DataBox x={fs.row * 1.9 + 5} y={headerY} w={main.w - fs.row * 1.9 - 8} h={fs.row + 5}>
        <T x={4} y={2.5} size={fs.row}>
          {first ? `${first} / ${last}` : ''}
        </T>
      </DataBox>
      <T x={6} y={colY} size={fs.label} color="cyan" bold>
        WAYPOINT
      </T>
      <T x={0} y={colY} w={w * cols.dtk} size={fs.label} color="cyan" align="right" bold>
        DTK
      </T>
      <T x={0} y={colY} w={w * cols.dis} size={fs.label} color="cyan" align="right" bold>
        DIS
      </T>
      {big && (
        <T x={0} y={colY} w={w * cols.cum} size={fs.label} color="cyan" align="right" bold>
          CUM
        </T>
      )}
      <DataBox x={2} y={listY} w={w} h={listH}>
        {/* The active leg: a magenta bracket from its origin down to the active waypoint. */}
        {toRow >= 0 && toRow < visible && (
          <svg class="gns-svg" style={at(0, 0)} width={12} height={listH} aria-hidden="true">
            <path
              d={
                fromRow >= 0
                  ? `M8 ${yOf(fromRow) + fs.row * 0.45}H3V${yOf(toRow) + fs.row * 0.55}H7`
                  : `M1 ${yOf(toRow) + fs.row * 0.55}H7`
              }
              fill="none"
              stroke="var(--gns-magenta)"
              stroke-width="2.4"
            />
            <path d={`M6 ${yOf(toRow) + fs.row * 0.55 - 3.2}L10.5 ${yOf(toRow) + fs.row * 0.55}L6 ${yOf(toRow) + fs.row * 0.55 + 3.2}Z`} fill="var(--gns-magenta)" />
          </svg>
        )}
        {shown.map((r, i) => {
          const y = yOf(i);
          const rowIndex = scroll + i;
          if (r.kind === 'entry' && entry) {
            return (
              <T key="entry" x={12} y={y} size={fs.row}>
                <EntryText e={entry.e} width={6} />
              </T>
            );
          }
          if (r.kind === 'blank') {
            const sel = !entry && p.ui.cursor === fms.plan.length && !p.ui.popup;
            return (
              <div key="blank">
                <T x={12} y={y} size={fs.row} sel={sel}>
                  ______
                </T>
                <T x={0} y={y} w={w * cols.dtk} size={fs.row} align="right">
                  <V v="___" u="mag" />
                </T>
                <T x={0} y={y} w={w * cols.dis} size={fs.row} align="right">
                  <V v="__._" u="nm" />
                </T>
              </div>
            );
          }
          const leg = legs[r.kind === 'wp' ? r.index : 0]!;
          const dist = leg.isActive ? leg.cumulativeNm : leg.legNm;
          const sel = !entry && p.ui.cursor === leg.index && !p.ui.popup;
          return (
            <div key={`${leg.waypoint.ident}${rowIndex}`}>
              <T x={12} y={y} size={fs.row} sel={sel}>
                {leg.waypoint.ident}
              </T>
              {leg.dtkMag !== null && (
                <T x={0} y={y} w={w * cols.dtk} size={fs.row} align="right">
                  <V v={brg(leg.dtkMag)} u="mag" />
                </T>
              )}
              {dist !== null && (
                <T x={0} y={y} w={w * cols.dis} size={fs.row} align="right">
                  <V v={dis(dist)} u="nm" />
                </T>
              )}
              {big && leg.cumulativeNm !== null && (
                <T x={0} y={y} w={w * cols.cum - 2} size={fs.row} align="right">
                  <V v={dis(leg.cumulativeNm)} u="nm" />
                </T>
              )}
            </div>
          );
        })}
      </DataBox>
      {rows.length > visible && (
        <div class="gns-scrollbar" style={at(main.w - 5, listY + 2, 3, listH - 4)}>
          <i style={{ top: `${(scroll / rows.length) * 100}%`, height: `${(visible / rows.length) * 100}%` }} />
        </div>
      )}
      {entry && <WaypointInfoWindow p={p} e={entry.e} />}
    </>
  );
}

/**
 * While a new flight plan waypoint is spelled, the unit shows what the
 * identifier finds before ENT accepts it.
 */
function WaypointInfoWindow({ p, e }: { p: PageProps; e: IdentEntry }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const size = big ? 13 : 9.5;
  const wp = findWaypoint(p.db, entryValue(e), null, p.state.aircraft);
  const { name, city } = facilityLines(wp);
  const [lat, lon] = wp ? latLines(wp.lat, wp.lon) : ["_ __°__.__'", "____°__.__'"];
  const w = main.w - 12;
  const boxW = w - 10;
  const lineH = size * 1.15;
  const labelH = fs.small + 3;
  const top = 8 + fs.title * 1.15;
  const idBoxY = top + labelH;
  const idBoxH = lineH * 3 + 4;
  const posY = idBoxY + idBoxH + 3;
  const posBoxY = posY + labelH;
  const posBoxH = lineH * 2 + 4;
  const h = posBoxY + posBoxH + 6;
  return (
    <>
      <div class="gns-dim" />
      <WindowFrame x={6} y={Math.max((main.h - h) / 2, 2)} w={w} h={h} title="WAYPOINT INFORMATION" size={fs.title * 0.9}>
        <T x={6} y={top} size={fs.small + 1} color="cyan" bold>
          IDENT, FACILITY &amp; CITY
        </T>
        <DataBox x={5} y={idBoxY} w={boxW} h={idBoxH}>
          <T x={4} y={2} size={size}>
            <EntryText e={e} />
          </T>
          {wp && (
            <span style={{ position: 'absolute', left: `${size * 4.6}px`, top: '3px' }}>
              <WaypointSym w={wp} size={size * 0.85} />
            </span>
          )}
          <T x={4} y={2 + lineH} size={size}>
            {fit(name, big ? 28 : 22)}
          </T>
          <T x={4} y={2 + lineH * 2} size={size}>
            {city}
          </T>
        </DataBox>
        <T x={6} y={posY} size={fs.small + 1} color="cyan" bold>
          POSITION
        </T>
        <DataBox x={5} y={posBoxY} w={boxW * 0.55} h={posBoxH}>
          <T x={0} y={2} w={boxW * 0.55 - 4} size={size} align="right">
            {lat}
          </T>
          <T x={0} y={2 + lineH} w={boxW * 0.55 - 4} size={size} align="right">
            {lon}
          </T>
        </DataBox>
        <T x={boxW * 0.6} y={posBoxY + 1} w={boxW * 0.4} size={fs.small + 1} color="cyan" align="center" bold>
          PRESS <span class="gns-ent-box">ENT</span>
        </T>
        <T x={boxW * 0.6} y={posBoxY + fs.small + 5} w={boxW * 0.4} size={fs.small + 1} color="cyan" align="center" bold>
          TO ACCEPT
        </T>
      </WindowFrame>
    </>
  );
}

export function FplCatalogPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const top = fs.title + 4;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        FLIGHT PLAN CATALOG
      </Title>
      <T x={4} y={top + 2} size={fs.label} color="cyan" bold>
        USED
      </T>
      <DataBox x={fs.label * 3.2} y={top} w={fs.row * 2.2} h={fs.row + 4}>
        <T x={0} y={2} w={fs.row * 2.2} size={fs.row} align="center">
          0
        </T>
      </DataBox>
      <T x={main.w / 2} y={top + 2} size={fs.label} color="cyan" bold>
        EMPTY
      </T>
      <DataBox x={main.w / 2 + fs.label * 3.4} y={top} w={fs.row * 2.2} h={fs.row + 4}>
        <T x={0} y={2} w={fs.row * 2.2} size={fs.row} align="center">
          19
        </T>
      </DataBox>
      <DataBox x={2} y={top + fs.row + 8} w={main.w - 4} h={main.h - top - fs.row - 10}>
        <T x={0} y={(main.h - top - fs.row - 10) / 2 - fs.label} w={main.w - 4} size={fs.label} color="cyan" align="center">
          Stored flight plans are not kept
        </T>
        <T x={0} y={(main.h - top - fs.row - 10) / 2 + 2} w={main.w - 4} size={fs.label} color="cyan" align="center">
          by the trainer: use the active plan
        </T>
      </DataBox>
    </>
  );
}
