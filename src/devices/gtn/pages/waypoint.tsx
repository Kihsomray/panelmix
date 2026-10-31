import { useMemo } from 'preact/hooks';
import { bearing, distanceNm, formatLat, formatLon } from '../../../core/geo';
import { formatNav } from '../../../core/frequency';
import type { Airport, AirportFrequency, Navaid, Waypoint } from '../../../core/navdb';
import { formatBearing, formatDistance } from '../../../ui/format';
import { defaultWaypoint } from '../actions';
import type { Gtn, PageView } from '../context';
import { declination, gtnCom, runwayLength } from '../format';
import { AppIcon, type AppIconName } from '../icons';
import { startKeyboard } from '../keyboard';
import { comFrequencies, isAirport, isNavaid, recordOf } from '../lookups';
import { MapCanvas, mapVersion, type MapPicture } from '../mapCanvas';
import type { AppId, Page, WaypointCategory, WptTab } from '../model';
import { BearingArrow, IdentKey, Key, NotAvailable, Tabs, type TabSpec } from '../ui';

/*
 * Waypoint Info: the category icons, then the information page for an
 * airport (Info, Procedures, Runways, Frequencies, WX Data, NOTAMs tabs), a
 * VOR or an NDB. Frequency keys load the radios; the identifier key opens the
 * keyboard to look up another waypoint. The 750Xi adds a map preview.
 */

type WptPage = Extract<Page, { kind: 'wpt' }>;

interface Category {
  readonly label: string;
  readonly icon: AppIconName;
  readonly page: Page;
}

const info = (category: WaypointCategory): Page => ({ kind: 'wpt', category, waypoint: null, tab: 'info', runway: 0 });
const missing = (app: AppId): Page => ({ kind: 'app', app });

const CATEGORIES: readonly Category[] = [
  { label: 'Airport', icon: 'airport', page: info('airport') },
  { label: 'Intersection', icon: 'intersection', page: missing('intersection') },
  { label: 'VOR', icon: 'vor', page: info('vor') },
  { label: 'VRP', icon: 'vrp', page: missing('vrp') },
  { label: 'NDB', icon: 'ndb', page: info('ndb') },
  { label: 'User WPT', icon: 'user', page: missing('user') },
];

export function waypointInfoView(g: Gtn): PageView {
  return {
    title: 'Waypoint Info',
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

const AIRPORT_TABS: readonly TabSpec<WptTab>[] = [
  { id: 'info', label: 'Info' },
  { id: 'proc', label: 'Procedures' },
  { id: 'runways', label: 'Runways' },
  { id: 'freqs', label: 'Frequencies' },
  { id: 'wx', label: 'WX Data' },
  { id: 'notams', label: 'NOTAMs' },
];

const TITLES: Record<WaypointCategory, string> = {
  airport: 'Waypoint Info - Airport',
  vor: 'Waypoint Info - VOR',
  ndb: 'Waypoint Info - NDB',
};

function openKeyboard(g: Gtn, page: WptPage, ident: string) {
  g.go({ type: 'open', page: { kind: 'keyboard', purpose: { kind: 'wptInfo', category: page.category }, entry: startKeyboard(ident), keyset: 0 } });
}

/** Identifier key with distance, bearing and position: the top of every information page. */
function Header({ g, page, w }: { g: Gtn; page: WptPage; w: Airport | Navaid | Waypoint }) {
  const a = g.state.aircraft;
  const brg = g.mag.toMagnetic(bearing(a, w), a.lat, a.lon);
  return (
    <div class="gtn-wpt-head">
      <IdentKey waypoint={w} class="gtn-wpt-identkey" onPress={() => openKeyboard(g, page, w.ident)} />
      <div class="gtn-wpt-disbrg">
        <span class="gtn-data-label">DIS:</span>
        <span class="gtn-data-value">
          {formatDistance(distanceNm(a, w))}
          <small>NM</small>
        </span>
        <span class="gtn-data-label">BRG:</span>
        <span class="gtn-data-value">
          <BearingArrow bearingMag={brg} trackMag={g.derived.trackMag} />
          {formatBearing(brg)}
        </span>
      </div>
      <div class="gtn-wpt-pos">
        <span>{formatLat(w.lat)}</span>
        <span>{formatLon(w.lon)}</span>
      </div>
    </div>
  );
}

function FreqKey({ g, band, khz, label, sub }: { g: Gtn; band: 'com' | 'nav'; khz: number; label: string; sub: string }) {
  const text = band === 'com' ? gtnCom(khz) : formatNav(khz);
  return (
    <Key class="gtn-freq-key" label={`Load ${label} ${text}`} onPress={() => g.go({ type: 'modal', modal: { kind: 'loadFreq', band, khz, label } })}>
      <span class="gtn-freq-key-value">{text}</span>
      <span class="gtn-freq-key-type">{sub}</span>
    </Key>
  );
}

/** Map preview inside the airport tabs (750Xi): the pane is narrower than the page. */
const PREVIEW_IN_TABS = { w: 344, h: 150 } as const;

/** A small map around the waypoint, like the GTN's preview window. */
function Preview({ g, w, rangeNm, width, height }: { g: Gtn; w: Waypoint; rangeNm: number; width: number; height: number }) {
  const a = g.state.aircraft;
  const picture: MapPicture = {
    db: g.db,
    center: w,
    ownship: { lat: a.lat, lon: a.lon, headingTrue: a.headingTrue },
    ringNm: rangeNm,
    ringShare: 0.5,
    upTrue: 0,
    plan: g.state.fms.plan,
    activeLeg: g.state.fms.activeLeg,
    declutter: 1,
    highlight: w,
    navRing: false,
    magVar: g.derived.magVar,
    trackTrue: a.trackTrue,
    groundSpeedKt: a.groundSpeedKt,
  };
  return (
    <div class="gtn-wpt-preview" style={{ width: `${width}px`, height: `${height}px` }}>
      <MapCanvas w={width} h={height} picture={picture} version={mapVersion(picture, width, height, g.state.fms.revision)} label={`Map of ${w.ident}`} />
    </div>
  );
}

function AirportInfo({ g, ap }: { g: Gtn; ap: Airport }) {
  const longest = ap.runways[0];
  return (
    <div class="gtn-wpt-lines">
      <span class="gtn-data-label">Location</span>
      <span class="gtn-data-value">{[ap.city, ap.state].filter(Boolean).join(', ') || '-'}</span>
      <span class="gtn-data-label">Elevation</span>
      <span class="gtn-data-value">
        {ap.elevationFt.toLocaleString('en-US')}
        <small>FT</small>
      </span>
      <span class="gtn-data-label">Type</span>
      <span class="gtn-data-value">
        {ap.towered ? 'Towered' : 'Non-towered'}
        {ap.lighted ? ', lighted' : ''}
      </span>
      <span class="gtn-data-label">Longest runway</span>
      <span class="gtn-data-value">{longest ? `${longest.name} ${runwayLength(longest.lengthFt)}` : '-'}</span>
      <span class="gtn-data-label">Fuel</span>
      <span class="gtn-data-value gtn-gray">Not in database</span>
      {g.model === '750' && (
        <Preview g={g} w={ap} rangeNm={Math.max(((longest?.lengthFt ?? 3000) / 6076) * 0.9, 0.5)} width={PREVIEW_IN_TABS.w} height={PREVIEW_IN_TABS.h} />
      )}
    </div>
  );
}

function AirportRunways({ g, page, ap }: { g: Gtn; page: WptPage; ap: Airport }) {
  const i = Math.min(page.runway, Math.max(ap.runways.length - 1, 0));
  const r = ap.runways[i];
  if (!r) return <NotAvailable title="No runway data" />;
  return (
    <div class="gtn-wpt-lines">
      <span class="gtn-data-label">Runway</span>
      <Key
        class="gtn-rwy-key"
        label={`Runway ${r.name}. Tap for the next runway.`}
        onPress={() => g.go({ type: 'update', page: { ...page, runway: (i + 1) % ap.runways.length } })}
      >
        <span class="gtn-cyan">{r.name}</span>
        <small>
          {i + 1} of {ap.runways.length}
        </small>
      </Key>
      <span class="gtn-data-label">Size</span>
      <span class="gtn-data-value">
        {r.lengthFt.toLocaleString('en-US')} x {r.widthFt}
        <small>FT</small>
      </span>
      <span class="gtn-data-label">Surface</span>
      <span class="gtn-data-value">{r.surface === 'hard' ? 'Hard surface' : r.surface === 'water' ? 'Water' : 'Turf / soft'}</span>
      <span class="gtn-data-label">Lighting</span>
      <span class="gtn-data-value">{r.lighted ? 'Lighted' : 'Not lighted'}</span>
    </div>
  );
}

/** The key's second line: the facility's own name for the frequency ("POTOMAC APP"), else its type. */
const freqSub = (f: AirportFrequency) => (f.description && f.description !== f.type ? f.description : f.type);

function AirportFreqs({ g, ap }: { g: Gtn; ap: Airport }) {
  const list = comFrequencies(ap);
  if (list.length === 0) return <NotAvailable title="No frequencies in the database" />;
  return (
    <div class="gtn-list gtn-freq-list">
      {list.map((f, i) => (
        <div class="gtn-row" key={`${f.type}-${f.khz}-${i}`}>
          <span class="gtn-freq-type">{f.type === 'CTAF' ? 'CTAF (c)' : f.type}</span>
          <FreqKey g={g} band="com" khz={f.khz} label={`${ap.ident} ${f.type}`} sub={freqSub(f)} />
        </div>
      ))}
    </div>
  );
}

function AirportPage({ g, page, ap }: { g: Gtn; page: WptPage; ap: Airport }) {
  return (
    <div class={`gtn-wpt gtn-wpt-${g.model}`}>
      <Header g={g} page={page} w={ap} />
      <div class="gtn-wpt-body">
        <Tabs tabs={AIRPORT_TABS} active={page.tab} onSelect={(tab) => g.go({ type: 'update', page: { ...page, tab } })} />
        <div class="gtn-wpt-pane">
          {page.tab === 'info' && <AirportInfo g={g} ap={ap} />}
          {page.tab === 'runways' && <AirportRunways g={g} page={page} ap={ap} />}
          {page.tab === 'freqs' && <AirportFreqs g={g} ap={ap} />}
          {page.tab === 'proc' && <NotAvailable title="Not in the trainer database">Approaches, departures and arrivals are not loaded.</NotAvailable>}
          {page.tab === 'wx' && <NotAvailable title="No weather data">METARs and TAFs need a datalink the trainer does not simulate.</NotAvailable>}
          {page.tab === 'notams' && <NotAvailable title="No NOTAMs">NOTAMs need FIS-B, which the trainer does not simulate.</NotAvailable>}
        </div>
      </div>
    </div>
  );
}

const VOR_CLASS: Record<string, string> = { HIGH: 'High Altitude', MEDIUM: 'Low Altitude', LOW: 'Terminal' };

function NavaidPage({ g, page, n }: { g: Gtn; page: WptPage; n: Navaid }) {
  // Nearest airport to the station itself, which may be far from the airplane.
  const nearest = useMemo(() => g.db.nearestAirports(n, 1)[0], [g.db, n.ident, n.lat, n.lon]);
  const isVor = n.kind === 'vor';
  return (
    <div class={`gtn-wpt gtn-wpt-${g.model}`}>
      <Header g={g} page={page} w={n} />
      <div class="gtn-wpt-lines gtn-wpt-navaid">
        <span class="gtn-data-label">Location</span>
        <span class="gtn-data-value">{n.name}</span>
        <span class="gtn-data-label">{isVor ? 'VOR Class' : 'Type'}</span>
        <span class="gtn-data-value">{isVor ? `${VOR_CLASS[n.power] ?? n.power} ${n.type}` : n.type}</span>
        <span class="gtn-data-label">Frequency</span>
        {isVor ? (
          <FreqKey g={g} band="nav" khz={n.freqKhz} label={`${n.ident} VOR`} sub={n.type} />
        ) : (
          <span class="gtn-data-value">
            {n.freqKhz}
            <small>kHz</small>
          </span>
        )}
        {isVor && (
          <>
            <span class="gtn-data-label">Station Declination</span>
            <span class="gtn-data-value">{declination(n.magVar)}</span>
          </>
        )}
        <span class="gtn-data-label">Nearest Airport</span>
        <span class="gtn-data-value">
          {nearest ? (
            <>
              {nearest.item.ident} {formatDistance(nearest.distanceNm)}
              <small>NM</small>
            </>
          ) : (
            '-'
          )}
        </span>
      </div>
      {g.model === '750' && <Preview g={g} w={n} rangeNm={10} width={g.box.w - 10} height={PREVIEW_IN_TABS.h + 30} />}
    </div>
  );
}

function WptBody({ g, page }: { g: Gtn; page: WptPage }) {
  const w = page.waypoint ?? defaultWaypoint(g, page.category);
  const rec = w ? recordOf(g.db, w) : undefined;
  if (!w || !rec) {
    return (
      <div class="gtn-wpt">
        <IdentKey waypoint={null} class="gtn-wpt-identkey" onPress={() => openKeyboard(g, page, '')} />
        <NotAvailable title="No waypoint selected" />
      </div>
    );
  }
  if (isAirport(rec)) return <AirportPage g={g} page={page} ap={rec} />;
  if (isNavaid(rec)) return <NavaidPage g={g} page={page} n={rec} />;
  return <NotAvailable title="No information for this waypoint" />;
}

export function wptView(g: Gtn, page: WptPage): PageView {
  return {
    title: TITLES[page.category],
    body: <WptBody g={g} page={page} />,
    controls: {},
    knob: {},
  };
}
