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
import { VLOC_CURSOR_TIMEOUT_S, VOLUME_SHOWN_S } from './model/radios';
import { initialUi, reduce } from './model/reducer';
import type { GnsCtx, GnsInput, Model, NearestCriteria, NearestLists } from './model/types';
import { GnsScreen } from './screen/GnsScreen';

/*
 * One implementation for both units; the model picks the bezel layout, the
 * LCD size and the few behaviours that differ (VNAV key, 530W map on the
 * default NAV page, no Position page).
 *
 * Every key and knob goes through the pure reducer in model/, which returns
 * the next screen state and the commands for the shared simulator.
 */

/** Seconds on a monotonic wall clock, for UI timeouts that should not depend on the sim rate. */
const wallSeconds = () => performance.now() / 1000;

export function GnsUnit({ panel, model }: DeviceProps & { model: Model }) {
  const { state, derived, db, mag } = useSim();
  const simulator = useSimulator();
  const deviceScale = useDeviceScale();
  const [ui, setUi] = useState(() => initialUi(model));
  const uiRef = useRef(ui);
  const panelRef = useRef(panel);
  panelRef.current = panel;

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

  // Stable for the memoized bezel; reads the newest state when a control is used.
  const send = useCallback(
    (input: GnsInput) => {
      const s = simulator.getState();
      const ctx: GnsCtx = {
        state: s,
        db: simulator.db,
        mag: simulator.mag,
        nearest: nearest(s.aircraft, uiRef.current.aux.criteria),
        cdiSources: panelRef.current.cdiSources,
        now: wallSeconds(),
      };
      const r = reduce(uiRef.current, input, ctx);
      uiRef.current = r.ui;
      setUi(r.ui);
      for (const c of r.cmds) simulator.dispatch(c);
    },
    [simulator, nearest],
  );

  // Timeouts that change the picture without a sim frame (the sim may be paused):
  // the volume readout fading and the tuning cursor returning to COM.
  const [, setTick] = useState(0);
  useEffect(() => {
    const now = wallSeconds();
    const due: number[] = [];
    const shown = ui.radio.volumeShown;
    if (shown) due.push(shown.at + VOLUME_SHOWN_S - now);
    if (ui.radio.tuning === 'VLOC') due.push(ui.radio.tunedAt + VLOC_CURSOR_TIMEOUT_S - now);
    const next = due.filter((d) => d > 0);
    if (next.length === 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.min(...next) * 1000 + 50);
    return () => window.clearTimeout(t);
  }, [ui.radio]);

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
          lcd={lcd}
          deviceScale={deviceScale}
          now={wallSeconds()}
          advisory={advisory(derived.gps, state.aircraft.groundSpeedKt, mag)}
        />
      </Screen>
    </div>
  );
}
