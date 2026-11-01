import type { JSX } from 'preact';
import { DeviceScaleContext } from '../../../ui/DeviceFrame';
import type { Lcd } from '../layout';
import { annunciations } from '../model/annunciations';
import { currentPage } from '../model/pages';
import type { screenMode } from '../model/power';
import type { PageId } from '../model/types';
import { AnnunRow } from './AnnunRow';
import { FreqColumn } from './FreqColumn';
import { at, T, type PageProps } from './kit';
import { ActiveFplPage, FplCatalogPage } from './pages/FplPages';
import { DtoPage } from './pages/DtoPage';
import { NavcomPage, PositionPage, SatellitePage } from './pages/NavInfoPages';
import { DefaultNav430, DefaultNav530, MapPage } from './pages/NavPages';
import { NrstAirportPage, NrstIntersectionPage, NrstMissingPage, NrstNavaidPage } from './pages/NrstPages';
import { AuxPageView, MsgPage, ProcPage, VnavPage } from './pages/OtherPages';
import { TerrainPage } from './pages/TerrainPage';
import { AirportFrequencyPage, AirportLocationPage, AirportProcedurePage, AirportRunwayPage, IntersectionPage, MissingWaypointPage, NavaidPage } from './pages/WptPages';
import { PopupLayer } from './Popups';

/*
 * The LCD: frequency column, the page area and the annunciator row, laid out
 * in LCD pixels and scaled onto the glass. Canvases inside get the combined
 * scale so the map stays sharp. Without power the glass is dark; when power
 * returns the start-up screen shows for a few seconds.
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
  'wpt.apr': (p) => <AirportProcedurePage {...p} kind="approach" />,
  'wpt.arvl': (p) => <AirportProcedurePage {...p} kind="arrival" />,
  'wpt.dep': (p) => <AirportProcedurePage {...p} kind="departure" />,
  'wpt.int': IntersectionPage,
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
  'nrst.int': NrstIntersectionPage,
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

/** The start-up screen: the Garmin name and the unit. */
function Startup({ lcd, model }: { lcd: Lcd; model: PageProps['ui']['model'] }) {
  const big = model === '530';
  const size = big ? 34 : 22;
  return (
    <div class="gns-startup" style={at(0, 0, lcd.w, lcd.h)}>
      <T x={0} y={lcd.h * 0.33} w={lcd.w} size={size} color="white" align="center" bold>
        GARMIN
      </T>
      <T x={0} y={lcd.h * 0.33 + size * 1.35} w={lcd.w} size={size * 0.42} color="cyan" align="center">
        {big ? 'GNS 530W' : 'GNS 430W'}
      </T>
      <T x={0} y={lcd.h * 0.33 + size * 2.05} w={lcd.w} size={size * 0.34} color="white" align="center">
        Self test in progress
      </T>
    </div>
  );
}

export function GnsScreen(
  props: Omit<PageProps, 'pixelScale'> & {
    lcd: Lcd;
    deviceScale: number;
    now: number;
    advisory: string | null;
    mode: ReturnType<typeof screenMode>;
  },
) {
  const { ui, lcd, state, derived, deviceScale, now, advisory, mode } = props;
  if (mode === 'off') return <div class="gns-lcd gns-lcd-off" style={{ width: `${lcd.w}px`, height: `${lcd.h}px`, transform: `scale(${lcd.scale})` }} aria-label="Unit off" />;
  const pixelScale = deviceScale * lcd.scale;
  if (mode === 'startup') {
    return (
      <div class={`gns-lcd gns-lcd-${ui.model}`} style={{ width: `${lcd.w}px`, height: `${lcd.h}px`, transform: `scale(${lcd.scale})` }}>
        <Startup lcd={lcd} model={ui.model} />
      </div>
    );
  }
  const page = currentPage(ui);
  const pageProps: PageProps = { ...props, pixelScale };
  const black = BLACK.has(page) || (page === 'nav.default' && ui.model === '530');
  const annun = annunciations(ui, state, derived);
  return (
    <div class={`gns-lcd gns-lcd-${ui.model}`} style={{ width: `${lcd.w}px`, height: `${lcd.h}px`, transform: `scale(${lcd.scale})` }}>
      <DeviceScaleContext.Provider value={pixelScale}>
        <FreqColumn ui={ui} state={state} derived={derived} lcd={lcd} now={now} annun={annun} />
        <div class={`gns-main${black ? ' is-black' : ''}`} style={at(lcd.main.x, lcd.main.y, lcd.main.w, lcd.main.h)} data-page={page}>
          {PAGE_VIEWS[page](pageProps)}
          {ui.popup && <PopupLayer ui={ui} popup={ui.popup} main={lcd.main} state={state} procedures={props.procedures} />}
        </div>
        <AnnunRow ui={ui} lcd={lcd} annun={annun} advisory={advisory} />
      </DeviceScaleContext.Provider>
    </div>
  );
}
