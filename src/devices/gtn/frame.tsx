import type { ComponentChildren } from 'preact';
import type { ControlKey, Controls, Gtn } from './context';
import { formatBearing } from '../../ui/format';
import { DirectToGlyph, Glyph } from './icons';
import { SHORTCUT_LABEL, SHORTCUTS, shortcutOf, topPage } from './navigation';
import { toggleObs } from './pages/obs';
import { GlyphKey, Key } from './ui';

/*
 * The screen furniture around the pages: the control keys (a row along the
 * bottom of the 750Xi, columns either side on the 650Xi), the annunciator bar
 * with the knob's page locater, and the CDI / GPS nav status bar.
 */

// Keys ---------------------------------------------------------------------------

function messageKeyVisible(g: Gtn): boolean {
  return g.derived.unreadMessages > 0 || topPage(g.nav).kind === 'messages';
}

/** MSG flashes while advisories are unread; pressing it again acknowledges them and closes the list. */
function MsgKey({ g }: { g: Gtn }) {
  const open = topPage(g.nav).kind === 'messages';
  const unread = g.derived.unreadMessages > 0;
  return (
    <GlyphKey
      glyph="msg"
      text="MSG"
      class={`gtn-ctl-key${unread ? ' is-flashing' : ''}${open ? ' is-selected' : ''}`}
      label={unread ? `Messages, ${g.derived.unreadMessages} unread` : 'Messages'}
      onPress={() => {
        if (open) {
          g.dispatch({ type: 'msg.readAll' });
          g.go({ type: 'back' });
        } else {
          g.go({ type: 'open', page: { kind: 'messages' } });
        }
      }}
    />
  );
}

function BackKey({ g, controls }: { g: Gtn; controls: Controls }) {
  const cancel = controls.back === 'cancel';
  return (
    <GlyphKey
      glyph={cancel ? 'cancel' : 'back'}
      text={cancel ? 'Cancel' : 'Back'}
      class="gtn-ctl-key"
      onPress={controls.onBack ?? (() => g.go({ type: 'back' }))}
    />
  );
}

function CdiKey({ g }: { g: Gtn }) {
  const src = g.state.nav.cdiSource;
  return (
    <GlyphKey
      glyph="cdi"
      text="CDI"
      class="gtn-ctl-key"
      label={`CDI source ${src === 'GPS' ? 'GPS' : 'VLOC'}. Tap to switch.`}
      onPress={() => g.dispatch({ type: 'cdi.cycle', sources: g.panel.cdiSources })}
    />
  );
}

function ObsKey({ g }: { g: Gtn }) {
  const on = g.state.fms.obsMode;
  const usable = g.state.fms.activeLeg !== null;
  return (
    <GlyphKey
      glyph="obs"
      text="OBS"
      class={`gtn-ctl-key${on ? ' is-lit' : ''}`}
      disabled={!usable}
      label={on ? 'OBS on. Tap to resume automatic sequencing.' : 'OBS. Tap to hold the active waypoint and set a course.'}
      onPress={() => toggleObs(g)}
    />
  );
}

function ZoomKeys({ g }: { g: Gtn }) {
  return (
    <div class="gtn-zoom-pair">
      <GlyphKey glyph="zoomIn" text="In" class="gtn-ctl-key" label="Zoom in" onPress={() => g.set({ type: 'zoom', steps: -1 })} />
      <GlyphKey glyph="zoomOut" text="Out" class="gtn-ctl-key" label="Zoom out" onPress={() => g.set({ type: 'zoom', steps: 1 })} />
    </div>
  );
}

function PageKey({ k }: { k: ControlKey }) {
  const body =
    k.glyph === 'direct' ? (
      <>
        <DirectToGlyph />
        <span class="gtn-glyph-text">{k.label}</span>
      </>
    ) : k.glyph ? (
      <>
        <Glyph name={k.glyph} />
        <span class="gtn-glyph-text">{k.label}</span>
      </>
    ) : (
      <span class="gtn-glyph-text">{k.label}</span>
    );
  return (
    <Key class={`gtn-ctl-key gtn-glyph-key${k.active ? ' is-lit' : ''}`} onPress={k.onPress} disabled={k.disabled ?? false} label={k.label}>
      {body}
    </Key>
  );
}

/** 750Xi: Back, MSG, Menu, CDI, OBS, then zoom or the page's own keys on the right. */
export function ControlBar750({ g, controls }: { g: Gtn; controls: Controls }) {
  const slot = (child: ComponentChildren, key: string) => (
    <div class="gtn-ctl-slot" key={key}>
      {child}
    </div>
  );
  return (
    <div class="gtn-ctlbar">
      {slot(controls.back !== 'none' && <BackKey g={g} controls={controls} />, 'back')}
      {slot(messageKeyVisible(g) && <MsgKey g={g} />, 'msg')}
      {slot(controls.menu && <GlyphKey glyph="menu" text="Menu" class="gtn-ctl-key" onPress={controls.menu} />, 'menu')}
      {slot(controls.cdiObs && <CdiKey g={g} />, 'cdi')}
      {slot(controls.cdiObs && <ObsKey g={g} />, 'obs')}
      {controls.zoom ? (
        <div class="gtn-ctl-slot is-double">
          <ZoomKeys g={g} />
        </div>
      ) : (
        <>
          {slot(controls.secondary && <PageKey k={controls.secondary} />, 'secondary')}
          {slot(controls.primary && <PageKey k={controls.primary} />, 'primary')}
        </>
      )}
    </div>
  );
}

/** 650Xi left column under the volume label: Menu, MSG, Back. */
export function LeftKeys650({ g, controls }: { g: Gtn; controls: Controls }) {
  return (
    <div class="gtn-leftkeys">
      <div class="gtn-ctl-slot">
        {controls.menu ? (
          <GlyphKey glyph="menu" text="Menu" class="gtn-ctl-key" onPress={controls.menu} />
        ) : (
          controls.secondary && <PageKey k={controls.secondary} />
        )}
      </div>
      <div class="gtn-ctl-slot">{messageKeyVisible(g) && <MsgKey g={g} />}</div>
      <div class="gtn-ctl-slot">{controls.back !== 'none' && <BackKey g={g} controls={controls} />}</div>
    </div>
  );
}

/** 650Xi bottom of the right column: zoom, CDI/OBS or the page's Enter/Activate. */
export function RightSlot650({ g, controls }: { g: Gtn; controls: Controls }) {
  if (controls.zoom) return <ZoomKeys g={g} />;
  if (controls.primary) return <PageKey k={controls.primary} />;
  if (controls.cdiObs) {
    return (
      <div class="gtn-zoom-pair">
        <CdiKey g={g} />
        <ObsKey g={g} />
      </div>
    );
  }
  return null;
}

// Annunciator bar -----------------------------------------------------------------

/** What the bar's right end says about the dual knob. */
export type KnobHintView =
  | { readonly kind: 'locater'; readonly icon: 'zoom' | 'scroll' | null }
  | { readonly kind: 'text'; readonly text: string };

/** The knob symbol, with what the small knob does on this page (zoom or scroll). */
function KnobGlyph({ icon }: { icon: 'zoom' | 'scroll' | null }) {
  return (
    <svg class="gtn-knob-glyph" viewBox="0 0 26 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <circle cx="6" cy="6" r="1.8" fill="currentColor" />
      <path d="M11 6 H15" stroke="currentColor" stroke-width="1.4" />
      {icon === 'zoom' && (
        <g fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="20" cy="5" r="3.2" />
          <path d="M17.7 7.4 L15.5 10.5" />
        </g>
      )}
      {icon === 'scroll' && <path d="M19 1 L21.5 4.5 H16.5 Z M19 11 L21.5 7.5 H16.5 Z" fill="currentColor" />}
      {icon === null && <circle cx="19" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4" />}
    </svg>
  );
}

function Locater({ g }: { g: Gtn }) {
  const slots = SHORTCUTS[g.model];
  const here = shortcutOf(topPage(g.nav));
  const i = here ? slots.indexOf(here) : -1;
  const start = Math.min(Math.max(i - 1, 0), slots.length - 3);
  const shown = slots.slice(start, start + 3);
  return (
    <span class="gtn-locater" aria-label="Page shortcuts: turn the large knob">
      <span class={`gtn-locater-arrow${start > 0 ? '' : ' is-off'}`}>‹</span>
      {shown.map((id) => (
        <span key={id} class={`gtn-locater-slot${id === here ? ' is-active' : ''}`}>
          {SHORTCUT_LABEL[id]}
        </span>
      ))}
      <span class={`gtn-locater-arrow${start + 3 < slots.length ? '' : ' is-off'}`}>›</span>
    </span>
  );
}

export function AnnunciatorBar({ g, hint }: { g: Gtn; hint: KnobHintView }) {
  const vloc = g.state.nav.cdiSource !== 'GPS';
  const phase = g.derived.gps.active ? g.derived.gps.scale : 'ENR';
  return (
    <div class="gtn-annunciator" role="status">
      <span class="gtn-ann-cell" />
      <span class="gtn-ann-cell gtn-green">{phase}</span>
      <span class="gtn-ann-cell" />
      <span class={`gtn-ann-cell ${vloc ? 'gtn-green' : 'gtn-magenta'}`}>{vloc ? 'VLOC' : 'GPS'}</span>
      <span class="gtn-ann-cell gtn-ann-obs">{g.state.fms.obsMode ? 'OBS' : ''}</span>
      <span class="gtn-ann-knob">
        {hint.kind === 'locater' ? (
          <>
            <Locater g={g} />
            <KnobGlyph icon={hint.icon} />
            <span class="gtn-ann-push">PshCom</span>
          </>
        ) : (
          <span class="gtn-ann-hint">{hint.text} ▶</span>
        )}
      </span>
    </div>
  );
}

// CDI and GPS nav status ---------------------------------------------------------

const BLANK = '______';

/** From / to / next waypoints over a GPS course deviation scale. Tapping it opens the flight plan. */
export function CdiBar({ g, class: cls = '' }: { g: Gtn; class?: string }) {
  const gps = g.derived.gps;
  const leg = g.state.fms.activeLeg;
  const needle = gps.active ? gps.needle : 0;
  const dots = [-1, -0.5, 0.5, 1];
  return (
    <button
      type="button"
      class={`gtn-cdibar ${cls}`}
      aria-label={gps.to ? `GPS nav status: to ${gps.to.ident}. Tap for the flight plan.` : 'No active leg. Tap for the flight plan.'}
      onClick={() => g.go({ type: 'open', page: { kind: 'flightPlan', cursor: null } })}
    >
      <span class={`gtn-cdibar-route${leg?.isDirectTo || g.state.fms.obsMode ? ' is-centered' : ''}`}>
        {g.state.fms.obsMode && leg ? (
          // OBS: the selected course to the held waypoint.
          <>
            <span>obs {formatBearing(g.state.fms.obsCourseMag)}</span>
            <span class="gtn-magenta">→</span>
            <span class="gtn-magenta">{leg.to.ident}</span>
          </>
        ) : leg?.isDirectTo ? (
          <>
            <span class="gtn-magenta gtn-cdibar-dto">
              <DirectToGlyph />
            </span>
            <span class="gtn-magenta">{leg.to.ident}</span>
          </>
        ) : (
          <>
            <span>{gps.from?.ident ?? BLANK}</span>
            <span class="gtn-magenta">→</span>
            <span class={gps.to ? 'gtn-magenta' : ''}>{gps.to?.ident ?? BLANK}</span>
            <span>→</span>
            <span>{gps.next?.ident ?? BLANK}</span>
          </>
        )}
      </span>
      <span class="gtn-cdibar-scale" aria-hidden="true">
        {dots.map((d) => (
          <span key={d} class="gtn-cdi-dot" style={{ left: `${50 + d * 40}%` }} />
        ))}
        {gps.active && (
          <>
            <span class={`gtn-cdi-tofrom ${gps.toFrom === 'FROM' ? 'is-from' : ''}`} />
            <span class="gtn-cdi-needle" style={{ left: `${50 + needle * 40}%` }} />
          </>
        )}
        {!gps.active && <span class="gtn-cdi-center" />}
      </span>
    </button>
  );
}
