import { openRadioPanel, swapRadio } from './actions';
import type { Gtn } from './context';
import { gtnFreq } from './format';
import type { RadioBand } from './keypad';
import { completeCode } from './squawk';
import { useFrequencyLookup } from './lookups';
import { topPage } from './navigation';

/*
 * The radio windows: COM and NAV (active over standby) and the transponder.
 * Tapping an active frequency swaps it with standby; tapping standby opens
 * the keypad. The standby window the knob tunes has a cyan border, filled
 * blue while it is being turned.
 */

export interface KnobRadioState {
  /** The standby window the dual knob is on, if any. */
  readonly focus: RadioBand | null;
  /** That window was turned in the last few seconds. */
  readonly turning: boolean;
  /** Volume being adjusted: show the level in this radio's window. */
  readonly volume: RadioBand | null;
}

export function FreqBox({ g, band, knob }: { g: Gtn; band: RadioBand; knob: KnobRadioState }) {
  const pair = band === 'com' ? g.state.radios.com[0] : g.state.radios.nav[0];
  const activeLookup = useFrequencyLookup(band, pair.activeKhz, g.lists);
  const standbyLookup = useFrequencyLookup(band, pair.standbyKhz, g.lists);
  const focused = knob.focus === band;
  const label = band === 'com' ? 'COM' : 'NAV';
  // NAV shows the Morse-decoded identifier of the station actually received.
  const decoded = band === 'nav' ? g.derived.vor[0].station?.ident ?? '' : '';
  const status = band === 'com' ? (g.settings.squelchOpen ? 'SQ' : '') : g.state.radios.navIdent[0] ? 'ID' : '';
  const volume = knob.volume === band ? g.settings.volume[band] : null;
  return (
    <div class={`gtn-freqbox gtn-freqbox-${band}${focused ? ' is-focused' : ''}${focused && knob.turning ? ' is-turning' : ''}`}>
      <button
        type="button"
        class="gtn-freq-active"
        aria-label={`${label} active ${gtnFreq(band, pair.activeKhz)}. Tap to swap with standby.`}
        onClick={() => swapRadio(g, band)}
      >
        <span class="gtn-freq-label">
          {label}
          {decoded && <span class="gtn-freq-decoded">{decoded}</span>}
          {status && <span class="gtn-freq-status">{status}</span>}
        </span>
        <span class="gtn-freq-value gtn-green">{gtnFreq(band, pair.activeKhz)}</span>
        <span class="gtn-freq-lookup">{activeLookup}</span>
        <span class="gtn-freq-flip" aria-hidden="true">
          ⇕
        </span>
        {volume !== null && (
          <span class="gtn-freq-volume" aria-live="polite">
            <span>
              {label} VOL {volume}%
            </span>
            <span class="gtn-vol-track">
              <span class="gtn-vol-fill" style={{ width: `${volume}%` }} />
            </span>
          </span>
        )}
      </button>
      <button
        type="button"
        class="gtn-freq-standby"
        aria-label={`${label} standby ${gtnFreq(band, pair.standbyKhz)}. Tap for the keypad.`}
        onClick={() => openRadioPanel(g, band)}
      >
        <span class="gtn-freq-label">
          STBY
          {band === 'com' && g.settings.monitor && <span class="gtn-freq-status">MON</span>}
        </span>
        <span class="gtn-freq-value gtn-standby">{gtnFreq(band, pair.standbyKhz)}</span>
        <span class="gtn-freq-lookup">{standbyLookup}</span>
      </button>
    </div>
  );
}

const MODE_TEXT = { OFF: 'OFF', STBY: 'STBY', ON: 'ON', ALT: 'ALT', GND: 'GND' } as const;

/**
 * The transponder window. Elsewhere it shows code and mode and opens the XPDR
 * page; on that page it becomes the IDENT key (ENT+ID with a new code typed).
 */
export function XpdrBox({ g }: { g: Gtn }) {
  const x = g.state.xpdr;
  const page = topPage(g.nav);
  const replying = x.mode === 'ON' || x.mode === 'ALT' || x.mode === 'GND';
  const ident = x.identUntil !== null;
  if (page.kind === 'xpdr') {
    const pending = completeCode(page.entry);
    const canIdent = replying;
    return (
      <button
        type="button"
        class={`gtn-xpdrbox is-ident-key${canIdent ? '' : ' is-unavailable'}`}
        aria-label={pending ? 'Enter the new code and ident' : 'Ident'}
        onClick={() => {
          if (pending) {
            g.dispatch({ type: 'xpdr.code', code: pending });
            g.go({ type: 'back' });
          }
          g.dispatch({ type: 'xpdr.ident' });
        }}
      >
        <span class="gtn-freq-label">
          XPDR
          <span class="gtn-xpdr-flags">
            {replying && <span class="gtn-green">R</span>}
            {ident && <span class="gtn-green">ID</span>}
          </span>
        </span>
        <span class="gtn-xpdr-ident">{pending ? 'ENT+ID' : 'IDENT'}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      class="gtn-xpdrbox"
      aria-label={`Transponder ${x.code}, ${MODE_TEXT[x.mode]}. Tap for the transponder page.`}
      onClick={() => g.go({ type: 'open', page: { kind: 'xpdr', entry: { code: x.code, cursor: 0, editing: false } } })}
    >
      <span class="gtn-freq-label">
        XPDR
        <span class={`gtn-xpdr-mode${replying ? ' gtn-green' : ''}`}>{MODE_TEXT[x.mode]}</span>
      </span>
      <span class={`gtn-xpdr-code${replying ? ' gtn-green' : ''}`}>{x.code}</span>
      <span class="gtn-xpdr-flags gtn-xpdr-flags-low">
        {replying && <span class="gtn-green">R</span>}
        {ident && <span class="gtn-green">ID</span>}
      </span>
    </button>
  );
}

/** Label next to the volume knob telling what turning and pushing it does. */
export function VolumeHint({ band, vertical }: { band: RadioBand; vertical: boolean }) {
  const lines = band === 'nav' ? ['Nav', 'Vol', 'Psh', 'ID'] : ['Com', 'Vol', 'Psh', 'Sq'];
  return vertical ? (
    <div class="gtn-volhint is-vertical" aria-hidden="true">
      <span class="gtn-volhint-arrow">↰</span>
      <span>{lines[0]}</span>
      <span>{lines[1]}</span>
      <span>-</span>
      <span>{lines[2]}</span>
      <span>{lines[3]}</span>
    </div>
  ) : (
    <div class="gtn-volhint" aria-hidden="true">
      <span>
        {lines[0]} {lines[1]}
      </span>
      <span>
        {lines[2]} {lines[3]}
      </span>
    </div>
  );
}
