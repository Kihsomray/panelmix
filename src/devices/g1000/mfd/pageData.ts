import type { MagneticModel } from '../../../core/magvar';
import type { Airport, AnyWaypoint, Navaid, NavDatabase } from '../../../core/navdb';
import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import { pointerTarget, type MapOrientation } from '../screen/MapView';
import { FREQ_NAMES, nearestAirports, nearestNavaids, type Nearby } from '../shared/nearest';
import { PAGE } from './layout';
import type { MfdPageData } from './mfdControls';
import { pageId, type PageId } from './mfdPages';
import type { MfdUi } from './mfdState';
import type { FreqEntry, NearRow } from './pages/NrstPages';

/*
 * The records and lists the page on screen shows, worked out once for the
 * display and for the knobs (the expensive nearest searches are cached by
 * position in shared/nearest).
 */

export const MFD_ORIENTATION: MapOrientation = 'track';

export interface MfdPageView {
  readonly page: PageId;
  readonly wpt: AnyWaypoint | undefined;
  readonly nearestRows: readonly NearRow<Airport>[];
  readonly navaidRows: readonly NearRow<Navaid>[];
  readonly freqGroups: readonly { readonly title: string; readonly items: readonly FreqEntry[] }[];
  readonly pointerWp: AnyWaypoint | null;
  readonly data: MfdPageData;
}

export function mfdPageView(state: SimState, derived: Derived, ui: MfdUi, db: NavDatabase, mag: MagneticModel): MfdPageView {
  const a = state.aircraft;
  const pos = { lat: a.lat, lon: a.lon };
  const page = pageId(ui.pages);
  const toRows = <T extends Airport | Navaid>(list: readonly Nearby<T>[]): NearRow<T>[] =>
    list.map((n) => ({ item: n.item, distanceNm: n.distanceNm, bearingMag: mag.toMagnetic(n.bearingTrue, a.lat, a.lon) }));

  let wpt: AnyWaypoint | undefined;
  let nearestRows: NearRow<Airport>[] = [];
  let navaidRows: NearRow<Navaid>[] = [];
  let freqGroups: { title: string; items: FreqEntry[] }[] = [];
  if (page === 'airportInfo') {
    const active = derived.gps.to?.kind === 'airport' ? derived.gps.to.ident : null;
    const ident = ui.wpt.idents.airport || active || nearestAirports(db, pos, 1)[0]?.item.ident || '';
    wpt = db.airport(ident);
  } else if (page === 'vorInfo' || page === 'ndbInfo') {
    const kind = page === 'vorInfo' ? 'vor' : 'ndb';
    const ident = ui.wpt.idents[kind] || nearestNavaids(db, pos, kind, 1)[0]?.item.ident || '';
    wpt = db.find(ident).find((w) => w.kind === kind);
  } else if (page === 'nrstAirports') {
    nearestRows = toRows(nearestAirports(db, pos));
  } else if (page === 'nrstVor' || page === 'nrstNdb') {
    navaidRows = toRows(nearestNavaids(db, pos, page === 'nrstVor' ? 'vor' : 'ndb'));
  } else if (page === 'nrstFreq') {
    const airports = nearestAirports(db, pos);
    const pick = (types: readonly string[]): FreqEntry[] =>
      airports
        .flatMap((n) =>
          n.item.frequencies
            .filter((f) => types.includes(f.type))
            .map((f) => ({ ident: n.item.ident, label: FREQ_NAMES[f.type], khz: f.khz, distanceNm: n.distanceNm })),
        )
        .slice(0, 4);
    freqGroups = [
      { title: 'NEAREST ARTCC', items: pick(['CTR']) },
      { title: 'NEAREST FSS', items: pick(['FSS', 'RCO']) },
      { title: 'NEAREST WEATHER', items: pick(['ATIS', 'AWOS', 'ASOS']) },
    ];
  }

  const selectedAirport = nearestRows[ui.nrst.item ?? 0]?.item;
  const selectedNavaid = navaidRows[ui.nrst.item ?? 0]?.item;
  const pointerWp =
    page === 'navMap' && ui.pointer
      ? pointerTarget(
          db,
          {
            ownship: { lat: a.lat, lon: a.lon, headingTrue: a.headingTrue, trackTrue: a.trackTrue },
            orientation: MFD_ORIENTATION,
            rangeNm: ui.rangeNm,
            w: PAGE.w,
            h: PAGE.h,
          },
          ui.pointer,
        )
      : null;

  let freqs: number[] = [];
  if (wpt && 'frequencies' in wpt) freqs = (wpt as Airport).frequencies.map((f) => f.khz);
  else if (wpt && 'freqKhz' in wpt) freqs = [(wpt as Navaid).freqKhz];
  else if (page === 'nrstAirports') freqs = (selectedAirport?.frequencies ?? []).map((f) => f.khz);
  else if (page === 'nrstVor' || page === 'nrstNdb') freqs = selectedNavaid ? [selectedNavaid.freqKhz] : [];
  else if (page === 'nrstFreq') freqs = freqGroups.flatMap((g) => g.items.map((f) => f.khz));

  const runways = wpt && 'runways' in wpt ? (wpt as Airport).runways.length : (selectedAirport?.runways.length ?? 0);

  return {
    page,
    wpt,
    nearestRows,
    navaidRows,
    freqGroups,
    pointerWp,
    data: {
      nearest: page === 'nrstAirports' ? nearestRows.map((r) => r.item) : navaidRows.map((r) => r.item),
      freqs,
      runways,
      wpt,
      pointerTarget: pointerWp,
    },
  };
}
