import { formatNav } from '../../../core/frequency';
import type { Airport } from '../../../core/navdb';
import { activeOf, setStandby, standbyOf, swapRadio } from '../actions';
import type { Gtn, PageView } from '../context';
import { gtnCom, gtnFreq } from '../format';
import { backspace, entryDisplay, entryValue, pressDigit, startFreqEntry, tuneEntry, type FreqEntry, type RadioBand } from '../keypad';
import { comFrequencies, frequencyLookup, isAirport, primaryFrequency, ranged, recordOf } from '../lookups';
import type { FindTab, Page } from '../model';
import { BrgDis, GlyphKey, IdentKey, Key, Tabs, type TabSpec } from '../ui';

/*
 * COM / NAV Standby control panels: the direct tuning field with autofill,
 * the digit keys, Find, Monitor (COM), XFER and Enter. Find lists frequencies
 * from nearby airports and VORs, recent tuning and the flight plan.
 */

type RadioPage = Extract<Page, { kind: 'radio' }>;
type FindPage = Extract<Page, { kind: 'find' }>;

const TITLE: Record<RadioBand, string> = { com: 'COM Standby', nav: 'NAV Standby' };

function setEntry(g: Gtn, page: RadioPage, entry: FreqEntry) {
  g.go({ type: 'update', page: { ...page, entry } });
}

function enter(g: Gtn, page: RadioPage) {
  setStandby(g, page.band, entryValue(page.band, page.entry));
  g.go({ type: 'back' });
}

/** XFER: completes what was typed into standby, then flip-flops; the panel stays open. */
function transfer(g: Gtn, page: RadioPage) {
  const value = entryValue(page.band, page.entry);
  const active = activeOf(g, page.band);
  if (value !== standbyOf(g, page.band)) setStandby(g, page.band, value);
  swapRadio(g, page.band);
  setEntry(g, page, startFreqEntry(active));
}

function RadioBody({ g, page }: { g: Gtn; page: RadioPage }) {
  const { band, entry } = page;
  const d = entryDisplay(band, entry);
  const digit = (k: string) => (
    <Key key={k} class="gtn-round-key" onPress={() => setEntry(g, page, pressDigit(band, entry, k))}>
      {k}
    </Key>
  );
  const keys = g.model === '750' ? ['1', '2', '3', '4', '5', '6', '7', '8', '9'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  return (
    <div class={`gtn-radio gtn-radio-${g.model}`}>
      <div class="gtn-radio-top">
        <GlyphKey glyph="find" text="Find" class="gtn-radio-find" onPress={() => g.go({ type: 'open', page: { kind: 'find', band, tab: 'nearest' } })} />
        <span class={`gtn-entry-field${d.placeholder ? '' : ' is-editing'}`} aria-live="polite" aria-label={`${TITLE[band]} ${d.typed}${d.fill}`}>
          <span class={d.placeholder ? 'gtn-entry-current' : ''}>{d.typed}</span>
          <span class="gtn-entry-fill">{d.fill}</span>
        </span>
        <GlyphKey glyph="backspace" text={g.model === '750' ? 'Backspace' : 'BKSP'} class="gtn-radio-bksp" onPress={() => setEntry(g, page, backspace(entry))} />
      </div>
      <div class="gtn-radio-pad">{keys.map(digit)}</div>
      <div class="gtn-radio-bottom">
        {band === 'com' ? (
          <Key class="gtn-radio-mon" indicator={g.settings.monitor} label="Monitor standby" onPress={() => g.set({ type: 'monitor' })}>
            Monitor
          </Key>
        ) : (
          <span class="gtn-radio-mon" />
        )}
        {g.model === '750' && digit('0')}
        <GlyphKey glyph="xfer" text="XFER" class="gtn-radio-xfer" label="Transfer to active" onPress={() => transfer(g, page)} />
      </div>
    </div>
  );
}

export function radioView(g: Gtn, page: RadioPage): PageView {
  const tune = (knob: 'mhz' | 'khz') => (n: number) => setEntry(g, page, tuneEntry(page.band, page.entry, knob, n));
  return {
    title: TITLE[page.band],
    body: <RadioBody g={g} page={page} />,
    controls: { primary: { label: 'Enter', glyph: 'enter', onPress: () => enter(g, page) } },
    knob: {
      outer: tune('mhz'),
      inner: tune('khz'),
      push: () => enter(g, page),
      hint: 'Num Entry / Psh Enter',
      labels: { outer: 'MHz', inner: 'kHz', push: 'Enter' },
    },
  };
}

// Find ---------------------------------------------------------------------------------

const FIND_TABS: readonly TabSpec<FindTab>[] = [
  { id: 'nearest', label: 'Nearest' },
  { id: 'recent', label: 'Recent' },
  { id: 'fpl', label: 'Flight Plan' },
  { id: 'user', label: 'User' },
];

/** Puts a frequency into the standby panel under Find and closes Find (Enter then loads it). */
export function chooseFindFrequency(g: Gtn, khz: number) {
  g.go({ type: 'modal', modal: null });
  const under = g.nav.stack[g.nav.stack.length - 2];
  g.go({ type: 'back' });
  if (under?.kind === 'radio') g.go({ type: 'update', page: { ...under, entry: startFreqEntry(khz) } });
}

function FreqChoice({ g, page, khz, sub }: { g: Gtn; page: FindPage; khz: number; sub: string }) {
  return (
    <Key class="gtn-freq-key" label={`Use ${gtnFreq(page.band, khz)} ${sub}`} onPress={() => chooseFindFrequency(g, khz)}>
      <span class="gtn-freq-key-value">{gtnFreq(page.band, khz)}</span>
      <span class="gtn-freq-key-type">{sub}</span>
    </Key>
  );
}

function AirportFreqRow({ g, page, ap, distanceNm, bearingTrue }: { g: Gtn; page: FindPage; ap: Airport; distanceNm: number; bearingTrue: number }) {
  const a = g.state.aircraft;
  const freqs = comFrequencies(ap);
  const f = primaryFrequency(ap);
  return (
    <div class="gtn-row">
      <IdentKey waypoint={ap} class="gtn-list-ident" onPress={() => g.go({ type: 'modal', modal: { kind: 'freqList', ident: ap.ident } })} />
      <BrgDis bearingMag={g.mag.toMagnetic(bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={distanceNm} />
      {freqs.length > 1 ? (
        <Key class="gtn-freq-key gtn-multi" onPress={() => g.go({ type: 'modal', modal: { kind: 'freqList', ident: ap.ident } })}>
          Multiple FREQ
        </Key>
      ) : f ? (
        <FreqChoice g={g} page={page} khz={f.khz} sub={f.type} />
      ) : (
        <span class="gtn-freq-key is-empty" />
      )}
    </div>
  );
}

function FindBody({ g, page }: { g: Gtn; page: FindPage }) {
  const a = g.state.aircraft;
  let content;
  if (page.tab === 'nearest') {
    content =
      page.band === 'com'
        ? ranged(g.lists.airports, a)
            .filter((r) => comFrequencies(r.item).length > 0)
            .map((r) => <AirportFreqRow key={r.item.ident} g={g} page={page} ap={r.item} distanceNm={r.distanceNm} bearingTrue={r.bearingTrue} />)
        : ranged(g.lists.vors, a).map((r) => (
            <div class="gtn-row" key={r.item.ident + r.item.lat}>
              <IdentKey waypoint={r.item} class="gtn-list-ident" onPress={() => chooseFindFrequency(g, r.item.freqKhz)} />
              <BrgDis bearingMag={g.mag.toMagnetic(r.bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={r.distanceNm} />
              <FreqChoice g={g} page={page} khz={r.item.freqKhz} sub="VOR" />
            </div>
          ));
  } else if (page.tab === 'recent') {
    const list = g.settings.recentFreqs[page.band];
    content =
      list.length === 0 ? (
        <div class="gtn-empty">No recent frequencies</div>
      ) : (
        list.map((khz) => (
          <div class="gtn-row" key={khz}>
            <span class="gtn-recent-label">{frequencyLookup(page.band, khz, g.lists) || '-'}</span>
            <FreqChoice g={g} page={page} khz={khz} sub={page.band === 'com' ? 'COM' : 'NAV'} />
          </div>
        ))
      );
  } else if (page.tab === 'fpl') {
    const rows = g.state.fms.plan
      .map((w) => recordOf(g.db, w))
      .filter((r, i, all) => r && all.findIndex((x) => x?.ident === r.ident) === i)
      .flatMap((rec) => {
        if (page.band === 'com' && isAirport(rec)) {
          const r = ranged([rec], a)[0]!;
          return [<AirportFreqRow key={rec.ident} g={g} page={page} ap={rec} distanceNm={r.distanceNm} bearingTrue={r.bearingTrue} />];
        }
        if (page.band === 'nav' && rec?.kind === 'vor' && 'freqKhz' in rec) {
          return [
            <div class="gtn-row" key={rec.ident}>
              <IdentKey waypoint={rec} class="gtn-list-ident" onPress={() => chooseFindFrequency(g, rec.freqKhz)} />
              <span class="gtn-recent-label">{formatNav(rec.freqKhz)}</span>
              <FreqChoice g={g} page={page} khz={rec.freqKhz} sub="VOR" />
            </div>,
          ];
        }
        return [];
      });
    content = rows.length > 0 ? rows : <div class="gtn-empty">No flight plan frequencies</div>;
  } else {
    content = <div class="gtn-empty">No user frequencies</div>;
  }
  return (
    <div class="gtn-find">
      <Tabs tabs={FIND_TABS} active={page.tab} onSelect={(tab) => g.go({ type: 'update', page: { ...page, tab } })} />
      <div class="gtn-list gtn-find-list">{content}</div>
    </div>
  );
}

export function findView(g: Gtn, page: FindPage): PageView {
  return {
    title: page.band === 'com' ? 'Find COM Frequency' : 'Find NAV Frequency',
    body: <FindBody g={g} page={page} />,
    controls: {},
    knob: {},
  };
}

/** Frequencies of one airport, for the Multiple FREQ pop-up. */
export function airportFrequencyChoices(g: Gtn, ident: string): { khz: number; label: string }[] {
  const ap = g.db.airport(ident);
  if (!ap) return [];
  return comFrequencies(ap).map((f) => ({ khz: f.khz, label: `${gtnCom(f.khz)} ${f.type}${f.description && f.description !== f.type ? ` ${f.description}` : ''}` }));
}

