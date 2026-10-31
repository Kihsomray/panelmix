import type { ComponentChildren } from 'preact';
import { angleDiff } from '../../core/geo';
import type { AnyWaypoint, Waypoint } from '../../core/navdb';
import { formatBearing, formatDistance } from '../../ui/format';
import { Glyph, WaypointSymbol, type GlyphName } from './icons';

/*
 * GTN touch controls: the rounded keys with a soft gloss, function keys with
 * their on/off bar, tabs, identifier keys and the bearing arrow, all sized in
 * design pixels inside the screen.
 */

export interface KeyProps {
  readonly children: ComponentChildren;
  readonly onPress: () => void;
  readonly label?: string;
  readonly disabled?: boolean;
  /** Cyan border: the item the knob points at, or the chosen option. */
  readonly selected?: boolean;
  /** Function key state bar: green when on, gray when off. */
  readonly indicator?: boolean;
  readonly class?: string;
  readonly style?: Record<string, string | number>;
}

export function Key(p: KeyProps) {
  const cls = ['gtn-key', p.selected && 'is-selected', p.indicator !== undefined && 'has-indicator', p.class].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      class={cls}
      style={p.style}
      disabled={p.disabled}
      aria-label={p.label}
      aria-pressed={p.indicator}
      onClick={(e) => {
        e.stopPropagation();
        p.onPress();
      }}
    >
      <span class="gtn-key-body">{p.children}</span>
      {p.indicator !== undefined && <span class={`gtn-key-bar${p.indicator ? ' is-on' : ''}`} aria-hidden="true" />}
    </button>
  );
}

/** A key the real unit has but the trainer cannot act on: drawn grayed, not selectable. */
export function InertKey({ children, note, class: cls = '' }: { children: ComponentChildren; note: string; class?: string }) {
  return (
    <span class={`gtn-key is-disabled ${cls}`} title={note} aria-disabled="true" aria-label={note}>
      <span class="gtn-key-body">{children}</span>
    </span>
  );
}

/** A key with a picture over a word, like the control bar keys. */
export function GlyphKey({ glyph, text, ...rest }: Omit<KeyProps, 'children'> & { glyph: GlyphName; text: string }) {
  return (
    <Key {...rest} label={rest.label ?? text} class={`gtn-glyph-key ${rest.class ?? ''}`}>
      <Glyph name={glyph} />
      <span class="gtn-glyph-text">{text}</span>
    </Key>
  );
}

export function TitleBar({ children }: { children: ComponentChildren }) {
  return (
    <div class="gtn-title">
      <span>{children}</span>
    </div>
  );
}

export interface TabSpec<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Tabs down the side of a pane (or along the top), the active one joined to the pane. */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  vertical = true,
}: {
  tabs: readonly TabSpec<T>[];
  active: T;
  onSelect: (id: T) => void;
  vertical?: boolean;
}) {
  return (
    <div class={`gtn-tabs ${vertical ? 'is-vertical' : 'is-horizontal'}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          class={`gtn-tab${t.id === active ? ' is-active' : ''}`}
          disabled={t.disabled}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Identifier key: ident and type symbol on top, the facility name below. */
export function IdentKey({
  waypoint,
  onPress,
  tone = 'cyan',
  selected = false,
  placeholder = 'Select Waypoint',
  class: cls = '',
}: {
  waypoint: (Waypoint & { towered?: boolean }) | AnyWaypoint | null;
  onPress: () => void;
  tone?: 'cyan' | 'magenta' | 'white';
  selected?: boolean;
  placeholder?: string;
  class?: string;
}) {
  if (!waypoint) {
    return (
      <Key class={`gtn-ident-key is-empty ${cls}`} onPress={onPress} selected={selected}>
        <span class="gtn-ident-placeholder">{placeholder}</span>
      </Key>
    );
  }
  const towered = 'towered' in waypoint ? waypoint.towered : false;
  return (
    <Key class={`gtn-ident-key ${cls}`} onPress={onPress} selected={selected} label={`${waypoint.ident}, ${waypoint.name}`}>
      <span class={`gtn-ident gtn-${tone}`}>{waypoint.ident}</span>
      <WaypointSymbol kind={waypoint.kind} towered={towered} />
      <span class="gtn-ident-name">{waypoint.name}</span>
    </Key>
  );
}

/** Cyan arrow pointing at a waypoint relative to the airplane's track, as on GTN lists. */
export function BearingArrow({ bearingMag, trackMag }: { bearingMag: number; trackMag: number }) {
  const rel = angleDiff(bearingMag, trackMag);
  return (
    <svg class="gtn-brg-arrow" viewBox="-10 -10 20 20" aria-hidden="true">
      <g transform={`rotate(${rel})`}>
        <path d="M0 -9 L4 -3 L1 -3 L1 9 L-1 9 L-1 -3 L-4 -3 Z" fill="#2fd7ff" />
      </g>
    </svg>
  );
}

/** Bearing and distance pair used by nearest and search lists. */
export function BrgDis({ bearingMag, trackMag, distanceNm }: { bearingMag: number; trackMag: number; distanceNm: number }) {
  return (
    <span class="gtn-brgdis">
      <span class="gtn-dis">
        {formatDistance(distanceNm)}
        <small>NM</small>
      </span>
      <span class="gtn-brg">
        <BearingArrow bearingMag={bearingMag} trackMag={trackMag} />
        {formatBearing(bearingMag)}
      </span>
    </span>
  );
}

/** A labelled value: user fields, data lines. */
export function DataField({ label, value, unit = '', tone = 'white', class: cls = '' }: { label: string; value: string; unit?: string; tone?: string; class?: string }) {
  return (
    <div class={`gtn-field ${cls}`}>
      <span class="gtn-field-label">{label}</span>
      <span class={`gtn-field-value gtn-${tone}`}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/** Honest placeholder where the real unit would show data the trainer does not have. */
export function NotAvailable({ title = 'Not available in the trainer', children }: { title?: string; children?: ComponentChildren }) {
  return (
    <div class="gtn-na" role="note">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

/** A pop-up window over the page. */
export function Popup({ title, children, class: cls = '' }: { title: string; children: ComponentChildren; class?: string }) {
  return (
    <div class="gtn-popup-scrim">
      <div class={`gtn-popup ${cls}`} role="dialog" aria-label={title}>
        <div class="gtn-popup-title">{title}</div>
        <div class="gtn-popup-body">{children}</div>
      </div>
    </div>
  );
}
