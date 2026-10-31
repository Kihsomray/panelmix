import type { TransponderMode } from '../../../sim/types';
import type { Gtn, PageView } from '../context';
import type { Page } from '../model';
import { backspace, completeCode, moveCursor, pressDigit, rollDigit, type SquawkEntry } from '../squawk';
import { GlyphKey, Key } from '../ui';

/*
 * XPDR control panel: squawk keys 0-7, VFR, Backspace, and the Standby / On /
 * Altitude Reporting mode keys. A typed code takes effect with Enter (or
 * ENT+ID on the transponder window); IDENT is that window while this page is
 * open.
 */

type XpdrPage = Extract<Page, { kind: 'xpdr' }>;

const VFR_CODE = '1200';

const MODES: readonly { mode: TransponderMode; label: string }[] = [
  { mode: 'STBY', label: 'Standby' },
  { mode: 'ON', label: 'On' },
  { mode: 'ALT', label: 'Altitude Reporting' },
];

function setEntry(g: Gtn, page: XpdrPage, entry: SquawkEntry) {
  g.go({ type: 'update', page: { ...page, entry } });
}

function enter(g: Gtn, page: XpdrPage) {
  const code = completeCode(page.entry);
  if (!code) return;
  g.dispatch({ type: 'xpdr.code', code });
  g.go({ type: 'back' });
}

function XpdrBody({ g, page }: { g: Gtn; page: XpdrPage }) {
  const e = page.entry;
  const mode = g.state.xpdr.mode;
  const shown = e.editing ? e.code : g.state.xpdr.code;
  const digit = (d: string) => (
    <Key key={d} class="gtn-round-key" onPress={() => setEntry(g, page, pressDigit(e, d))}>
      {d}
    </Key>
  );
  return (
    <div class={`gtn-xpdr gtn-xpdr-${g.model}`}>
      <div class="gtn-xpdr-top">
        <span class="gtn-xpdr-title">XPDR</span>
        <span class={`gtn-entry-field gtn-xpdr-field${e.editing ? ' is-editing' : ''}`} aria-live="polite" aria-label={`Squawk ${shown.replace(/_/g, ' blank ')}`}>
          {e.editing ? (
            [...shown].map((ch, i) => (
              <span key={i} class={i === Math.min(e.cursor, 3) && e.cursor < 4 ? 'is-cursor' : ''}>
                {ch}
              </span>
            ))
          ) : (
            // The active code, highlighted: typing replaces it.
            <span class="gtn-entry-current">{shown}</span>
          )}
        </span>
        <GlyphKey glyph="backspace" text={g.model === '750' ? 'Backspace' : 'BKSP'} class="gtn-xpdr-bksp" onPress={() => setEntry(g, page, backspace(e))} />
      </div>
      <div class="gtn-xpdr-pad">
        <div class="gtn-xpdr-digits">{['0', '1', '2', '3', '4', '5', '6', '7'].map(digit)}</div>
        <Key
          class="gtn-xpdr-vfr"
          label="VFR: squawk 1200"
          onPress={() => {
            g.dispatch({ type: 'xpdr.code', code: VFR_CODE });
            setEntry(g, page, { code: VFR_CODE, cursor: 0, editing: false });
          }}
        >
          VFR
        </Key>
      </div>
      <div class="gtn-xpdr-modes" role="group" aria-label="Mode">
        <span class="gtn-xpdr-modes-label">Mode</span>
        {MODES.map((m) => (
          <Key key={m.mode} class="gtn-xpdr-modekey" indicator={mode === m.mode} onPress={() => g.dispatch({ type: 'xpdr.mode', mode: m.mode })}>
            {m.label}
          </Key>
        ))}
      </div>
    </div>
  );
}

export function xpdrView(g: Gtn, page: XpdrPage): PageView {
  const editing = page.entry.editing;
  return {
    body: <XpdrBody g={g} page={page} />,
    controls: {
      ...(editing && { back: 'cancel' as const }),
      primary: { label: 'Enter', glyph: 'enter', onPress: () => enter(g, page), disabled: completeCode(page.entry) === null },
    },
    knob: {
      outer: (n) => setEntry(g, page, moveCursor(page.entry, n)),
      inner: (n) => setEntry(g, page, rollDigit(page.entry, n)),
      push: () => enter(g, page),
      hint: 'Squawk / Psh Enter',
      labels: { outer: 'Cursor', inner: 'Digit', push: 'Enter' },
    },
  };
}
