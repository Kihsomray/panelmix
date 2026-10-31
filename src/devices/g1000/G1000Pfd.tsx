import { useEffect, useRef, useState } from 'preact/hooks';
import { useSim, useSimulator } from '../../sim/hooks';
import { planLegs } from '../../sim/fms';
import { vorSolution } from '../../sim/radionav';
import type { DeviceProps } from '../types';
import { GduBezel, useLiveActions } from './bezel/GduBezel';
import { Adi } from './pfd/Adi';
import { HsiPanel, type BearingInfo } from './pfd/HsiPanel';
import { INSET_RECT, InsetMap } from './pfd/InsetMap';
import { dmeKhz, insetMapView, pfdControls, pfdKeyContext } from './pfd/pfdControls';
import { bearingChoice, endCodeEntry, pfdSoftkeys } from './pfd/pfdSoftkeys';
import { PFD_UI_START, type PfdUi } from './pfd/pfdState';
import {
  AlertsWindow,
  DmeTuneWindow,
  FplWindow,
  NearestWindow,
  PFD_PROC_WINDOW,
  PFD_TALL_WINDOW,
  PFD_WINDOW,
  TimerRefWindowView,
} from './pfd/PfdWindows';
import { AfcsBox, NavStatus, OatBox, XpdrBox } from './pfd/StatusBars';
import { DirectToWindow } from './screen/DirectToPanel';
import { ConfirmWindow, MenuWindow } from './screen/Frames';
import { pointerTarget } from './screen/MapView';
import { NativeScreen } from './screen/NativeScreen';
import { ProcWindow } from './screen/ProcWindow';
import { SoftkeyBar, softkeyNames } from './screen/SoftkeyBar';
import { TopBar } from './screen/TopBar';
import { afcsAnnunciation } from './shared/afcs';
import { directToIdent } from './shared/directTo';
import { directToLists, NO_LISTS } from './shared/dtoLists';
import { fplClamp, scrollToShow } from './shared/flightPlan';
import { bearingDistance } from './shared/geo';
import { planComment } from './shared/fplActions';
import { blinkPhase, localClock, useAfcsEvents, useRate } from './shared/hooks';
import { nearestAirports } from './shared/nearest';
import { useShared } from './shared/store';
import { codeComplete, codeDisplay, CODE_COMMIT_MS, CODE_IDLE_MS } from './shared/xpdrCode';
import './g1000.css';

/*
 * G1000 PFD (GDU 1040, or 1044B with the GFC 700 keys). The screen follows
 * the Cessna Nav III PFD: frequency boxes and status boxes across the top,
 * full-width attitude with airspeed and altitude tapes, HSI, inset map,
 * OAT and transponder boxes, and the softkeys. Windows (NRST, TMR/REF,
 * ALERTS, DME, D->, FPL, PROC) open in the lower right corner.
 */

export function G1000Pfd({ panel }: DeviceProps) {
  const { state, derived, dispatch, db, mag } = useSim();
  const sim = useSimulator();
  const shared = useShared();
  const [ui, setUiState] = useState<PfdUi>(PFD_UI_START);
  const latest = useRef(ui);
  latest.current = ui;
  const setUi = (fn: (u: PfdUi) => PfdUi) => setUiState((u) => (latest.current = fn(u)));

  const now = performance.now();
  const a = state.aircraft;
  const pos = { lat: a.lat, lon: a.lon };
  const hasAfcs = panel.ap === 'integrated';
  const settings = ui.keys.settings;
  const unread = state.messages.filter((m) => !m.read);
  const keyContext = pfdKeyContext(state, panel, now);
  const softkeys = pfdSoftkeys(ui.keys, keyContext);

  const nrstOpen = ui.window?.kind === 'nrst';
  const nearest = nrstOpen ? nearestAirports(db, pos) : [];

  // Controls resolve against the simulator and screen state at the moment they are used.
  const actions = useLiveActions(() => {
    const s = sim.getState();
    const u = latest.current;
    const here = { lat: s.aircraft.lat, lon: s.aircraft.lon };
    return pfdControls({
      state: s,
      derived: sim.getDerived(),
      dispatch,
      db,
      panel,
      ui: u,
      setUi,
      keyContext: pfdKeyContext(s, panel, performance.now()),
      nearestIdents: u.window?.kind === 'nrst' ? nearestAirports(db, here).map((n) => n.item.ident) : [],
      dtoLists: u.window?.kind === 'dto' ? directToLists(s.fms.plan, db, here) : NO_LISTS,
    });
  });

  // Transponder code entry: commit five seconds after the fourth digit, abandon after ten idle seconds.
  const code = ui.keys.code;
  useEffect(() => {
    if (!code) return;
    const due = code.at + (codeComplete(code) ? CODE_COMMIT_MS : CODE_IDLE_MS) - performance.now();
    const t = window.setTimeout(() => {
      if (latest.current.keys.code !== code) return;
      if (codeComplete(code)) dispatch({ type: 'xpdr.code', code: code.digits });
      setUi((u) => ({ ...u, keys: endCodeEntry(u.keys) }));
    }, Math.max(due, 0));
    return () => window.clearTimeout(t);
  }, [code]);

  const iasRate = useRate(a.iasKt, state.time);
  const events = useAfcsEvents(state.ap, now);
  const blink = blinkPhase(now);
  const cdi = derived.cdi;
  const flash = shared.afcsFlash && now < shared.afcsFlash.until ? shared.afcsFlash.mode : null;

  const bearing = (pointer: 1 | 2): BearingInfo => {
    const choice = bearingChoice(pointer, pointer === 1 ? state.nav.bearing1 : state.nav.bearing2, settings);
    const solution = pointer === 1 ? derived.bearing1 : derived.bearing2;
    const khz = choice === 'NAV1' ? state.radios.nav[0].activeKhz : choice === 'NAV2' ? state.radios.nav[1].activeKhz : null;
    return { choice, solution, khz };
  };

  const dme = (() => {
    if (!settings.dmeWindow) return null;
    const khz = dmeKhz({ state, ui });
    const source = ui.dme.source;
    const solution =
      source === 'HOLD'
        ? khz !== null
          ? vorSolution(db, khz, pos, a.altitudeFt, 0)
          : null
        : derived.vor[source === 'NAV1' ? 0 : 1];
    return { source, khz, nm: solution?.dmeNm ?? null };
  })();

  const minimumsFt = state.bugs.minimumsFt;
  const baroText = state.bugs.baroStd
    ? 'STD BARO'
    : settings.baroHpa
      ? `${Math.round(state.bugs.baroInHg * 33.8639)}HPA`
      : `${state.bugs.baroInHg.toFixed(2)}IN`;

  const insetView = insetMapView({ state, ui });
  const pointerWp = ui.pointer && settings.inset ? pointerTarget(db, { ...insetView, w: INSET_RECT.w, h: INSET_RECT.h }, ui.pointer) : null;

  const w = ui.window;
  const legs = w?.kind === 'fpl' ? planLegs(state.fms, pos, mag) : [];

  return (
    <div class="g1000-device">
      <GduBezel
        unit="g1000-pfd"
        afcs={hasAfcs}
        actions={actions}
        softkeyNames={softkeyNames(softkeys)}
        fmsUse={ui.window || ui.popup || ui.keys.menu === 'code' ? 'cursor' : 'idle'}
      />
      <NativeScreen label="G1000 primary flight display">
        <Adi
          pitchDeg={a.pitchDeg}
          bankDeg={a.bankDeg}
          slip={a.slip}
          iasKt={a.iasKt}
          iasTrendKt={a.iasKt + iasRate * 6}
          tasKt={a.tasKt}
          gsKt={a.groundSpeedKt}
          altitudeFt={derived.indicatedAltitudeFt}
          vsFpm={a.verticalSpeedFpm}
          selectedAltFt={state.bugs.altitudeFt}
          baroText={baroText}
          baroStd={state.bugs.baroStd}
          flcKt={hasAfcs && state.ap.vertical === 'IAS' && (state.ap.engaged || state.ap.flightDirector) ? state.bugs.airspeedKt : null}
          vsBugFpm={hasAfcs && state.ap.vertical === 'VS' && (state.ap.engaged || state.ap.flightDirector) ? state.bugs.verticalSpeedFpm : null}
          minimumsFt={minimumsFt}
          flightDirector={hasAfcs ? derived.flightDirector : null}
          vspeeds={ui.refs.vspeeds}
          metric={settings.altMeters}
        />
        {settings.inset && (
          <InsetMap
            db={db}
            ownship={insetView.ownship}
            rangeNm={ui.insetRangeNm}
            orientation={insetView.orientation}
            plan={state.fms.plan}
            activeLeg={state.fms.activeLeg}
            planRevision={state.fms.revision}
            declutter={settings.insetDeclutter}
            topo={settings.insetTopo}
            traffic={settings.insetTraffic}
            terrain={settings.insetTerrain}
            pointer={ui.pointer}
            pointerLabel={pointerWp?.ident ?? null}
          />
        )}
        <HsiPanel
          arc={settings.hsiArc}
          headingMag={derived.headingMag}
          headingBugMag={state.bugs.headingMag}
          trackMag={a.groundSpeedKt > 30 ? derived.trackMag : null}
          turnRateDps={a.turnRateDps}
          cdi={cdi}
          gpsPhase={derived.gps.active ? derived.gps.scale : null}
          obsMode={state.fms.obsMode}
          bearing1={bearing(1)}
          bearing2={bearing(2)}
          dme={dme}
          wind={{
            option: settings.wind,
            valid: a.iasKt > 30,
            relativeDeg: derived.windRelativeDeg,
            speedKt: state.env.windKt,
            fromTrue: state.env.windFromTrue,
            headwindKt: derived.windComponents.headwindKt,
            crosswindKt: derived.windComponents.crosswindKt,
          }}
          minimumsFt={minimumsFt}
        />
        <TopBar
          radios={state.radios}
          panel={shared.radio}
          cdiSource={state.nav.cdiSource}
          navIdents={[derived.vor[0].station?.ident ?? null, derived.vor[1].station?.ident ?? null]}
          now={now}
        >
          <NavStatus gps={derived.gps} />
          <AfcsBox
            installed={hasAfcs}
            modes={afcsAnnunciation(state.ap, state.bugs, cdi.label, shared.approach)}
            apEngaged={state.ap.engaged}
            apDisconnect={events.apDisconnect}
            flashLateral={events.navCapture}
            flashVertical={events.altCapture}
            unavailable={hasAfcs ? flash : null}
            blink={blink}
          />
        </TopBar>
        {unread.some((m) => m.level === 'caution') && (
          <div class="g1000-annunciations">
            {unread
              .filter((m) => m.level === 'caution')
              .slice(-3)
              .map((m) => (
                <div key={m.id}>{m.text.toUpperCase()}</div>
              ))}
          </div>
        )}
        {w?.kind === 'nrst' && (
          <NearestWindow
            rows={nearest.map((n) => ({ near: n, bearingMag: mag.toMagnetic(n.bearingTrue, a.lat, a.lon) }))}
            cursor={w.cursor}
            scroll={w.scroll}
          />
        )}
        {w?.kind === 'tmrRef' && <TimerRefWindowView w={w.w} refs={ui.refs} simTime={state.time} />}
        {w?.kind === 'alerts' && <AlertsWindow messages={state.messages} scroll={w.scroll} />}
        {w?.kind === 'dme' && (
          <DmeTuneWindow
            choice={w.choice}
            khz={w.choice === 'HOLD' ? dmeKhz({ state, ui }) : state.radios.nav[w.choice === 'NAV1' ? 0 : 1].activeKhz}
          />
        )}
        {w?.kind === 'proc' && (
          <ProcWindow proc={w.proc} airport={state.fms.plan[state.fms.plan.length - 1] ?? derived.gps.to} rect={PFD_PROC_WINDOW} />
        )}
        {w?.kind === 'fpl' && (
          <FplWindow
            legs={legs}
            activeLeg={state.fms.activeLeg}
            cursor={fplClamp(w.cursor, state.fms.plan.length)}
            scroll={scrollToShow(w.scroll, fplClamp(w.cursor, state.fms.plan.length).index, 5, state.fms.plan.length + 2)}
            comment={planComment(state.fms.plan)}
          />
        )}
        {w?.kind === 'dto' &&
          (() => {
            const ident = directToIdent(w.dto);
            const wp = ident ? db.get(ident, pos) : undefined;
            const brg = wp ? bearingDistance(pos, wp, mag) : null;
            return (
              <DirectToWindow
                v={{
                  state: w.dto,
                  lists: w.dto.list ? directToLists(state.fms.plan, db, pos) : NO_LISTS,
                  waypoint: wp,
                  bearingMag: brg?.bearingMag ?? null,
                  distanceNm: brg?.distanceNm ?? null,
                }}
                rect={PFD_TALL_WINDOW}
              />
            );
          })()}
        {ui.popup?.kind === 'menu' && <MenuWindow menu={ui.popup.menu} rect={{ ...PFD_WINDOW, h: 40 + Math.max(ui.popup.menu.items.length, 1) * 24 + 40 }} />}
        {ui.popup?.kind === 'confirm' && <ConfirmWindow confirm={ui.popup.confirm} rect={{ x: 724, y: 560, w: 276, h: 96 }} />}
        <OatBox oatC={derived.oatC} isaDevC={state.env.isaDeviationC} />
        <XpdrBox
          xpdr={state.xpdr}
          simTime={state.time}
          entering={code ? codeDisplay(code) : null}
          reply={Math.floor(now / 1000) % 2 === 0}
          clock={localClock(new Date())}
        />
        <SoftkeyBar keys={softkeys} blink={blink} />
      </NativeScreen>
    </div>
  );
}

export default G1000Pfd;
