import { useRef, useState } from 'preact/hooks';
import type { AnyWaypoint } from '../core/navdb';
import type { PanelInfo } from '../devices/types';
import { initialSimState } from '../sim/defaults';
import { useSim, useSimulator } from '../sim/hooks';
import { clearSavedSimState } from '../sim/persist';
import type { AutopilotState, LateralMode, VerticalMode } from '../sim/types';
import { useSessionState } from './context';
import { Icon } from './Icon';
import { activeFailures } from './instructor/failures';
import { InstructorPanel } from './instructor/InstructorPanel';
import { LessonsPanel } from './lessons/LessonsPanel';
import { LessonStrip } from './lessons/LessonStrip';

/*
 * The simulator's own controls, separate from the avionics: pause and time
 * compression, a yoke and throttle for hand flying, a basic autopilot for
 * panels without one and where the airplane is; the instructor station
 * (failures, weather, scenarios) and the lessons sit in the same drawer.
 */

const RATES = [1, 2, 4, 8];

export type DrawerTab = 'fly' | 'position' | 'instructor' | 'lessons';

const TABS: readonly { readonly id: DrawerTab; readonly name: string }[] = [
  { id: 'fly', name: 'Fly' },
  { id: 'position', name: 'Position' },
  { id: 'instructor', name: 'Instructor' },
  { id: 'lessons', name: 'Lessons' },
];

export function SimBar({ simAutopilot, panel }: { simAutopilot: boolean; panel: PanelInfo }) {
  const { state, derived, dispatch } = useSim();
  const [tab, setTab] = useState<DrawerTab | null>(null);
  const a = state.aircraft;
  const ap = state.ap;
  const failed = activeFailures(state.systems.failures).length > 0;
  const toggle = (t: DrawerTab) => setTab(tab === t ? null : t);

  return (
    <div class={`simbar${tab ? ' is-open' : ''}`}>
      {tab && <FlightDrawer tab={tab} onTab={setTab} simAutopilot={simAutopilot} panel={panel} onClose={() => setTab(null)} />}
      {tab !== 'lessons' && <LessonStrip panel={panel} onOpen={() => setTab('lessons')} />}
      <div class="simbar-row">
        <button
          type="button"
          class="simbar-btn"
          onClick={() => dispatch({ type: 'sim.pause', paused: !state.paused })}
          aria-label={state.paused ? 'Resume simulation' : 'Pause simulation'}
        >
          <Icon name={state.paused ? 'play' : 'pause'} />
        </button>
        <button
          type="button"
          class="simbar-btn simbar-rate"
          onClick={() => dispatch({ type: 'sim.rate', rate: RATES[(RATES.indexOf(state.rate) + 1) % RATES.length]! })}
          aria-label={`Simulation speed ${state.rate} times. Tap to change.`}
        >
          {state.rate}×
        </button>
        <div class="simbar-readouts" aria-live="off">
          <Readout label="ALT" value={`${Math.round(derived.indicatedAltitudeFt).toLocaleString('en-US')}`} unit="ft" />
          <Readout label="IAS" value={`${Math.round(a.iasKt)}`} unit="kt" />
          <Readout label="HDG" value={`${String(Math.round(derived.headingMag) % 360 || 360).padStart(3, '0')}`} unit="°" />
          <Readout label="GS" value={`${Math.round(a.groundSpeedKt)}`} unit="kt" class="hide-narrow" />
          <span class={`simbar-ap${ap.engaged ? ' is-on' : ''}${derived.stalled ? ' is-stall' : ''}`}>
            {derived.stalled ? 'STALL' : apStatus(ap, derived.vertical?.source ?? null)}
          </span>
        </div>
        <button
          type="button"
          class={`simbar-tool hide-narrow${tab === 'lessons' ? ' is-active' : ''}`}
          onClick={() => toggle('lessons')}
          aria-expanded={tab === 'lessons'}
        >
          <Icon name="book" />
          <span>Lessons</span>
        </button>
        <button
          type="button"
          class={`simbar-tool hide-narrow${tab === 'instructor' ? ' is-active' : ''}`}
          onClick={() => toggle('instructor')}
          aria-expanded={tab === 'instructor'}
          aria-label={failed ? 'Instructor, failures active' : 'Instructor'}
        >
          <Icon name="sliders" />
          <span>Instructor</span>
          {failed && <i class="simbar-alert" aria-hidden="true" />}
        </button>
        <button
          type="button"
          class={`simbar-fly${tab === 'fly' || tab === 'position' ? ' is-active' : tab ? ' is-open-narrow' : ''}`}
          onClick={() => setTab(tab ? null : 'fly')}
          aria-expanded={tab !== null}
          aria-label={failed ? 'Fly, instructor and lessons. Failures active.' : 'Fly, instructor and lessons'}
        >
          <Icon name="plane" />
          <span>Fly</span>
          {failed && <i class="simbar-alert show-narrow" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** "AP NAV ALT · ALTS", "AP APR GP". */
function apStatus(ap: AutopilotState, path: 'GP' | 'GS' | null): string {
  if (!ap.engaged) return 'Hand flying';
  const lateral = ap.lateral === 'NAV' && ap.approach ? 'APR' : ap.lateral;
  const vertical = ap.vertical === 'IAS' ? 'FLC' : ap.vertical === 'GS' ? path ?? 'GS' : ap.vertical;
  const armed = [ap.lateralArmed, ap.altitudeArmed && 'ALTS', ap.verticalArmed && (path ?? 'GS')].filter(Boolean).join(' ');
  return `AP ${lateral} ${vertical}${armed ? ` · ${armed}` : ''}`;
}

function Readout({ label, value, unit, class: cls }: { label: string; value: string; unit: string; class?: string }) {
  return (
    <span class={`readout${cls ? ` ${cls}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <small>{unit}</small>
    </span>
  );
}

function FlightDrawer({
  tab,
  onTab,
  simAutopilot,
  panel,
  onClose,
}: {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  simAutopilot: boolean;
  panel: PanelInfo;
  onClose: () => void;
}) {
  const { state, dispatch } = useSim();
  return (
    <div class="drawer" role="region" aria-label="Flight controls, instructor and lessons">
      <div class="drawer-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`drawer-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="drawer-panel"
            class="drawer-tab"
            onClick={() => onTab(t.id)}
          >
            {t.name}
          </button>
        ))}
        <button type="button" class="icon-btn drawer-close" onClick={onClose} aria-label="Close the drawer">
          <Icon name="close" />
        </button>
      </div>
      <div id="drawer-panel" role="tabpanel" aria-labelledby={`drawer-tab-${tab}`}>
        {tab === 'fly' && (
          <div class="drawer-body drawer-fly">
            <Yoke />
            <div class="fly-controls">
              <label class="throttle">
                <span>
                  Throttle <strong>{Math.round(state.aircraft.engine.throttle * 100)}%</strong> · {Math.round(state.aircraft.engine.rpm)} RPM
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(state.aircraft.engine.throttle * 100)}
                  onInput={(e) => dispatch({ type: 'engine.throttle', value: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
                />
              </label>
              <button type="button" class="pill-btn" onClick={() => dispatch({ type: 'controls.level' })}>
                Level off
              </button>
              {simAutopilot && <SimAutopilot />}
            </div>
          </div>
        )}
        {tab === 'position' && <PositionForm />}
        {tab === 'instructor' && <InstructorPanel panel={panel} />}
        {tab === 'lessons' && <LessonsPanel panel={panel} />}
      </div>
    </div>
  );
}

/** Drag to roll and pitch; let go and the airplane holds its attitude. */
function Yoke() {
  const { dispatch } = useSim();
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (e: PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const x = Math.max(Math.min(((e.clientX - r.left) / r.width) * 2 - 1, 1), -1);
    const y = Math.max(Math.min(((e.clientY - r.top) / r.height) * 2 - 1, 1), -1);
    setKnob({ x, y });
    // A small dead zone so a resting finger doesn't drift.
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    dispatch({ type: 'controls.set', roll: dz(x), pitch: dz(-y) });
  };
  const release = () => {
    setKnob({ x: 0, y: 0 });
    dispatch({ type: 'controls.set', roll: 0, pitch: 0 });
  };

  return (
    <div
      ref={pad}
      class="yoke"
      role="application"
      aria-label="Yoke. Drag left or right to bank, up or down to pitch. Release to hold attitude."
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => e.buttons && update(e)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span class="yoke-axis yoke-x" />
      <span class="yoke-axis yoke-y" />
      <span class="yoke-knob" style={{ left: `${50 + knob.x * 42}%`, top: `${50 + knob.y * 42}%` }} />
      <span class="yoke-hint">Yoke</span>
    </div>
  );
}

function SimAutopilot() {
  const { state, derived, dispatch } = useSim();
  const ap = state.ap;
  const lat = (mode: LateralMode) => (
    <button
      type="button"
      class={`ap-key${ap.engaged && ap.lateral === mode && !(mode === 'NAV' && ap.approach) ? ' is-on' : ''}${ap.lateralArmed === mode ? ' is-armed' : ''}`}
      onClick={() => dispatch({ type: 'ap.lateral', mode })}
    >
      {mode}
    </button>
  );
  const vert = (mode: VerticalMode, label: string) => (
    <button
      type="button"
      class={`ap-key${ap.engaged && ap.vertical === mode ? ' is-on' : ''}`}
      onClick={() => {
        dispatch({ type: 'ap.vertical', mode });
        if (mode !== 'ALT') dispatch({ type: 'ap.armAltitude', on: true });
      }}
    >
      {label}
    </button>
  );
  return (
    <div class="sim-ap" role="group" aria-label="Sim autopilot">
      <div class="sim-ap-row">
        <button type="button" class={`ap-key ap-master${ap.engaged ? ' is-on' : ''}`} onClick={() => dispatch({ type: 'ap.engage', on: !ap.engaged })}>
          AP
        </button>
        {lat('HDG')}
        {lat('NAV')}
        <button
          type="button"
          class={`ap-key${ap.engaged && ap.approach ? ' is-on' : ''}${ap.verticalArmed ? ' is-armed' : ''}`}
          onClick={() => dispatch({ type: 'ap.approach', on: !ap.approach })}
          aria-label={`Approach mode${ap.verticalArmed ? `, ${derived.vertical?.source ?? 'GS'} armed` : ''}`}
        >
          APR
        </button>
        {vert('ALT', 'ALT')}
        {vert('VS', 'VS')}
      </div>
      <div class="sim-ap-row sim-ap-values">
        <Stepper label="HDG bug" value={`${String(state.bugs.headingMag).padStart(3, '0')}°`} onStep={(d) => dispatch({ type: 'bug.heading', mag: state.bugs.headingMag + d * 5 })} />
        <Stepper label="ALT sel" value={`${state.bugs.altitudeFt.toLocaleString('en-US')}`} onStep={(d) => dispatch({ type: 'bug.altitude', ft: state.bugs.altitudeFt + d * 100 })} />
        <Stepper label="VS" value={`${state.bugs.verticalSpeedFpm}`} onStep={(d) => dispatch({ type: 'bug.verticalSpeed', fpm: state.bugs.verticalSpeedFpm + d * 100 })} />
      </div>
      <p class="sim-ap-note">No autopilot unit in this panel, so this generic one flies the bugs. APR couples the approach and arms the glidepath.</p>
    </div>
  );
}

function Stepper({ label, value, onStep }: { label: string; value: string; onStep: (d: 1 | -1) => void }) {
  return (
    <span class="stepper">
      <small>{label}</small>
      <button type="button" onClick={() => onStep(-1)} aria-label={`Decrease ${label}`}>
        −
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => onStep(1)} aria-label={`Increase ${label}`}>
        +
      </button>
    </span>
  );
}

function PositionForm() {
  const sim = useSimulator();
  const { state, db, dispatch } = useSim();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<AnyWaypoint | null>(null);
  const [alt, setAlt] = useSessionState('pos.alt', 3500);
  const [hdg, setHdg] = useSessionState('pos.hdg', 360);
  const results = query.trim().length >= 2 ? [...db.search(query, 6), ...db.searchByName(query, 6)].slice(0, 8) : [];
  const near = db.nearestAirports(state.aircraft, 1)[0];
  const nearest = near?.item;
  const nearestNm = near?.distanceNm ?? 0;

  const move = () => {
    if (!picked) return;
    dispatch({
      type: 'sim.reposition',
      lat: picked.lat,
      lon: picked.lon,
      altitudeFt: alt,
      headingTrue: hdg + sim.mag.variation(picked.lat, picked.lon),
      iasKt: 105,
    });
  };

  return (
    <div class="drawer-body drawer-form">
      <label class="field">
        <span>Start over an airport or navaid</span>
        <input
          value={query}
          placeholder="Identifier or name, e.g. KFDK or Frederick"
          autoComplete="off"
          autoCapitalize="characters"
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setPicked(null);
          }}
        />
      </label>
      {results.length > 0 && !picked && (
        <ul class="results">
          {results.map((w) => (
            <li key={`${w.kind}${w.ident}`}>
              <button
                type="button"
                onClick={() => {
                  setPicked(w);
                  setQuery(w.ident);
                  if (w.kind === 'airport' && 'elevationFt' in w) setAlt(Math.round((w.elevationFt + 2500) / 100) * 100);
                }}
              >
                <strong>{w.ident}</strong> {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="field-row">
        <label class="field">
          <span>Altitude (ft MSL)</span>
          <input type="number" inputMode="numeric" value={alt} step={100} onInput={(e) => setAlt(Number((e.currentTarget as HTMLInputElement).value) || 0)} />
        </label>
        <label class="field">
          <span>Heading (°M)</span>
          <input type="number" inputMode="numeric" value={hdg} step={10} onInput={(e) => setHdg(Number((e.currentTarget as HTMLInputElement).value) || 0)} />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="pill-btn pill-primary" disabled={!picked} onClick={move}>
          {picked ? `Fly from ${picked.ident}` : 'Pick a place first'}
        </button>
        <button
          type="button"
          class="pill-btn"
          onClick={() => {
            clearSavedSimState();
            sim.reset(initialSimState());
          }}
        >
          Reset the session
        </button>
      </div>
      <p class="sim-ap-note">
        {nearest ? `Nearest airport now: ${nearest.ident}, ${Math.round(nearestNm)} nm. ` : ''}
        Reset restores the default radios and the KJYO, MRB, KHGR flight plan. Approach starts are in Instructor, Scenario.
      </p>
    </div>
  );
}
