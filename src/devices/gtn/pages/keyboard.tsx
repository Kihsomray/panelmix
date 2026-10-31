import { useMemo } from 'preact/hooks';
import { distanceNm } from '../../../core/geo';
import { NavDatabase, type AnyWaypoint, type Waypoint } from '../../../core/navdb';
import { openWaypointInfo, targetFor } from '../actions';
import type { Gtn, PageView } from '../context';
import { keyboardIdent, keyboardReducer, keyboardSplit, typedPrefix, type KeyboardAction } from '../keyboard';
import { ranged, recordOf } from '../lookups';
import type { KeyboardPurpose, Page, WptFindTab } from '../model';
import { BrgDis, GlyphKey, IdentKey, Key, Tabs, type TabSpec } from '../ui';
import { directToWith } from './directTo';

/*
 * Waypoint Identifier entry: the alphanumeric keyboard with Garmin autofill
 * (cyan), FastFind (the nearest identifier that starts with what was typed)
 * and Find, the search tabs (recent, nearest, flight plan). Enter hands the
 * waypoint to whatever opened the keyboard: Direct-To, a flight plan insert
 * or a waypoint information page.
 */

type KeyboardPage = Extract<Page, { kind: 'keyboard' }>;
type FindPage = Extract<Page, { kind: 'wptFind' }>;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '1234567890';
/** 650Xi keysets: two rows of letters each, then the digits. */
const KEYSETS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', DIGITS] as const;
const KEYSET_LABELS = ['A-M', 'N-Z', '123'] as const;
const FASTFIND_SCAN = 4000;

/**
 * Hands a picked waypoint to the page that opened the keyboard. `depth` is
 * how many entry pages sit on top of it (keyboard, plus Find when used).
 */
function finishWaypointPick(g: Gtn, purpose: KeyboardPurpose, w: Waypoint, depth: number): void {
  const wp = NavDatabase.toWaypoint(w);
  const under = g.nav.stack[g.nav.stack.length - 1 - depth];
  for (let i = 0; i < depth; i++) g.go({ type: 'back' });
  g.set({ type: 'recentWaypoint', waypoint: wp });
  switch (purpose.kind) {
    case 'directTo':
      if (under?.kind === 'directTo') g.go({ type: 'update', page: directToWith(under, targetFor(g, wp)) });
      return;
    case 'fplInsert':
      g.dispatch({ type: 'fms.insert', index: purpose.index, waypoint: wp });
      return;
    case 'wptInfo':
      if (under?.kind === 'wpt' && (wp.kind === 'airport' || wp.kind === 'vor' || wp.kind === 'ndb')) {
        g.go({ type: 'update', page: { ...under, category: wp.kind, waypoint: wp, tab: 'info', runway: 0 } });
      } else {
        openWaypointInfo(g, wp);
      }
  }
}

/** The nearest waypoint whose identifier starts with `prefix`, for FastFind. */
function useFastFind(g: Gtn, prefix: string): AnyWaypoint | null {
  const ky = Math.round(g.state.aircraft.lat * 10);
  const kx = Math.round(g.state.aircraft.lon * 10);
  return useMemo(() => {
    if (!prefix) return null;
    const at = { lat: ky / 10, lon: kx / 10 };
    let best: AnyWaypoint | null = null;
    let bestNm = Infinity;
    for (const w of g.db.search(prefix, FASTFIND_SCAN)) {
      const d = distanceNm(at, w);
      if (d < bestNm) {
        best = w;
        bestNm = d;
      }
    }
    return best;
  }, [g.db, prefix, ky, kx]);
}

function KeyboardBody({ g, page }: { g: Gtn; page: KeyboardPage }) {
  const edit = (a: KeyboardAction) => updateEntry(g, page, a);
  const { typed, fill } = keyboardSplit(page.entry);
  const ident = keyboardIdent(page.entry);
  const matches = ident ? g.db.find(ident) : [];
  const match = ident ? g.db.get(ident, g.state.aircraft) : undefined;
  const fast = useFastFind(g, typedPrefix(page.entry));
  const status = !ident ? '' : !match ? 'No matches found' : matches.length > 1 ? 'Duplicates found' : '';
  const place = match ? ('city' in match && match.city ? `${match.name}, ${match.city}` : match.name) : '';
  const charKey = (ch: string) => (
    <Key key={ch} class="gtn-char" onPress={() => edit({ type: 'char', ch })}>
      {ch}
    </Key>
  );
  return (
    <div class={`gtn-kbd gtn-kbd-${g.model}`}>
      <div class="gtn-kbd-top">
        {g.model === '750' && (
          <GlyphKey glyph="find" text="Find" class="gtn-kbd-find" onPress={() => openFind(g, page)} />
        )}
        <div class="gtn-kbd-field" aria-live="polite" aria-label={`Identifier ${ident || 'empty'}`}>
          <span class="gtn-kbd-typed">{typed}</span>
          <span class="gtn-cyan">{fill}</span>
          <span class="gtn-kbd-caret" />
          <span class="gtn-kbd-place">{status || place}</span>
        </div>
        <GlyphKey glyph="backspace" text={g.model === '750' ? 'Backspace' : 'BKSP'} class="gtn-kbd-bksp" onPress={() => edit({ type: 'backspace' })} />
        <div class="gtn-kbd-fastfind">
          <span class="gtn-kbd-fastfind-title">FastFind</span>
          {fast ? (
            <IdentKey waypoint={fast} class="gtn-kbd-fastfind-key" onPress={() => finishWaypointPick(g, page.purpose, fast, 1)} />
          ) : (
            <span class="gtn-key is-disabled gtn-kbd-fastfind-key">No suggestion</span>
          )}
        </div>
      </div>
      {g.model === '750' ? (
        <div class="gtn-kbd-keys">
          <div class="gtn-kbd-letters">{[...LETTERS].map(charKey)}</div>
          <div class="gtn-kbd-digits">{[...DIGITS].map(charKey)}</div>
        </div>
      ) : (
        <div class="gtn-kbd-keys">
          <div class="gtn-kbd-letters">{[...KEYSETS[page.keyset]!].map(charKey)}</div>
          <div class="gtn-kbd-sets">
            {KEYSET_LABELS.map((label, i) => (
              <Key key={label} class="gtn-kbd-set" selected={i === page.keyset} onPress={() => g.go({ type: 'update', page: { ...page, keyset: i } })}>
                {label}
              </Key>
            ))}
            <GlyphKey glyph="find" text="Find" class="gtn-kbd-set" onPress={() => openFind(g, page)} />
          </div>
        </div>
      )}
    </div>
  );
}

function updateEntry(g: Gtn, page: KeyboardPage, a: KeyboardAction) {
  const complete = (p: string) => g.db.complete(p)?.ident;
  g.go({ type: 'update', page: { ...page, entry: keyboardReducer(page.entry, a, complete) } });
}

function openFind(g: Gtn, page: KeyboardPage) {
  g.go({ type: 'open', page: { kind: 'wptFind', purpose: page.purpose, tab: 'nearest' } });
}

function enter(g: Gtn, page: KeyboardPage) {
  const ident = keyboardIdent(page.entry);
  const w = ident ? g.db.get(ident, g.state.aircraft) : undefined;
  if (w) finishWaypointPick(g, page.purpose, w, 1);
}

export function keyboardView(g: Gtn, page: KeyboardPage): PageView {
  return {
    title: 'Waypoint Identifier',
    body: <KeyboardBody g={g} page={page} />,
    controls: { primary: { label: 'Enter', glyph: 'enter', onPress: () => enter(g, page) } },
    knob: {
      inner: (steps) => updateEntry(g, page, { type: 'small', steps }),
      outer: (steps) => updateEntry(g, page, { type: 'large', steps }),
      push: () => enter(g, page),
      hint: 'Wpt Ident / Psh Enter',
      labels: { outer: 'Cursor', inner: 'Character', push: 'Enter' },
    },
  };
}

// Find: waypoint search tabs ---------------------------------------------------------

const FIND_TABS: readonly TabSpec<WptFindTab>[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'nearest', label: 'Nearest' },
  { id: 'fpl', label: 'Flight Plan' },
  { id: 'user', label: 'User' },
];

function FindBody({ g, page }: { g: Gtn; page: FindPage }) {
  const a = g.state.aircraft;
  const pickW = (w: Waypoint) => finishWaypointPick(g, page.purpose, w, 2);
  let items: Waypoint[] = [];
  if (page.tab === 'recent') items = [...g.settings.recentWaypoints];
  if (page.tab === 'nearest') items = [...g.lists.airports, ...g.lists.vors, ...g.lists.ndbs];
  if (page.tab === 'fpl') items = [...g.state.fms.plan];
  // Nearest is sorted by distance; recent and flight plan keep their own order.
  const rows = page.tab === 'nearest' ? ranged(items, a).slice(0, 25) : items.map((w) => ranged([w], a)[0]!);
  return (
    <div class="gtn-find">
      <Tabs tabs={FIND_TABS} active={page.tab} onSelect={(tab) => g.go({ type: 'update', page: { ...page, tab } })} />
      <div class="gtn-list gtn-find-list">
        {page.tab === 'user' && <div class="gtn-empty">No user waypoints</div>}
        {page.tab !== 'user' && rows.length === 0 && <div class="gtn-empty">{page.tab === 'recent' ? 'No recent waypoints' : 'No flight plan'}</div>}
        {rows.map((r, i) => (
          <div class="gtn-row" key={`${i}-${r.item.ident}`}>
            <IdentKey waypoint={recordOf(g.db, r.item) ?? r.item} class="gtn-list-ident" onPress={() => pickW(r.item)} />
            <BrgDis bearingMag={g.mag.toMagnetic(r.bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={r.distanceNm} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function wptFindView(g: Gtn, page: FindPage): PageView {
  return {
    title: 'Find Waypoint',
    body: <FindBody g={g} page={page} />,
    controls: {},
    knob: {},
  };
}
