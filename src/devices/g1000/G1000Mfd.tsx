import { useRef, useState } from 'preact/hooks';
import type { Airport, Navaid } from '../../core/navdb';
import { planLegs } from '../../sim/fms';
import { useSim, useSimulator } from '../../sim/hooks';
import type { DeviceProps } from '../types';
import { GduBezel, useLiveActions } from './bezel/GduBezel';
import { Eis } from './mfd/Eis';
import { CONFIRM_RECT, MENU_RECT, MFD_FPL_ROWS, PAGE, PANEL } from './mfd/layout';
import { MFD_ORIENTATION, mfdPageView } from './mfd/pageData';
import { mfdControls } from './mfd/mfdControls';
import { NavDataBar, PageGroups, PageTitle } from './mfd/MfdChrome';
import { pageTitle, pickerVisible } from './mfd/mfdPages';
import { fuelRemaining, fuelUsed, mfdSoftkeys } from './mfd/mfdSoftkeys';
import { mfdCursorActive, mfdUiStart, type MfdUi } from './mfd/mfdState';
import { GpsStatusPage, SystemStatusPage, TripPlanningPage } from './mfd/pages/AuxPages';
import { ActiveFplPage, ChecklistPage, NoStoredPlansPage } from './mfd/pages/FplPages';
import { NavMapPage, RingsPage, type MapBase } from './mfd/pages/MapPages';
import { NearestAirportsPage, NearestFrequenciesPage, NearestNavaidsPage } from './mfd/pages/NrstPages';
import { AirportInfoPage, NavaidInfoPage, NoDataPage } from './mfd/pages/WptPages';
import { DirectToColumn } from './screen/DirectToPanel';
import { ConfirmWindow, MenuWindow } from './screen/Frames';
import { pointerVector } from './screen/MapView';
import { NativeScreen } from './screen/NativeScreen';
import { ProcWindow } from './screen/ProcWindow';
import { SoftkeyBar, softkeyNames } from './screen/SoftkeyBar';
import { TopBar } from './screen/TopBar';
import { directToIdent } from './shared/directTo';
import { directToLists, NO_LISTS } from './shared/dtoLists';
import { fplClamp, scrollToShow } from './shared/flightPlan';
import { planComment } from './shared/fplActions';
import { bearingDistance } from './shared/geo';
import { blinkPhase } from './shared/hooks';
import { nearestAirports } from './shared/nearest';
import { useShared } from './shared/store';
import './g1000.css';

/*
 * G1000 MFD (GDU 1040, or 1044B with the GFC 700 keys): the same radios as
 * the PFD across the top with the navigation data bar and page title, the
 * engine strip on the left, and the page groups (MAP, WPT, AUX, FPL,
 * CHKLIST, NRST) selected with the FMS knob, plus the Direct-to and
 * Procedures panels.
 */

/** Tach time at the start of the session; it runs on simulator time after that. */
const ENGINE_HOURS_START = 1874.3;

export function G1000Mfd({ panel }: DeviceProps) {
  const { state, derived, dispatch, db, mag } = useSim();
  const sim = useSimulator();
  const shared = useShared();
  const tanks = state.aircraft.engine.fuelGal[0] + state.aircraft.engine.fuelGal[1];
  const [ui, setUiState] = useState<MfdUi>(() => mfdUiStart(tanks));
  const latest = useRef(ui);
  latest.current = ui;
  const setUi = (fn: (u: MfdUi) => MfdUi) => setUiState((u) => (latest.current = fn(u)));

  const now = performance.now();
  const a = state.aircraft;
  const pos = { lat: a.lat, lon: a.lon };

  const base: MapBase = {
    db,
    ownship: { lat: a.lat, lon: a.lon, headingTrue: a.headingTrue, trackTrue: a.trackTrue },
    orientation: MFD_ORIENTATION,
    plan: state.fms.plan,
    activeLeg: state.fms.activeLeg,
    planRevision: state.fms.revision,
    settings: ui.keys.map,
    rangeNm: ui.rangeNm,
  };

  const view = mfdPageView(state, derived, ui, db, mag);
  const { page, wpt, nearestRows, navaidRows, freqGroups, pointerWp } = view;
  const softkeys = mfdSoftkeys(ui.keys, page);

  // Controls resolve against the simulator and screen state at the moment they are used.
  const actions = useLiveActions(() => {
    const s = sim.getState();
    const d = sim.getDerived();
    const u = latest.current;
    const here = { lat: s.aircraft.lat, lon: s.aircraft.lon };
    return mfdControls({
      state: s,
      derived: d,
      dispatch,
      db,
      ui: u,
      setUi,
      data: mfdPageView(s, d, u, db, mag).data,
      dtoLists: u.dto ? directToLists(s.fms.plan, db, here) : NO_LISTS,
    });
  });

  const fplCursor = fplClamp(ui.fpl.cursor, state.fms.plan.length);
  const dto = ui.dto;
  const dtoWp = dto ? db.get(directToIdent(dto.dto), pos) : undefined;
  const dtoBrg = dtoWp ? bearingDistance(pos, dtoWp, mag) : null;
  // Pointer readout: to the waypoint under it, else to the pointer position itself.
  const pointerBrg = !ui.pointer
    ? null
    : pointerWp
      ? bearingDistance(pos, pointerWp, mag)
      : (() => {
          const v = pointerVector({ ...base, h: PAGE.h }, ui.pointer);
          return { bearingMag: mag.toMagnetic(v.bearingTrue, a.lat, a.lon), distanceNm: v.distanceNm };
        })();
  const nearestAirportOfWpt =
    (page === 'vorInfo' || page === 'ndbInfo') && wpt
      ? (() => {
          const n = nearestAirports(db, wpt, 1)[0];
          return n ? { ident: n.item.ident, ...bearingDistance(wpt, n.item, mag) } : null;
        })()
      : null;

  return (
    <div class="g1000-device">
      <GduBezel
        unit="g1000-mfd"
        afcs={panel.ap === 'integrated'}
        actions={actions}
        softkeyNames={softkeyNames(softkeys)}
        fmsUse={mfdCursorActive(ui) ? 'cursor' : 'pages'}
      />
      <NativeScreen label="G1000 multi-function display">
        {page === 'navMap' && (
          <NavMapPage
            base={base}
            pointer={ui.pointer}
            pointerInfo={ui.pointer ? { target: pointerWp, bearingMag: pointerBrg?.bearingMag ?? null, distanceNm: pointerBrg?.distanceNm ?? null } : null}
            altitudeFt={derived.indicatedAltitudeFt}
            selectedFt={state.bugs.altitudeFt}
          />
        )}
        {page === 'trafficMap' && <RingsPage kind="traffic" rangeNm={ui.rangeNm} headingUp={derived.headingMag} />}
        {page === 'terrain' && <RingsPage kind="terrain" rangeNm={ui.rangeNm} headingUp={derived.headingMag} />}
        {page === 'airportInfo' && (
          <AirportInfoPage base={{ ...base, rangeNm: ui.infoRangeNm }} airport={wpt as Airport | undefined} wpt={ui.wpt} directory={ui.keys.airportInfo2} />
        )}
        {(page === 'vorInfo' || page === 'ndbInfo') && (
          <NavaidInfoPage base={{ ...base, rangeNm: ui.infoRangeNm }} navaid={wpt as Navaid | undefined} wpt={ui.wpt} nearestAirport={nearestAirportOfWpt} />
        )}
        {page === 'intersectionInfo' && <NoDataPage base={base} title="INTERSECTION" message="No intersections (fixes) in the trainer database." />}
        {page === 'userWptInfo' && <NoDataPage base={base} title="USER WAYPOINT" message="No user waypoints are stored in the trainer." />}
        {page === 'tripPlanning' && (
          <TripPlanningPage
            t={{
              from: 'P.POS',
              to: derived.gps.destination?.ident ?? '_____',
              dtkMag: derived.gps.destination ? bearingDistance(pos, derived.gps.destination, mag).bearingMag : null,
              distanceNm: derived.gps.destinationNm,
              eteSec: derived.gps.destinationEteSec,
              groundSpeedKt: a.groundSpeedKt,
              fuelFlowGph: a.engine.fuelFlowGph,
              fuelOnboardGal: fuelRemaining(ui.keys.fuel, tanks),
              iasKt: a.iasKt,
              tasKt: a.tasKt,
              indicatedAltFt: derived.indicatedAltitudeFt,
              baroInHg: state.bugs.baroInHg,
              oatC: derived.oatC,
              densityAltFt: derived.densityAltitudeFt,
              now: new Date(),
            }}
          />
        )}
        {page === 'gpsStatus' && (
          <GpsStatusPage g={{ lat: a.lat, lon: a.lon, altitudeFt: a.altitudeFt, groundSpeedKt: a.groundSpeedKt, trackMag: derived.trackMag, time: state.time }} />
        )}
        {page === 'systemStatus' && <SystemStatusPage afcs={panel.ap === 'integrated'} databaseBuilt={db.built} />}
        {page === 'activeFpl' && (
          <ActiveFplPage
            base={base}
            legs={planLegs(state.fms, pos, mag)}
            activeLeg={state.fms.activeLeg}
            cursor={fplCursor}
            scroll={scrollToShow(ui.fpl.scroll, fplCursor.index, MFD_FPL_ROWS, state.fms.plan.length + 1 + (fplCursor.entry ? 1 : 0))}
            comment={planComment(state.fms.plan)}
            wide={ui.keys.fplWide}
          />
        )}
        {page === 'fplCatalog' && <NoStoredPlansPage base={base} />}
        {page === 'checklist' && <ChecklistPage c={ui.checklist} />}
        {page === 'nrstAirports' && <NearestAirportsPage base={base} rows={nearestRows} n={ui.nrst} />}
        {(page === 'nrstVor' || page === 'nrstNdb') && (
          <NearestNavaidsPage base={base} rows={navaidRows} n={ui.nrst} kind={page === 'nrstVor' ? 'vor' : 'ndb'} />
        )}
        {page === 'nrstFreq' && <NearestFrequenciesPage base={base} groups={freqGroups} n={ui.nrst} />}
        {page === 'nrstIntersections' && <NoDataPage base={base} title="NEAREST INTERSECTIONS" message="No intersections (fixes) in the trainer database." />}
        {page === 'nrstUser' && <NoDataPage base={base} title="NEAREST USER WAYPOINTS" message="NONE WITHIN 200NM: no user waypoints are stored in the trainer." />}
        {page === 'nrstAirspaces' && <NoDataPage base={base} title="NEAREST AIRSPACES" message="No airspace data in the trainer database." />}
        {page === 'procedures' && (
          <>
            <NavMapPage base={base} pointer={null} pointerInfo={null} altitudeFt={derived.indicatedAltitudeFt} selectedFt={state.bugs.altitudeFt} />
            <ProcWindow proc={ui.proc} airport={state.fms.plan[state.fms.plan.length - 1] ?? derived.gps.to} rect={{ ...PANEL, h: 420 }} />
          </>
        )}

        <Eis
          page={ui.keys.eis}
          engine={a.engine}
          altitudeFt={a.altitudeFt}
          engineHours={ENGINE_HOURS_START + state.time / 3600}
          cylinder={ui.keys.cylinder}
          fuelRemGal={fuelRemaining(ui.keys.fuel, tanks)}
          fuelUsedGal={fuelUsed(ui.keys.fuel, tanks)}
        />
        <TopBar
          radios={state.radios}
          panel={shared.radio}
          cdiSource={state.nav.cdiSource}
          navIdents={[derived.vor[0].station?.ident ?? null, derived.vor[1].station?.ident ?? null]}
          now={now}
        >
          <NavDataBar gps={derived.gps} groundSpeedKt={a.groundSpeedKt} trackMag={derived.trackMag} />
          <PageTitle title={pageTitle(ui.pages)} />
        </TopBar>
        {dto && (
          <DirectToColumn
            v={{
              state: dto.dto,
              lists: dto.dto.list ? directToLists(state.fms.plan, db, pos) : NO_LISTS,
              waypoint: dtoWp,
              bearingMag: dtoBrg?.bearingMag ?? null,
              distanceNm: dtoBrg?.distanceNm ?? null,
            }}
            rect={PANEL}
          />
        )}
        {ui.popup?.kind === 'menu' && <MenuWindow menu={ui.popup.menu} rect={{ ...MENU_RECT, h: 74 + Math.max(ui.popup.menu.items.length, 1) * 24 }} />}
        {ui.popup?.kind === 'confirm' && <ConfirmWindow confirm={ui.popup.confirm} rect={CONFIRM_RECT} />}
        <PageGroups pages={ui.pages} picking={pickerVisible(ui.pages, now)} />
        <SoftkeyBar keys={softkeys} blink={blinkPhase(now)} />
      </NativeScreen>
    </div>
  );
}

export default G1000Mfd;
