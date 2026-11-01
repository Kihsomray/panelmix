import type { ComponentChildren } from 'preact';
import type { ProcedureSource } from '../../../core/procedures';
import type { SimState } from '../../../sim/types';
import type { Rect } from '../layout';
import { legName, ROLE_TAG } from '../model/fpl';
import { gnsApproachName } from '../model/proc';
import type { GnsUi, Popup, ProcField } from '../model/types';
import { at, T, Tag } from './kit';
import { LegArrow } from './symbols';

/*
 * Windows that open over a page: the PAGE MENU, "Yes? or No?" confirmations,
 * ACTIVATE LEG, the procedure windows (APR, TRANS, RUNWAY...), the TERRAIN
 * ALERT, the small pop-up lists and notices. White and cyan double edge on
 * blue, the page behind dimmed, inverse video on the choice.
 */

interface Props {
  readonly ui: GnsUi;
  readonly popup: Popup;
  readonly main: Rect;
  readonly state: SimState;
  readonly procedures: ProcedureSource | null;
}

/** "Yes? or No?" along the bottom of a window. */
function YesNo({ w, y, size, yes }: { w: number; y: number; size: number; yes: boolean }) {
  return (
    <>
      <T x={w / 2 - size * 3.4} y={y} size={size} color="white" sel={yes}>
        Yes?
      </T>
      <T x={w / 2 - size * 0.6} y={y} size={size} color="white">
        or
      </T>
      <T x={w / 2 + size * 1.2} y={y} size={size} color="white" sel={!yes}>
        No?
      </T>
    </>
  );
}

export function WindowFrame({ x, y, w, h, title, size, children }: { x: number; y: number; w: number; h: number; title: string; size: number; children: ComponentChildren }) {
  return (
    <div class="gns-window-box" style={at(x, y, w, h)}>
      <T x={0} y={4} w={w} size={size} color="cyan" align="center" bold>
        {title}
      </T>
      <div class="gns-line" style={at(5, 5 + size * 1.15, w - 10, 1)} />
      {children}
    </div>
  );
}

function MenuWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'menu' }> }) {
  const big = ui.model === '530';
  const size = big ? 12.5 : 10;
  const rowH = size * 1.32;
  const visible = big ? 10 : 5;
  const top = Math.min(Math.max(popup.index - Math.floor(visible / 2), 0), Math.max(popup.items.length - visible, 0));
  const rows = popup.items.slice(top, top + visible);
  const w = main.w * (big ? 0.7 : 0.8);
  const h = 11 + size * 1.3 + rows.length * rowH + 4;
  const x = (main.w - w) / 2;
  const y = Math.max((main.h - h) / 2 - 4, 2);
  const listTop = 9 + size * 1.3;
  return (
    <WindowFrame x={x} y={y} w={w} h={h} title="PAGE MENU" size={size * 0.9}>
      {rows.map((it, i) => {
        const selected = top + i === popup.index;
        return (
          <div key={it.label}>
            {/* The cursor is a white bar across the window. */}
            {selected && <div class="gns-menu-bar" style={at(5, listTop + i * rowH - 1, w - 16, size * 1.12)} />}
            <T x={6} y={listTop + i * rowH} size={size} color={selected ? 'blue' : it.enabled ? 'white' : 'dim'}>
              {it.label}
            </T>
          </div>
        );
      })}
      {popup.items.length > visible && (
        <div class="gns-scrollbar" style={at(w - 7, listTop, 3, visible * rowH - 2)}>
          <i style={{ top: `${(top / popup.items.length) * 100}%`, height: `${(visible / popup.items.length) * 100}%` }} />
        </div>
      )}
    </WindowFrame>
  );
}

function confirmText(popup: Extract<Popup, { kind: 'confirm' }>, state: SimState): { title: string; lines: string[] } {
  switch (popup.action) {
    case 'fpl.delete':
      return { title: 'DELETE FLIGHT PLAN', lines: ['Delete all waypoints in', 'flight plan.'] };
    case 'fpl.removeApproach': {
      const a = state.fms.approach;
      return { title: 'REMOVE APPROACH', lines: [`Remove ${a ? gnsApproachName(a.approach) : 'approach'}`, 'from flight plan.'] };
    }
    case 'fpl.remove':
      return { title: 'REMOVE WAYPOINT', lines: [`Remove ${state.fms.plan[popup.index]?.ident ?? ''}`] };
  }
}

function ConfirmWindow({ ui, popup, main, state }: Props & { popup: Extract<Popup, { kind: 'confirm' }> }) {
  const size = ui.model === '530' ? 12.5 : 10;
  const { title, lines } = confirmText(popup, state);
  const w = main.w * 0.82;
  const h = 14 + size * (lines.length + 2.4) * 1.2;
  const x = (main.w - w) / 2;
  const y = (main.h - h) / 2;
  return (
    <WindowFrame x={x} y={y} w={w} h={h} title={title} size={size * 0.85}>
      {lines.map((l, i) => (
        <T key={l} x={0} y={10 + size * 1.2 + i * size * 1.2} w={w} size={size} color="white" align="center">
          {l}
        </T>
      ))}
      <YesNo w={w} y={h - size * 1.45} size={size} yes={popup.yes} />
    </WindowFrame>
  );
}

/**
 * The procedure reminders: an approach not approved for GPS ("GPS guidance
 * is for monitoring only"), and reactivating the approach being flown.
 */
function ProcConfirmWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'procConfirm' }> }) {
  const size = ui.model === '530' ? 12.5 : 9.5;
  const monitor = popup.reason === 'monitor';
  const lines = monitor
    ? ['GPS guidance is for', 'monitoring only.', popup.load?.mode === 'activate' ? 'Activate approach?' : 'Load approach?']
    : ['Are you sure you want to', 'discontinue the current', 'approach?'];
  const w = main.w * 0.9;
  const h = 14 + size * (lines.length + 2.4) * 1.2;
  return (
    <WindowFrame x={(main.w - w) / 2} y={(main.h - h) / 2} w={w} h={h} title={monitor ? 'NOT APPROVED FOR GPS' : 'RESTART APPROACH'} size={size * 0.85}>
      {lines.map((l, i) => (
        <T key={l} x={0} y={10 + size * 1.2 + i * size * 1.2} w={w} size={size} color="white" align="center">
          {l}
        </T>
      ))}
      <YesNo w={w} y={h - size * 1.45} size={size} yes={popup.yes} />
    </WindowFrame>
  );
}

const FIELD_TITLE: Record<ProcField, string> = {
  approach: 'APR',
  transition: 'TRANS',
  arrival: 'ARRIVAL',
  arrivalTrans: 'TRANS',
  arrivalRunway: 'RUNWAY',
  departure: 'DEPARTURE',
  departureRunway: 'RUNWAY',
  departureTrans: 'TRANS',
};

/** Where the procedure pages' right-hand column starts (the windows open just left of it). */
export const procColumnX = (main: Rect) => main.w * 0.6 + 4;

/** The APR / TRANS / RUNWAY windows: the choices, "GPS" after approaches approved for GPS, "IA" after transitions from an IAF. */
function ChoiceWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'choice' }> }) {
  const big = ui.model === '530';
  const size = big ? 13 : 10;
  const rowH = size * 1.22;
  const visible = big ? 9 : 5;
  const top = Math.min(Math.max(popup.index - visible + 1, 0), Math.max(popup.options.length - visible, 0));
  const rows = popup.options.slice(top, top + visible);
  const longest = Math.max(...popup.options.map((o) => o.label.length + (o.gps || o.tag ? 2 : 0)), FIELD_TITLE[popup.field].length);
  const w = Math.min(Math.max(longest * size * 0.62 + 18, size * 5.5), main.w * 0.7);
  const h = 10 + size * 1.15 + rows.length * rowH + 6;
  const x = Math.max(procColumnX(main) - w + size * 1.5, 2);
  const y = Math.min(size * 1.6, Math.max(main.h - h - 2, 2));
  const listTop = 8 + size * 1.15;
  return (
    <WindowFrame x={x} y={y} w={w} h={h} title={FIELD_TITLE[popup.field]} size={size * 0.8}>
      <div class="gns-box" style={at(4, listTop - 2, w - 8, rows.length * rowH + 3)}>
        {rows.map((o, i) => (
          <T key={`${o.value ?? '-'}${top + i}`} x={3} y={1 + i * rowH} size={size} color="green" sel={top + i === popup.index}>
            {o.label}
            {o.gps && <span class="gns-gps">GPS</span>}
            <Tag t={o.tag} />
          </T>
        ))}
      </div>
      {popup.options.length > visible && (
        <div class="gns-scrollbar" style={at(w - 7, listTop, 3, visible * rowH - 2)}>
          <i style={{ top: `${(top / popup.options.length) * 100}%`, height: `${(visible / popup.options.length) * 100}%` }} />
        </div>
      )}
    </WindowFrame>
  );
}

/** TERRAIN ALERT: the alert in a yellow box ("TERRAIN AHEAD" flashes), ENT for the TERRAIN page, CLR back to the page. */
function TerrainAlertWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'terrainAlert' }> }) {
  const size = ui.model === '530' ? 13 : 9.5;
  const w = main.w * 0.92;
  const h = size * 6.4;
  const boxW = w - size * 1.6;
  return (
    <WindowFrame x={(main.w - w) / 2} y={size * 1.2} w={w} h={h} title="TERRAIN ALERT" size={size * 0.85}>
      <div class={`gns-terrain-alert${popup.text === 'TERRAIN AHEAD' ? ' gns-blink' : ''}`} style={at((w - boxW) / 2, 9 + size * 1.1, boxW, size * 1.75)}>
        <T x={0} y={size * 0.3} w={boxW} size={size * 1.25} color="blue" align="center" bold>
          {popup.text}
        </T>
      </div>
      <T x={0} y={h - size * 2.55} w={w} size={size * 0.85} color="cyan" align="center" bold>
        PRESS <span class="gns-ent-box">ENT</span> - TERRAIN PAGE
      </T>
      <T x={0} y={h - size * 1.45} w={w} size={size * 0.85} color="cyan" align="center" bold>
        PRESS <span class="gns-ent-box">CLR</span> - PREVIOUS PAGE
      </T>
    </WindowFrame>
  );
}

/** The leg the ACTIVATE LEG window offers: from the previous waypoint (or the present position) to the leg's fix. */
function legEnds(popup: Extract<Popup, { kind: 'activateLeg' }>, state: SimState): { from: string; to: string; fromTag?: string; toTag?: string } {
  const fms = state.fms;
  if (popup.target === 'plan') {
    return { from: popup.index > 0 ? fms.plan[popup.index - 1]!.ident : 'P.POS', to: fms.plan[popup.index]?.ident ?? '' };
  }
  const legs = fms.approach?.legs ?? [];
  const leg = legs[popup.index];
  let prev = null;
  for (let i = popup.index - 1; i >= 0 && !prev; i--) if (legs[i]!.to) prev = legs[i]!;
  const tag = (l: typeof leg) => (l?.role ? ROLE_TAG[l.role] : undefined);
  return {
    from: prev?.to?.ident ?? fms.plan[fms.plan.length - 1]?.ident ?? 'P.POS',
    to: leg ? legName(leg) : '',
    ...(prev && tag(prev) && { fromTag: tag(prev)! }),
    ...(leg && tag(leg) && { toTag: tag(leg)! }),
  };
}

function ActivateLegWindow({ ui, popup, main, state }: Props & { popup: Extract<Popup, { kind: 'activateLeg' }> }) {
  const size = ui.model === '530' ? 12.5 : 10;
  const ends = legEnds(popup, state);
  const w = main.w * 0.88;
  const h = size * 7.3;
  const x = (main.w - w) / 2;
  const y = (main.h - h) / 2;
  const boxY = 10 + size * 2.4;
  return (
    <WindowFrame x={x} y={y} w={w} h={h} title="ACTIVATE LEG" size={size * 0.85}>
      <T x={0} y={8 + size * 1.15} w={w} size={size} color="white" align="center">
        Fly Leg
      </T>
      <div class="gns-box" style={at(5, boxY, w - 10, size * 1.6)}>
        <T x={4} y={size * 0.25} w={w * 0.36} size={size * 1.15} color="green" align="right">
          {ends.from}
          <Tag t={ends.fromTag} />
        </T>
        <div style={{ position: 'absolute', left: `${w / 2 - size}px`, top: `${size * 0.35}px` }}>
          <LegArrow w={size * 1.8} />
        </div>
        <T x={w / 2 + size * 1.2} y={size * 0.25} size={size * 1.15} color="green">
          {ends.to}
          <Tag t={ends.toTag} />
        </T>
      </div>
      <T x={w - size * 5.2} y={h - size * 1.4} size={size} color="white" sel>
        Activate?
      </T>
    </WindowFrame>
  );
}

const LIST_TITLE = { 'dto.fpl': 'FPL', 'dto.nrst': 'NEAREST', 'navcom.airport': 'AIRPORT' } as const;

function ListWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'list' }> }) {
  const size = ui.model === '530' ? 12.5 : 10;
  const visible = ui.model === '530' ? 8 : 4;
  const top = Math.min(Math.max(popup.index - visible + 1, 0), Math.max(popup.items.length - visible, 0));
  const rows = popup.items.slice(top, top + visible);
  const w = size * 6.2;
  const h = 11 + size * 1.25 + rows.length * size * 1.25 + 4;
  // The D-> FPL list opens over the left of the page, the NEAREST list over the right.
  const x = popup.purpose === 'dto.nrst' ? main.w - w - 8 : popup.purpose === 'dto.fpl' ? 8 : (main.w - w) / 2;
  return (
    <WindowFrame x={x} y={4} w={w} h={h} title={LIST_TITLE[popup.purpose]} size={size * 0.85}>
      {rows.map((wp, i) => (
        <T key={`${wp.ident}${top + i}`} x={8} y={9 + size * 1.25 + i * size * 1.25} size={size} color="white" sel={top + i === popup.index}>
          {wp.ident}
        </T>
      ))}
    </WindowFrame>
  );
}

function NoticeWindow({ ui, popup, main }: Props & { popup: Extract<Popup, { kind: 'notice' }> }) {
  const size = ui.model === '530' ? 12 : 9.5;
  const w = main.w * 0.9;
  const h = 14 + size * 1.2 * (popup.lines.length + 1.2);
  return (
    <WindowFrame x={(main.w - w) / 2} y={(main.h - h) / 2} w={w} h={h} title={popup.title} size={size * 0.9}>
      {popup.lines.map((l, i) => (
        <T key={l} x={0} y={10 + size * 1.3 + i * size * 1.2} w={w} size={size} color={i === 0 ? 'green' : 'white'} align="center">
          {l}
        </T>
      ))}
    </WindowFrame>
  );
}

export function PopupLayer(props: Props) {
  const { popup } = props;
  let body;
  switch (popup.kind) {
    case 'menu':
      body = <MenuWindow {...props} popup={popup} />;
      break;
    case 'confirm':
      body = <ConfirmWindow {...props} popup={popup} />;
      break;
    case 'activateLeg':
      body = <ActivateLegWindow {...props} popup={popup} />;
      break;
    case 'procConfirm':
      body = <ProcConfirmWindow {...props} popup={popup} />;
      break;
    case 'choice':
      body = <ChoiceWindow {...props} popup={popup} />;
      break;
    case 'terrainAlert':
      body = <TerrainAlertWindow {...props} popup={popup} />;
      break;
    case 'list':
      body = <ListWindow {...props} popup={popup} />;
      break;
    case 'notice':
      body = <NoticeWindow {...props} popup={popup} />;
      break;
  }
  return (
    <>
      <div class="gns-dim" />
      {body}
    </>
  );
}
