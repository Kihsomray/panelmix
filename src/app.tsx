import { useEffect, useMemo, useState } from 'preact/hooks';
import { MagneticModel, type MagvarGrid } from './core/magvar';
import { NavDatabase, type RawNavdata } from './core/navdb';
import type { DeviceSpec, Slot } from './devices/types';
import { SimContext } from './sim/hooks';
import { loadSimState, saveSimState } from './sim/persist';
import { Simulator } from './sim/simulator';
import { HelpSheet } from './shell/HelpSheet';
import { Icon } from './shell/Icon';
import { PanelPicker } from './shell/PanelPicker';
import { PanelStage } from './shell/PanelStage';
import { encodePanel, loadPanel, NONE, normalize, panelInfo, PRESETS, savePanel, type PanelConfig } from './shell/panels';
import { SimBar } from './shell/SimBar';
import { KnobDock } from './ui/controls/KnobDock';

/*
 * Boot: load the navigation database and magnetic model, start the
 * simulator, then show the panel the pilot last built (or the one in the
 * share link).
 */

const SAVE_EVERY_MS = 3000;

type Boot = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sim: Simulator };

async function boot(): Promise<Simulator> {
  const base = import.meta.env.BASE_URL;
  const [nav, mag] = await Promise.all([
    fetch(`${base}data/navdata.json`).then((r) => {
      if (!r.ok) throw new Error(`navdata ${r.status}`);
      return r.json() as Promise<RawNavdata>;
    }),
    fetch(`${base}data/magvar.json`).then((r) => {
      if (!r.ok) throw new Error(`magvar ${r.status}`);
      return r.json() as Promise<MagvarGrid>;
    }),
  ]);
  return new Simulator(new NavDatabase(nav), new MagneticModel(mag), loadSimState());
}

export function App() {
  const [state, setState] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    boot()
      .then((sim) => alive && setState({ status: 'ready', sim }))
      .catch((err: unknown) => alive && setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state.status === 'loading') {
    return (
      <div class="boot">
        <Logo />
        <p>Loading 5,000 airports and the navaids…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div class="boot">
        <Logo />
        <p>Couldn't load the navigation database ({state.message}).</p>
        <button type="button" class="pill-btn pill-primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <SimContext.Provider value={state.sim}>
      <Cockpit sim={state.sim} />
    </SimContext.Provider>
  );
}

function Cockpit({ sim }: { sim: Simulator }) {
  const [config, setConfig] = useState<PanelConfig>(loadPanel);
  const [notes, setNotes] = useState<string[]>([]);
  const [help, setHelp] = useState<{ spec: DeviceSpec | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const panel = useMemo(() => panelInfo(config), [config]);

  useEffect(() => {
    sim.start();
    const save = window.setInterval(() => saveSimState(sim.getState()), SAVE_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && saveSimState(sim.getState());
    document.addEventListener('visibilitychange', onHide);
    return () => {
      sim.stop();
      window.clearInterval(save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [sim]);

  useEffect(() => {
    savePanel(config);
    history.replaceState(null, '', encodePanel(config));
    // A CDI source the new panel doesn't have falls back to GPS.
    if (!panel.cdiSources.includes(sim.getState().nav.cdiSource)) sim.dispatch({ type: 'cdi.source', source: 'GPS' });
  }, [config]);

  useEffect(() => {
    if (notes.length === 0) return;
    const t = window.setTimeout(() => setNotes([]), 6000);
    return () => window.clearTimeout(t);
  }, [notes]);

  const change = (slot: Slot, id: string) => {
    const result = normalize({ ...config, [slot]: id }, slot);
    setConfig(result.config);
    setNotes(result.notes);
  };
  const preset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) {
      setConfig(p.config);
      setNotes([]);
    }
  };

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'PanelMix', url });
      else {
        await navigator.clipboard.writeText(url);
        setNotes(['Link to this panel copied.']);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  return (
    <div class="app">
      <header class="topbar">
        <Logo />
        <button type="button" class="pill-btn panel-toggle" onClick={() => setPickerOpen(!pickerOpen)} aria-expanded={pickerOpen}>
          <Icon name="panel" />
          Build panel
        </button>
        <div class={`picker-wrap${pickerOpen ? ' is-open' : ''}`}>
          <PanelPicker config={config} onChange={change} onPreset={preset} />
        </div>
        <div class="topbar-actions">
          <button type="button" class="icon-btn" onClick={share} aria-label="Share this panel" title="Share this panel">
            <Icon name="share" />
          </button>
          <button type="button" class="icon-btn" onClick={() => setHelp({ spec: null })} aria-label="How to use" title="How to use">
            <Icon name="help" />
          </button>
        </div>
      </header>

      {notes.length > 0 && (
        <div class="toast" role="status">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <main class="stage-wrap">
        <PanelStage config={config} panel={panel} onHelp={(spec) => setHelp({ spec })} />
      </main>

      <SimBar simAutopilot={config.ap === NONE} />
      <KnobDock />
      {help && <HelpSheet spec={help.spec} onClose={() => setHelp(null)} />}
    </div>
  );
}

function Logo() {
  return (
    <div class="logo">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1.5" y="5" width="17" height="22" rx="3.5" fill="#1d5fc4" />
        <rect x="13.5" y="5" width="17" height="22" rx="3.5" fill="#ff40ff" fill-opacity="0.9" />
        <path d="M5 16h10M22 11v10M17 16h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" />
      </svg>
      <span>
        Panel<b>Mix</b>
      </span>
    </div>
  );
}
