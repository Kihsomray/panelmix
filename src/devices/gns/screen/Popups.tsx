import type { ComponentChildren } from 'preact';
import type { SimState } from '../../../sim/types';
import type { Rect } from '../layout';
import type { GnsUi, Popup } from '../model/types';
import { at, T } from './kit';
import { LegArrow } from './symbols';

/*
 * Windows that open over a page: the PAGE MENU, "Yes? or No?" confirmations,
 * ACTIVATE LEG, the small pop-up lists and notices. White and cyan double
 * edge on blue, the page behind dimmed, inverse video on the choice.
 */

interface Props {
  readonly ui: GnsUi;
  readonly popup: Popup;
  readonly main: Rect;
  readonly state: SimState;
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

function ConfirmWindow({ ui, popup, main, state }: Props & { popup: Extract<Popup, { kind: 'confirm' }> }) {
  const size = ui.model === '530' ? 12.5 : 10;
  const lines =
    popup.action === 'fpl.delete'
      ? ['Delete all waypoints in', 'flight plan.']
      : [`Remove ${state.fms.plan[popup.index]?.ident ?? ''}`];
  const title = popup.action === 'fpl.delete' ? 'DELETE FLIGHT PLAN' : 'REMOVE WAYPOINT';
  const w = main.w * 0.82;
  const h = 14 + size * (lines.length + 2.4) * 1.2;
  const x = (main.w - w) / 2;
  const y = (main.h - h) / 2;
  const bottom = h - size * 1.45;
  return (
    <WindowFrame x={x} y={y} w={w} h={h} title={title} size={size * 0.85}>
      {lines.map((l, i) => (
        <T key={l} x={0} y={10 + size * 1.2 + i * size * 1.2} w={w} size={size} color="white" align="center">
          {l}
        </T>
      ))}
      <T x={w / 2 - size * 3.4} y={bottom} size={size} color="white" sel={popup.yes}>
        Yes?
      </T>
      <T x={w / 2 - size * 0.6} y={bottom} size={size} color="white">
        or
      </T>
      <T x={w / 2 + size * 1.2} y={bottom} size={size} color="white" sel={!popup.yes}>
        No?
      </T>
    </WindowFrame>
  );
}

function ActivateLegWindow({ ui, popup, main, state }: Props & { popup: Extract<Popup, { kind: 'activateLeg' }> }) {
  const size = ui.model === '530' ? 12.5 : 10;
  const plan = state.fms.plan;
  const to = plan[popup.index];
  const from = popup.index > 0 ? plan[popup.index - 1]!.ident : 'P.POS';
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
          {from}
        </T>
        <div style={{ position: 'absolute', left: `${w / 2 - size}px`, top: `${size * 0.35}px` }}>
          <LegArrow w={size * 1.8} />
        </div>
        <T x={w / 2 + size * 1.2} y={size * 0.25} size={size * 1.15} color="green">
          {to?.ident ?? ''}
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
