import { formatCom, formatNav } from '../../../core/frequency';
import type { Airport } from '../../../core/navdb';
import type { PlanLegInfo } from '../../../sim/fms';
import type { ActiveLeg, SimMessage } from '../../../sim/types';
import { formatBearing, formatDistance } from '../../../ui/format';
import { Field, Win, type Rect } from '../screen/Frames';
import { FplList } from '../screen/FplList';
import { WaypointSymbol } from '../screen/WaypointBits';
import type { FplCursor } from '../shared/flightPlan';
import { FREQ_NAMES, primaryCom, type Nearby } from '../shared/nearest';
import { fieldOf, formatTimer, timerShown, type References, type TimerRefWindow } from './timerRef';

/*
 * The windows that open in the lower right corner of the PFD: Nearest
 * Airports, Timer/References, Alerts, DME tuning and the Flight Plan
 * window (Direct-to and Procedures are shared with the MFD). One at a
 * time, as on the unit.
 */

export const PFD_WINDOW: Rect = { x: 704, y: 492, w: 316, h: 224 };
export const PFD_TALL_WINDOW: Rect = { x: 704, y: 444, w: 316, h: 272 };
/** The Procedures window is tall: options, loaded procedures and the hint. */
export const PFD_PROC_WINDOW: Rect = { x: 704, y: 300, w: 316, h: 416 };

// Nearest airports -----------------------------------------------------------------

export const NRST_VISIBLE = 3;

export interface NearestRow {
  readonly near: Nearby<Airport>;
  readonly bearingMag: number;
}

export function NearestWindow({ rows, cursor, scroll }: { rows: readonly NearestRow[]; cursor: number | null; scroll: number }) {
  const shown = rows.slice(scroll, scroll + NRST_VISIBLE);
  return (
    <Win rect={PFD_WINDOW} title="NEAREST AIRPORTS" class="g1000-nrst">
      {rows.length === 0 && <div class="g1000-empty">NONE WITHIN 200NM</div>}
      {shown.map((r, i) => {
        const k = scroll + i;
        const a = r.near.item;
        const com = primaryCom(a);
        const longest = a.runways[0];
        return (
          <div key={a.ident} class="g1000-nrst-apt">
            <div class="g1000-row g1000-nrst-line">
              <Field on={cursor === k * 2} class="g1000-nrst-id">
                {a.ident}
              </Field>
              <WaypointSymbol kind="airport" towered={a.towered} />
              <span class="g1000-nrst-brg">{formatBearing(r.bearingMag)}</span>
              <span class="g1000-nrst-dis">
                {formatDistance(r.near.distanceNm)}
                <small class="g1000-unit">NM</small>
              </span>
            </div>
            <div class="g1000-row g1000-nrst-line">
              <span class="g1000-nrst-ftype">{com ? FREQ_NAMES[com.type] : ''}</span>
              <Field on={cursor === k * 2 + 1} class="g1000-nrst-freq">
                {com ? formatCom(com.khz) : '___.___'}
              </Field>
              <span class="g1000-nrst-rwy">
                RNWY <b>{longest ? longest.lengthFt : '____'}</b>
                <small class="g1000-unit">FT</small>
              </span>
            </div>
          </div>
        );
      })}
      <Scrollbar total={rows.length} first={scroll} shown={NRST_VISIBLE} />
    </Win>
  );
}

function Scrollbar({ total, first, shown }: { total: number; first: number; shown: number }) {
  if (total <= shown) return null;
  const h = 100 / total;
  return (
    <div class="g1000-scroll">
      <div style={{ top: `${first * h}%`, height: `${shown * h}%` }} />
    </div>
  );
}

// Timer / references ------------------------------------------------------------------

export function TimerRefWindowView({ w, refs, simTime }: { w: TimerRefWindow; refs: References; simTime: number }) {
  const f = fieldOf(w);
  const t = refs.timer;
  const ctlLabel = { start: 'START?', stop: 'STOP?', reset: 'RESET?' }[w.ctl];
  return (
    <Win rect={PFD_WINDOW} title="REFERENCES" class="g1000-tmr">
      <div class="g1000-row g1000-tmr-timer">
        <span class="g1000-lbl">TIMER</span>
        <Field on={f === 'time'} class="g1000-cyan">
          {formatTimer(timerShown(t, simTime))}
        </Field>
        <Field on={f === 'dir'}>{t.up ? 'UP' : 'DN'}</Field>
        <Field on={f === 'ctl'}>{ctlLabel}</Field>
      </div>
      {refs.vspeeds.map((v) => {
        const changed = v.kt !== { glide: 68, vr: 55, vx: 62, vy: 74 }[v.id];
        return (
          <div key={v.id} class="g1000-row g1000-tmr-vs">
            <span class="g1000-lbl">{v.label}</span>
            <Field on={f === v.id} class="g1000-cyan">
              {v.kt}
              <small class="g1000-unit">KT</small>
              {changed ? '*' : ''}
            </Field>
            <Field on={f === `${v.id}On`}>
              <span class="g1000-tri">◂</span>
              {v.on ? 'ON' : 'OFF'}
              <span class="g1000-tri">▸</span>
            </Field>
          </div>
        );
      })}
      <div class="g1000-row g1000-tmr-min">
        <span class="g1000-lbl">MINIMUMS</span>
        <Field on={f === 'minMode'}>
          <span class="g1000-tri">◂</span>
          {refs.minimumsOn ? 'BARO' : 'OFF'}
          <span class="g1000-tri">▸</span>
        </Field>
        <Field on={f === 'minFt'} class="g1000-cyan">
          {refs.minimumsFt}
          <small class="g1000-unit">FT</small>
        </Field>
      </div>
    </Win>
  );
}

// Alerts ------------------------------------------------------------------------------------

export function AlertsWindow({ messages, scroll }: { messages: readonly SimMessage[]; scroll: number }) {
  const list = [...messages].reverse();
  const shown = list.slice(scroll, scroll + 6);
  return (
    <Win rect={PFD_WINDOW} title="ALERTS" class="g1000-alerts">
      {list.length === 0 && <div class="g1000-empty">No alerts</div>}
      {shown.map((m) => (
        <div key={m.id} class={`g1000-alert-msg is-${m.level}${m.read ? '' : ' is-new'}`}>
          {m.text.toUpperCase()}
        </div>
      ))}
      <Scrollbar total={list.length} first={scroll} shown={6} />
    </Win>
  );
}

// DME tuning -------------------------------------------------------------------------------

export const DME_SOURCES = ['NAV1', 'NAV2', 'HOLD'] as const;
export type DmeSource = (typeof DME_SOURCES)[number];

export function DmeTuneWindow({ choice, khz }: { choice: DmeSource; khz: number | null }) {
  return (
    <Win rect={{ x: 704, y: 600, w: 230, h: 84 }} title="DME TUNING" class="g1000-dmetune">
      <div class="g1000-row g1000-split">
        <Field on>
          <span class="g1000-tri">◂</span>
          {choice}
          <span class="g1000-tri">▸</span>
        </Field>
        <span class="g1000-green">{khz !== null ? formatNav(khz) : '___.__'}</span>
      </div>
    </Win>
  );
}

// Flight plan ----------------------------------------------------------------------------------

export const PFD_FPL_ROWS = 5;

export function FplWindow({
  legs,
  activeLeg,
  cursor,
  scroll,
  comment,
}: {
  legs: readonly PlanLegInfo[];
  activeLeg: ActiveLeg | null;
  cursor: FplCursor;
  scroll: number;
  comment: string;
}) {
  return (
    <Win rect={PFD_WINDOW} title="FLIGHT PLAN" class="g1000-fplwin">
      <div class="g1000-row g1000-fpl-comment">{comment}</div>
      <div class="g1000-row g1000-fpl-head">
        <span>DTK</span>
        <span>DIS</span>
      </div>
      <FplList legs={legs} activeLeg={activeLeg} cursor={cursor} scroll={scroll} rows={PFD_FPL_ROWS} rowH={27} />
    </Win>
  );
}
