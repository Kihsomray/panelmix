import type { ComponentChildren } from 'preact';
import type { Confirm, PageMenu } from '../shared/menu';

/*
 * G1000 window furniture in native screen pixels: a titled window, a group
 * box with its name set into the top border, the PAGE MENU list and the
 * two-choice confirmation window. The highlighted field is cyan with black
 * text, as on the unit.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const place = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

export function Win({ rect, title, children, class: className }: { rect: Rect; title?: string; children: ComponentChildren; class?: string }) {
  return (
    <div class={`g1000-win${className ? ` ${className}` : ''}`} style={place(rect)}>
      {title && <div class="g1000-win-title">{title}</div>}
      {children}
    </div>
  );
}

export function Group({ title, children, class: className }: { title: string; children: ComponentChildren; class?: string }) {
  return (
    <div class={`g1000-group${className ? ` ${className}` : ''}`}>
      <div class="g1000-group-title">{title}</div>
      {children}
    </div>
  );
}

/** A field that takes the cursor. */
export function Field({ on, children, class: className }: { on: boolean; children: ComponentChildren; class?: string }) {
  return <span class={`g1000-field${on ? ' is-cursor' : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function MenuWindow({ menu, rect, empty = 'No options on this page' }: { menu: PageMenu; rect: Rect; empty?: string }) {
  return (
    <Win rect={rect} title={menu.title} class="g1000-menu">
      <Group title="OPTIONS">
        {menu.items.length === 0 ? (
          <div class="g1000-menu-item is-disabled">{empty}</div>
        ) : (
          menu.items.map((item, i) => (
            <div key={item.id} class={`g1000-menu-item${item.enabled ? '' : ' is-disabled'}${i === menu.cursor ? ' is-cursor' : ''}`}>
              {item.label}
            </div>
          ))
        )}
      </Group>
      <div class="g1000-hint">Press the FMS CRSR knob to return to base page</div>
    </Win>
  );
}

export function ConfirmWindow({ confirm, rect }: { confirm: Confirm; rect: Rect }) {
  return (
    <Win rect={rect} class="g1000-confirm">
      {confirm.leg && <div class="g1000-confirm-leg">{confirm.leg}</div>}
      <div class="g1000-confirm-msg">{confirm.message}</div>
      <div class="g1000-confirm-choices">
        <Field on={confirm.choice === 0}>{confirm.ok}</Field>
        <span class="g1000-or">or</span>
        <Field on={confirm.choice === 1}>{confirm.cancel}</Field>
      </div>
    </Win>
  );
}
