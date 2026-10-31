import type { Airport, Navaid } from '../../../core/navdb';
import { formatNav } from '../../../core/frequency';
import { openWaypointInfo } from '../actions';
import type { Gtn, PageView } from '../context';
import { gtnCom, runwayLength } from '../format';
import { AppIcon, type AppIconName } from '../icons';
import { primaryFrequency, ranged, type Ranged } from '../lookups';
import type { AppId, Page, WaypointCategory } from '../model';
import { BrgDis, IdentKey, Key } from '../ui';

/*
 * Nearest: the category icons, then lists of the 25 closest airports, VORs
 * and NDBs with bearing arrow and distance. Airports add the longest runway
 * and a frequency key that loads COM; VOR frequency keys load NAV. Tapping an
 * identifier opens its information page; the knob moves a cursor that the
 * Direct-To key pre-fills from.
 */

type ListPage = Extract<Page, { kind: 'nearestList' }>;

interface Category {
  readonly label: string;
  readonly icon: AppIconName;
  readonly page: Page;
}

const cat = (label: string, icon: AppIconName, page: Page): Category => ({ label, icon, page });
const missing = (label: string, icon: AppIconName, app: AppId) => cat(label, icon, { kind: 'app', app });

const CATEGORIES: readonly Category[] = [
  cat('Airport', 'airport', { kind: 'nearestList', category: 'airport', cursor: null }),
  missing('Intersection', 'intersection', 'intersection'),
  cat('VOR', 'vor', { kind: 'nearestList', category: 'vor', cursor: null }),
  missing('VRP', 'vrp', 'vrp'),
  cat('NDB', 'ndb', { kind: 'nearestList', category: 'ndb', cursor: null }),
  missing('User Waypoint', 'user', 'user'),
  missing('Airspace', 'airspace', 'airspace'),
  missing('ARTCC', 'artcc', 'artcc'),
  missing('FSS', 'fss', 'fss'),
  missing('Weather', 'wxfreq', 'wxfreq'),
];

export function nearestView(g: Gtn): PageView {
  return {
    title: 'Nearest',
    body: (
      <div class="gtn-icon-grid">
        {CATEGORIES.map((c) => (
          <button key={c.label} type="button" class="gtn-app gtn-app-small" onClick={() => g.go({ type: 'open', page: c.page })}>
            <AppIcon name={c.icon} />
            <span class="gtn-app-label">{c.label}</span>
          </button>
        ))}
      </div>
    ),
    controls: {},
    knob: {},
  };
}

const TITLES: Record<WaypointCategory, string> = { airport: 'Nearest Airport', vor: 'Nearest VOR', ndb: 'Nearest NDB' };

function loadFreqModal(g: Gtn, band: 'com' | 'nav', khz: number, label: string) {
  g.go({ type: 'modal', modal: { kind: 'loadFreq', band, khz, label } });
}

function AirportRow({ g, r, cursor, onSelect }: { g: Gtn; r: Ranged<Airport>; cursor: boolean; onSelect: () => void }) {
  const a = g.state.aircraft;
  const f = primaryFrequency(r.item);
  const rwy = r.item.runways[0];
  return (
    <div class={`gtn-row gtn-nrst-row${cursor ? ' is-cursor' : ''}`} onClick={onSelect}>
      <IdentKey waypoint={r.item} class="gtn-list-ident" onPress={() => openWaypointInfo(g, r.item)} />
      <BrgDis bearingMag={g.mag.toMagnetic(r.bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={r.distanceNm} />
      <span class="gtn-nrst-rwy">
        {rwy ? runwayLength(rwy.lengthFt) : '-'}
        <small>{rwy ? (rwy.surface === 'hard' ? 'Hard' : rwy.surface === 'water' ? 'Water' : 'Soft') : ''}</small>
      </span>
      {f ? (
        <Key class="gtn-freq-key" label={`Load ${f.type} ${gtnCom(f.khz)}`} onPress={() => loadFreqModal(g, 'com', f.khz, `${r.item.ident} ${f.type}`)}>
          <span class="gtn-freq-key-value">{gtnCom(f.khz)}</span>
          <span class="gtn-freq-key-type">{f.type}</span>
        </Key>
      ) : (
        <span class="gtn-freq-key is-empty" />
      )}
    </div>
  );
}

function NavaidRow({ g, r, cursor, onSelect }: { g: Gtn; r: Ranged<Navaid>; cursor: boolean; onSelect: () => void }) {
  const a = g.state.aircraft;
  const isVor = r.item.kind === 'vor';
  return (
    <div class={`gtn-row gtn-nrst-row${cursor ? ' is-cursor' : ''}`} onClick={onSelect}>
      <IdentKey waypoint={r.item} class="gtn-list-ident" onPress={() => openWaypointInfo(g, r.item)} />
      <BrgDis bearingMag={g.mag.toMagnetic(r.bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={r.distanceNm} />
      {isVor ? (
        <Key class="gtn-freq-key" label={`Load ${r.item.ident} ${formatNav(r.item.freqKhz)} into NAV`} onPress={() => loadFreqModal(g, 'nav', r.item.freqKhz, `${r.item.ident} VOR`)}>
          <span class="gtn-freq-key-value">{formatNav(r.item.freqKhz)}</span>
          <span class="gtn-freq-key-type">{r.item.type}</span>
        </Key>
      ) : (
        <span class="gtn-nrst-ndbfreq">
          {r.item.freqKhz}
          <small>kHz</small>
        </span>
      )}
    </div>
  );
}

function NearestListBody({ g, page }: { g: Gtn; page: ListPage }) {
  const pos = g.state.aircraft;
  const select = (i: number) => g.go({ type: 'update', page: { ...page, cursor: i } });
  if (page.category === 'airport') {
    const rows = ranged(g.lists.airports, pos);
    return (
      <div class="gtn-list">
        {rows.length === 0 && <div class="gtn-empty">No airports within 200 NM</div>}
        {rows.map((r, i) => (
          <AirportRow key={r.item.ident} g={g} r={r} cursor={page.cursor === i} onSelect={() => select(i)} />
        ))}
      </div>
    );
  }
  const rows = ranged(page.category === 'vor' ? g.lists.vors : g.lists.ndbs, pos);
  return (
    <div class="gtn-list">
      {rows.length === 0 && <div class="gtn-empty">None within 200 NM</div>}
      {rows.map((r, i) => (
        <NavaidRow key={r.item.ident + r.item.lat} g={g} r={r} cursor={page.cursor === i} onSelect={() => select(i)} />
      ))}
    </div>
  );
}

export function nearestListView(g: Gtn, page: ListPage): PageView {
  const n = page.category === 'airport' ? g.lists.airports.length : page.category === 'vor' ? g.lists.vors.length : g.lists.ndbs.length;
  return {
    title: TITLES[page.category],
    body: <NearestListBody g={g} page={page} />,
    controls: {},
    knob: {
      inner: (s) => {
        if (n === 0) return;
        const from = page.cursor ?? (s > 0 ? -1 : n);
        g.go({ type: 'update', page: { ...page, cursor: Math.min(Math.max(from + s, 0), n - 1) } });
      },
      innerIcon: 'scroll',
    },
  };
}
