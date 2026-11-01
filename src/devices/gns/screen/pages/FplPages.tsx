import { approachLegs, planLegs } from '../../../../sim/fms';
import { entryValue, type IdentEntry } from '../../../../ui/identEntry';
import { facilityLines, findWaypoint } from '../../model/data';
import { activeRow, approachHeader, fplRows, legName, ROLE_TAG, type FplRow } from '../../model/fpl';
import { LIST_ROWS } from '../../model/page';
import { at, brg, DataBox, dis, EntryText, fit, latLines, T, Tag, Title, V, type PageProps } from '../kit';
import { WindowFrame } from '../Popups';
import { WaypointSym } from '../symbols';
import { FS } from '../parts';

/*
 * FPL key pages: the active flight plan ("flight plan 00") with DTK and DIS
 * per leg (CUM too on the 530W), a loaded approach under its own title
 * ("Approach RNAV 17") with each leg, its designator (IA, FA, MA, MH), holds
 * with their leg time, and the magenta arrow from the active leg's origin to
 * its waypoint; and the flight plan catalog (the trainer keeps no stored
 * plans). With the cursor off the list follows the active leg.
 */

type Row = FplRow | { readonly kind: 'entry' };

const mmss = (min: number) => {
  const s = Math.round(min * 60);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function ActiveFplPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const fms = p.state.fms;
  const pos = p.state.aircraft;
  const legs = planLegs(fms, pos, p.mag);
  const appr = approachLegs(fms, pos, p.mag);
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
  const last = fms.approach?.airport.ident ?? fms.plan[fms.plan.length - 1]?.ident;
  // Rows: the waypoints, the blank row where new waypoints are added, the approach;
  // while entering, the new identifier appears in front of the highlighted row.
  const base = fplRows(fms);
  const rows: Row[] = [...base];
  if (entry && entry.target.kind === 'fpl') rows.splice(entry.target.index, 0, { kind: 'entry' });
  const shift = (r: number | null) => (r === null ? null : entry && entry.target.kind === 'fpl' && r >= entry.target.index ? r + 1 : r);
  const active = fms.activeLeg;
  const toAt = shift(activeRow(fms));
  // The leg's origin: the waypoint before it, unless flown direct from the present position.
  let fromAt: number | null = null;
  if (active && toAt !== null && !active.isDirectTo && active.from.ident !== 'P.POS') {
    const i = active.approachIndex;
    if (i !== null && i !== undefined) {
      let k = i - 1;
      while (k >= 0 && !fms.approach?.legs[k]?.to) k--;
      fromAt = k >= 0 ? shift(fms.plan.length + 2 + k) : fms.plan.length > 0 ? shift(fms.plan.length - 1) : null;
    } else if (active.planIndex !== null && active.planIndex > 0) fromAt = shift(active.planIndex - 1);
  }
  const maxScroll = Math.max(rows.length - visible, 0);
  // With the cursor off the page keeps the active leg in view, its origin (or the row above) on top.
  const followTop = toAt === null ? 0 : fromAt !== null && toAt - fromAt < visible ? fromAt : toAt - 1;
  const scroll = p.ui.cursor === null && !entry && toAt !== null ? Math.min(Math.max(followTop, 0), maxScroll) : Math.min(p.ui.scroll, maxScroll);
  const shown = rows.slice(scroll, scroll + visible);
  const toRow = toAt === null ? -99 : toAt - scroll;
  const fromRow = fromAt === null ? -99 : fromAt - scroll;
  const yOf = (r: number) => 2 + r * rowH + (rowH - fs.row) / 2 - 1;
  const cursorRow = (r: Row) => base.indexOf(r as FplRow);
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
          {first ? `${first} / ${last}` : last ? `____ / ${last}` : ''}
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
                fromAt !== null
                  ? `M8 ${fromRow >= 0 ? yOf(fromRow) + fs.row * 0.45 : 0}H3V${yOf(toRow) + fs.row * 0.55}H7`
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
          const sel = !entry && !p.ui.popup && p.ui.cursor !== null && p.ui.cursor === cursorRow(r);
          switch (r.kind) {
            case 'entry':
              return entry ? (
                <T key="entry" x={12} y={y} size={fs.row}>
                  <EntryText e={entry.e} width={6} />
                </T>
              ) : null;
            case 'blank':
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
            case 'header':
              return (
                <T key="header" x={8} y={y} size={fs.row} color="cyan" sel={sel}>
                  {approachHeader(fms)}
                </T>
              );
            case 'leg': {
              const info = appr[r.index];
              if (!info) return null;
              const l = info.leg;
              const hold = l.path === 'HM' || l.path === 'HA' || l.path === 'HF';
              const distance = info.isActive ? info.cumulativeNm : info.legNm;
              return (
                <div key={`leg${r.index}`}>
                  <T x={12} y={y} size={fs.row} sel={sel}>
                    {legName(l)}
                    <Tag t={l.role ? ROLE_TAG[l.role] : undefined} />
                  </T>
                  {info.dtkMag !== null && (
                    <T x={0} y={y} w={w * cols.dtk} size={fs.row} align="right">
                      <V v={brg(info.dtkMag)} u="mag" />
                    </T>
                  )}
                  {hold && l.legTimeMin !== undefined ? (
                    <T x={0} y={y} w={w * cols.dis} size={fs.row} align="right">
                      {mmss(l.legTimeMin)}
                    </T>
                  ) : (
                    distance !== null &&
                    l.to && (
                      <T x={0} y={y} w={w * cols.dis} size={fs.row} align="right">
                        <V v={dis(distance)} u="nm" />
                      </T>
                    )
                  )}
                  {big && info.cumulativeNm !== null && l.to && !hold && (
                    <T x={0} y={y} w={w * cols.cum - 2} size={fs.row} align="right">
                      <V v={dis(info.cumulativeNm)} u="nm" />
                    </T>
                  )}
                </div>
              );
            }
            case 'wp': {
              const leg = legs[r.index];
              if (!leg) return null;
              const dist = leg.isActive ? leg.cumulativeNm : leg.legNm;
              return (
                <div key={`wp${r.index}${leg.waypoint.ident}`}>
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
            }
          }
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
