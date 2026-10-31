import type { JSX } from 'preact';
import { DeviceScaleContext } from '../../../ui/DeviceFrame';
import type { Lcd } from '../layout';
import { currentPage } from '../model/pages';
import type { PageId } from '../model/types';
import { AnnunRow } from './AnnunRow';
import { FreqColumn } from './FreqColumn';
import { at, type PageProps } from './kit';
import { ActiveFplPage, FplCatalogPage } from './pages/FplPages';
import { DtoPage } from './pages/DtoPage';
import { NavcomPage, PositionPage, SatellitePage, TerrainPage } from './pages/NavInfoPages';
import { DefaultNav430, DefaultNav530, MapPage } from './pages/NavPages';
import { NrstAirportPage, NrstMissingPage, NrstNavaidPage } from './pages/NrstPages';
import { AuxPageView, MsgPage, ProcPage, VnavPage } from './pages/OtherPages';
import { AirportFrequencyPage, AirportLocationPage, AirportProcedurePage, AirportRunwayPage, MissingWaypointPage, NavaidPage } from './pages/WptPages';
import { PopupLayer } from './Popups';

/*
 * The LCD: frequency column, the page area and the annunciator row, laid out
 * in LCD pixels and scaled onto the glass. Canvases inside get the combined
 * scale so the map stays sharp.
 */

type PageView = (p: PageProps) => JSX.Element;

const PAGE_VIEWS: Record<PageId, PageView> = {
  'nav.default': (p) => (p.ui.model === '530' ? <DefaultNav530 {...p} /> : <DefaultNav430 {...p} />),
  'nav.map': MapPage,
  'nav.terrain': TerrainPage,
  'nav.navcom': NavcomPage,
  'nav.position': PositionPage,
  'nav.satellite': SatellitePage,
  'nav.vnav': VnavPage,
  vnav: VnavPage,
  'wpt.apt': AirportLocationPage,
  'wpt.rwy': AirportRunwayPage,
  'wpt.freq': AirportFrequencyPage,
  'wpt.apr': (p) => <AirportProcedurePage {...p} page="wpt.apr" />,
  'wpt.arvl': (p) => <AirportProcedurePage {...p} page="wpt.arvl" />,
  'wpt.dep': (p) => <AirportProcedurePage {...p} page="wpt.dep" />,
  'wpt.int': (p) => <MissingWaypointPage {...p} page="wpt.int" />,
  'wpt.usr': (p) => <MissingWaypointPage {...p} page="wpt.usr" />,
  'wpt.vor': (p) => <NavaidPage {...p} kind="vor" />,
  'wpt.ndb': (p) => <NavaidPage {...p} kind="ndb" />,
  'aux.fplan': (p) => <AuxPageView {...p} page="aux.fplan" />,
  'aux.util': (p) => <AuxPageView {...p} page="aux.util" />,
  'aux.setup1': (p) => <AuxPageView {...p} page="aux.setup1" />,
  'aux.setup2': (p) => <AuxPageView {...p} page="aux.setup2" />,
  'nrst.apt': NrstAirportPage,
  'nrst.vor': (p) => <NrstNavaidPage {...p} kind="vor" />,
  'nrst.ndb': (p) => <NrstNavaidPage {...p} kind="ndb" />,
  'nrst.int': (p) => <NrstMissingPage {...p} page="nrst.int" />,
  'nrst.usr': (p) => <NrstMissingPage {...p} page="nrst.usr" />,
  'nrst.artcc': (p) => <NrstMissingPage {...p} page="nrst.artcc" />,
  'nrst.fss': (p) => <NrstMissingPage {...p} page="nrst.fss" />,
  'nrst.asp': (p) => <NrstMissingPage {...p} page="nrst.asp" />,
  'fpl.active': ActiveFplPage,
  'fpl.catalog': FplCatalogPage,
  proc: ProcPage,
  dto: DtoPage,
  msg: MsgPage,
};

/** Pages drawn on black rather than the blue page background. */
const BLACK: ReadonlySet<PageId> = new Set<PageId>(['nav.map', 'nav.terrain']);

export function GnsScreen(
  props: Omit<PageProps, 'pixelScale'> & {
    lcd: Lcd;
    deviceScale: number;
    now: number;
    advisory: string | null;
  },
) {
  const { ui, lcd, state, derived, deviceScale, now, advisory } = props;
  const page = currentPage(ui);
  const pixelScale = deviceScale * lcd.scale;
  const pageProps: PageProps = { ...props, pixelScale };
  const black = BLACK.has(page) || (page === 'nav.default' && ui.model === '530');
  const source = state.nav.cdiSource;
  return (
    <div class={`gns-lcd gns-lcd-${ui.model}`} style={{ width: `${lcd.w}px`, height: `${lcd.h}px`, transform: `scale(${lcd.scale})` }}>
      <DeviceScaleContext.Provider value={pixelScale}>
        <FreqColumn ui={ui} state={state} derived={derived} lcd={lcd} now={now} />
        <div class={`gns-main${black ? ' is-black' : ''}`} style={at(lcd.main.x, lcd.main.y, lcd.main.w, lcd.main.h)} data-page={page}>
          {PAGE_VIEWS[page](pageProps)}
          {ui.popup && <PopupLayer ui={ui} popup={ui.popup} main={lcd.main} state={state} />}
        </div>
        <AnnunRow
          ui={ui}
          lcd={lcd}
          cdi={source === 'GPS' ? 'GPS' : source === 'NAV1' ? 'VLOC' : ''}
          obs={state.fms.obsMode}
          unread={derived.unreadMessages > 0}
          advisory={advisory}
        />
      </DeviceScaleContext.Provider>
    </div>
  );
}
