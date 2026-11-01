import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LatLon } from '../../core/geo';
import { useSim, useSimulator } from '../../sim/hooks';
import { useDeviceScale } from '../../ui/DeviceFrame';
import { Screen } from '../../ui/Screen';
import type { DeviceProps } from '../types';
import { GnsBezel } from './Bezel';
import './gns.css';
import { LAYOUT } from './layout';
import { advisory } from './model/advisory';
import { nearestKey, nearestLists } from './model/data';
import { currentPage } from './model/pages';
import { powerUp, screenMode, STARTUP_S } from './model/power';
import { departureAirport, destinationAirport } from './model/proc';
import { VLOC_CURSOR_TIMEOUT_S, VOLUME_SHOWN_S } from './model/radios';
import { initialUi, reduce } from './model/reducer';
import type { GnsCtx, GnsInput, GnsUi, Model, NearestCriteria, NearestLists } from './model/types';
import { INITIAL_WATCH, watch } from './model/watch';
import { wptWaypoint } from './model/wpt';
import { GnsScreen } from './screen/GnsScreen';

/*
 * One implementation for both units; the model picks the bezel layout, the
 * LCD size and the few behaviours that differ (VNAV key, 530W map on the
 * default NAV page, no Position page).
 *
 * Every key and knob goes through the pure reducer in model/, which returns
 * the next screen state and the commands for the shared simulator. After
 * every frame model/watch.ts does what the unit does by itself (approach
 * messages, the automatic ILS CDI switch, terrain pop-ups). The unit is dark
 * without avionics power and shows its start-up screen when power returns.
 */

/** Seconds on a monotonic wall clock, for UI timeouts that should not depend on the sim rate. */
const wallSeconds = () => performance.now() / 1000;

/** Nearest airports whose procedure files are fetched for the NRST APT page's APR column. */
const NRST_PROC_PRELOAD = 12;

export function GnsUnit({ panel, model }: DeviceProps & { model: Model }) {
  const { state, derived, db, mag, terrain, airspace, procedures } = useSim();
  const simulator = useSimulator();
  const deviceScale = useDeviceScale();
  const [ui, setUi] = useState(() => initialUi(model));
  const uiRef = useRef(ui);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  const apply = useCallback((next: GnsUi) => {
    if (next === uiRef.current) return;
    uiRef.current = next;
    setUi(next);
  }, []);

  // Nearest lists are recomputed only after about a mile of movement or a criteria change.
  const nearestCache = useRef<{ key: string; lists: NearestLists } | null>(null);
  const nearest = useCallback(
    (pos: LatLon, criteria: NearestCriteria): NearestLists => {
      const key = nearestKey(pos, criteria);
      if (nearestCache.current?.key !== key) nearestCache.current = { key, lists: nearestLists(simulator.db, pos, criteria) };
      return nearestCache.current.lists;
    },
    [simulator],
  );

  const memo = useRef(INITIAL_WATCH);

  // Power: when it last came on (null: on since the page loaded, no start-up screen).
  const power = useRef<{ on: boolean; at: number | null }>({ on: derived.systems.electrical.avionicsPowered, at: null });
  const modeNow = useCallback(() => {
    const on = simulator.getDerived().systems.electrical.avionicsPowered;
    const p = power.current;
    // Power just came back and the effect below hasn't seen it yet: starting up.
    return screenMode(on, p.on === on ? p.at : wallSeconds(), wallSeconds());
  }, [simulator]);
  const powered = derived.systems.electrical.avionicsPowered;
  useEffect(() => {
    if (power.current.on === powered) return;
    power.current = { on: powered, at: powered ? wallSeconds() : null };
    if (powered) apply(powerUp(uiRef.current));
    memo.current = INITIAL_WATCH;
    rerender();
  }, [powered, apply, rerender]);
  const mode = modeNow();
  useEffect(() => {
    const at = power.current.at;
    if (mode !== 'startup' || at === null) return;
    const t = window.setTimeout(rerender, Math.max(at + STARTUP_S - wallSeconds(), 0) * 1000 + 50);
    return () => window.clearTimeout(t);
  }, [mode, rerender]);

  const ctxNow = useCallback((): GnsCtx => {
    const s = simulator.getState();
    return {
      state: s,
      db: simulator.db,
      mag: simulator.mag,
      nearest: nearest(s.aircraft, uiRef.current.aux.criteria),
      cdiSources: panelRef.current.cdiSources,
      procedures: simulator.procedures,
      now: wallSeconds(),
    };
  }, [simulator, nearest]);

  // Stable for the memoized bezel; reads the newest state when a control is used. Nothing works without power.
  const send = useCallback(
    (input: GnsInput) => {
      if (modeNow() !== 'on') return;
      const r = reduce(uiRef.current, input, ctxNow());
      apply(r.ui);
      for (const c of r.cmds) simulator.dispatch(c);
    },
    [simulator, modeNow, ctxNow, apply],
  );

  // What the unit does by itself, after every frame.
  useEffect(() => {
    if (modeNow() !== 'on') return;
    const c = ctxNow();
    const r = watch(memo.current, uiRef.current, { ...c, derived: simulator.getDerived() });
    memo.current = r.memo;
    apply(r.ui);
    for (const cmd of r.cmds) simulator.dispatch(cmd);
  });

  // Procedure files load on demand: the destination's and departure's, the airport on the WPT pages, nearby airports on NRST APT.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!procedures || mode === 'off') return;
    const c = ctxNow();
    const wanted = [destinationAirport(c)?.ident, departureAirport(c)?.ident, wptWaypoint(uiRef.current, c, 'airport')?.ident];
    if (currentPage(uiRef.current) === 'nrst.apt') wanted.push(...c.nearest.airports.slice(0, NRST_PROC_PRELOAD).map((a) => a.ident));
    for (const ident of wanted) {
      if (!ident || requested.current.has(ident) || !procedures.has(ident)) continue;
      requested.current.add(ident);
      procedures.load(ident).catch(() => requested.current.delete(ident));
    }
  });
  useEffect(() => procedures?.subscribe(rerender), [procedures, rerender]);

  // Timeouts that change the picture without a sim frame (the sim may be paused):
  // the volume readout fading and the tuning cursor returning to COM.
  useEffect(() => {
    const now = wallSeconds();
    const due: number[] = [];
    const shown = ui.radio.volumeShown;
    if (shown) due.push(shown.at + VOLUME_SHOWN_S - now);
    if (ui.radio.tuning === 'VLOC') due.push(ui.radio.tunedAt + VLOC_CURSOR_TIMEOUT_S - now);
    const next = due.filter((d) => d > 0);
    if (next.length === 0) return;
    const t = window.setTimeout(rerender, Math.min(...next) * 1000 + 50);
    return () => window.clearTimeout(t);
  }, [ui.radio, rerender]);

  const L = LAYOUT[model];
  const lcd = L.lcd;
  return (
    <div class="gns-unit">
      <GnsBezel model={model} send={send} />
      <Screen x={lcd.x} y={lcd.y} w={lcd.w * lcd.scale} h={lcd.h * lcd.scale} class="gns-glass" radius={2}>
        <GnsScreen
          ui={ui}
          state={state}
          derived={derived}
          db={db}
          mag={mag}
          nearest={nearest(state.aircraft, ui.aux.criteria)}
          procedures={procedures}
          terrain={terrain}
          airspace={airspace}
          lcd={lcd}
          deviceScale={deviceScale}
          now={wallSeconds()}
          advisory={advisory(derived.gps, state.fms, state.aircraft.groundSpeedKt, state.aircraft.trackTrue, mag)}
          mode={mode}
        />
      </Screen>
    </div>
  );
}
