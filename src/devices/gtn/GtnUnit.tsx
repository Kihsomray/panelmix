import { useEffect, useReducer, useState } from 'preact/hooks';
import { stepChannel, stepMhz } from '../../core/frequency';
import { useSim } from '../../sim/hooks';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { Screen } from '../../ui/Screen';
import type { PanelInfo } from '../types';
import { pressDirectTo, standbyOf, swapRadio, tuneEmergency } from './actions';
import type { Gtn, PageView } from './context';
import { AnnunciatorBar, ControlBar750, LeftKeys650, RightSlot650, type KnobHintView } from './frame';
import './gtn.css';
import { DirectToGlyph } from './icons';
import { BANDS, type RadioBand } from './keypad';
import { BEZEL, CONTROL_BAR_750, LEFT_COLUMN_650, RIGHT_COLUMN_650, SCREEN, type Rect } from './layout';
import { useNearestLists } from './lookups';
import { ModalView } from './modals';
import { ENTRY_PAGES, type Model } from './model';
import { initialNav, navReducer, topPage, type NavAction, type NavState } from './navigation';
import { pageView } from './pages';
import { FreqBox, VolumeHint, XpdrBox, type KnobRadioState } from './radios';
import { initialSettings, settingsReducer } from './settings';
import { TitleBar } from './ui';

/*
 * One GTN Xi, either model. The bezel controls and the knob routing are
 * shared; the 750Xi lays its screen out portrait (radio bar on top, control
 * keys along the bottom), the 650Xi wide (key column left, radio column
 * right).
 *
 * The dual knob drives, in order of precedence: a data-entry page (keypads,
 * keyboard, Direct-To), else the standby frequency its push selected, else
 * page navigation (large knob: page shortcuts, small knob: zoom or scroll).
 */

/** The selected standby window falls back to page navigation after this long without a turn. */
const FOCUS_TIMEOUT_MS = 30_000;
/** The standby window stays filled blue this long after a turn. */
const TURNING_MS = 3_000;
const VOLUME_SHOW_MS = 2_500;

const box = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

function useTimedFlag<T>(ms: number): [T | null, (v: T) => void] {
  const [value, setValue] = useState<{ v: T; n: number } | null>(null);
  useEffect(() => {
    if (!value) return;
    const t = window.setTimeout(() => setValue(null), ms);
    return () => window.clearTimeout(t);
  }, [value?.n]);
  return [value?.v ?? null, (v: T) => setValue((old) => ({ v, n: (old?.n ?? 0) + 1 }))];
}

export function GtnUnit({ model, panel }: { model: Model; panel: PanelInfo }) {
  const sim = useSim();
  const [nav, navDispatch] = useReducer((s: NavState, a: NavAction) => navReducer(model, s, a), undefined, initialNav);
  const [settings, set] = useReducer(settingsReducer, model, initialSettings);
  const lists = useNearestLists(sim.db, sim.state.aircraft);
  const [knobTick, setKnobTick] = useState(0);
  const [turning, markTurning] = useTimedFlag<true>(TURNING_MS);
  const [volumeShown, showVolume] = useTimedFlag<RadioBand>(VOLUME_SHOW_MS);

  // A selected standby window returns to page navigation when the knob is left alone.
  useEffect(() => {
    if (nav.focus === 'page') return;
    const t = window.setTimeout(() => navDispatch({ type: 'focus', focus: 'page' }), FOCUS_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [nav.focus, knobTick]);

  const layout = SCREEN[model];
  const bezel = BEZEL[model];
  const g: Gtn = {
    model,
    panel,
    state: sim.state,
    derived: sim.derived,
    dispatch: sim.dispatch,
    db: sim.db,
    mag: sim.mag,
    nav,
    settings,
    lists,
    go: navDispatch,
    set,
    box: { w: layout.content.w, h: layout.content.h },
    nowMs: Date.now(),
    xpdrControl: panel.xpdr === 'integrated',
  };

  const top = topPage(nav);
  const view: PageView = pageView(g, top);

  // User-field configuration belongs to the page it started on; leaving the page ends it.
  useEffect(() => set({ type: 'editFields', page: null }), [top.kind]);

  const entryPage = ENTRY_PAGES.has(top.kind);
  const radioFocus: RadioBand | null = !entryPage && nav.focus !== 'page' ? nav.focus : null;
  // The radio the pilot is working with: an open NAV panel or Find list, or the knob on NAV.
  // It is the one the volume knob adjusts, and the one the 650Xi shows (it has room for one).
  const panelBand = top.kind === 'radio' || top.kind === 'find' ? top.band : null;
  const volumeBand: RadioBand = panelBand ?? (radioFocus === 'nav' ? 'nav' : 'com');
  const knobState: KnobRadioState = { focus: radioFocus, turning: turning !== null, volume: volumeShown };

  const touchKnob = () => setKnobTick((n) => n + 1);
  const tuneStandby = (band: RadioBand, knob: 'mhz' | 'khz', steps: number) => {
    const b = BANDS[band];
    const now = standbyOf(g, band);
    const khz = knob === 'mhz' ? stepMhz(b, now, steps) : stepChannel(b, now, steps);
    sim.dispatch({ type: band === 'com' ? 'com.setStandby' : 'nav.setStandby', radio: 0, khz });
    markTurning(true);
    touchKnob();
  };
  const onOuter = (n: number) => {
    if (radioFocus) tuneStandby(radioFocus, 'mhz', n);
    else if (view.knob.outer) view.knob.outer(n);
    else navDispatch({ type: 'shortcut', steps: n });
  };
  const onInner = (n: number) => {
    if (radioFocus) tuneStandby(radioFocus, 'khz', n);
    else view.knob.inner?.(n);
  };
  const onPush = () => {
    if (entryPage && view.knob.push) view.knob.push();
    else navDispatch({ type: 'knobPush' });
    touchKnob();
  };

  const hint: KnobHintView = radioFocus
    ? { kind: 'text', text: radioFocus === 'com' ? 'Com Freq / Psh Nav' : 'Nav Freq / Psh Page' }
    : view.knob.hint
      ? { kind: 'text', text: view.knob.hint }
      : { kind: 'locater', icon: view.knob.innerIcon ?? null };

  const pageLabels = view.knob.labels;
  const knobLabels = radioFocus
    ? { outerLabel: `${radioFocus.toUpperCase()} MHz`, innerLabel: `${radioFocus.toUpperCase()} kHz`, pushLabel: radioFocus === 'com' ? 'NAV' : 'Pages' }
    : pageLabels
      ? { outerLabel: pageLabels.outer, innerLabel: pageLabels.inner, pushLabel: pageLabels.push }
      : { outerLabel: 'Page shortcuts', innerLabel: view.knob.innerIcon === 'zoom' ? 'Zoom' : view.knob.inner ? 'Scroll' : 'Small knob', pushLabel: 'COM' };

  // Push and hold flips the radio the knob is on (the real unit's "Hold for flip-flop").
  // On pages and entry fields a held push is just a push, so the dock offers no hold button there.
  const flipFlop = radioFocus
    ? { onLongPush: () => swapRadio(g, radioFocus), longPushLabel: `${radioFocus.toUpperCase()} flip-flop` }
    : {};
  const volumeLabel = `Volume and squelch knob (${volumeBand.toUpperCase()}). Hold for 121.5 emergency.`;
  const volumeLabels = {
    innerLabel: `${volumeBand.toUpperCase()} volume`,
    pushLabel: volumeBand === 'nav' ? 'Ident' : 'Squelch',
    longPushLabel: '121.5',
  };

  const content = (
    <div class={`gtn-content${view.title ? ' has-title' : ''}`} style={box(layout.content)}>
      {view.title && <TitleBar>{view.title}</TitleBar>}
      <div class="gtn-page">{view.body}</div>
      {nav.modal && <ModalView g={g} modal={nav.modal} />}
    </div>
  );

  return (
    <div class={`gtn gtn-${model}`}>
      <div class="gtn-bezel" />
      {bezel.grips.map((r, i) => (
        <div key={i} class="gtn-grip" style={box(r)} />
      ))}
      <div class="gtn-glass" style={box(bezel.glass)} />
      <div class="gtn-logo" style={{ left: `${bezel.screen.x}px`, width: `${bezel.screen.w}px`, top: `${bezel.logoY - 6}px` }}>
        GARMIN
      </div>
      <div class="gtn-sdslot" style={box(bezel.sdSlot)} aria-hidden="true" />
      <div class="gtn-photocell" style={{ left: `${bezel.photocell.x - 6}px`, top: `${bezel.photocell.y - 6}px` }} aria-hidden="true" />
      <div class="gtn-ledge" style={box(bezel.ledge)} aria-hidden="true" />

      <Screen x={bezel.screen.x} y={bezel.screen.y} w={bezel.screen.w} h={bezel.screen.h} class="gtn-screen" radius={3}>
        {model === '750' ? (
          <>
            <div class="gtn-topbar">
              <VolumeHint band={volumeBand} vertical />
              <FreqBox g={g} band="com" knob={knobState} />
              <div class="gtn-topbar-gap" />
              {g.xpdrControl && <XpdrBox g={g} />}
              <FreqBox g={g} band="nav" knob={knobState} />
            </div>
            {content}
            <div class="gtn-ctlbar-wrap" style={box(CONTROL_BAR_750)}>
              <ControlBar750 g={g} controls={view.controls} />
            </div>
          </>
        ) : (
          <>
            <div class="gtn-leftcol" style={box(LEFT_COLUMN_650)}>
              <VolumeHint band={volumeBand} vertical={false} />
              <LeftKeys650 g={g} controls={view.controls} />
            </div>
            {content}
            <div class="gtn-rightcol" style={box(RIGHT_COLUMN_650)}>
              {/* Only one frequency window fits: COM, or NAV while the knob is on NAV. */}
              <FreqBox g={g} band={volumeBand} knob={knobState} />
              {g.xpdrControl ? <XpdrBox g={g} /> : <div class="gtn-xpdrbox is-absent" />}
              <div class="gtn-rightslot">
                <RightSlot650 g={g} controls={view.controls} />
              </div>
            </div>
          </>
        )}
        <div class="gtn-annunciator-wrap" style={box(layout.annunciator)}>
          <AnnunciatorBar g={g} hint={hint} />
        </div>
      </Screen>

      <Knob
        id={`gtn${model}.volume`}
        x={bezel.volume.x}
        y={bezel.volume.y}
        size={bezel.volume.size}
        label={volumeLabel}
        {...volumeLabels}
        onInner={(n) => {
          set({ type: 'volume', band: volumeBand, steps: n });
          showVolume(volumeBand);
        }}
        onPush={() =>
          volumeBand === 'nav' ? sim.dispatch({ type: 'nav.ident', radio: 0, on: !sim.state.radios.navIdent[0] }) : set({ type: 'squelch' })
        }
        onLongPush={() => tuneEmergency(g)}
      />
      <BezelButton
        x={bezel.home.x}
        y={bezel.home.y}
        w={bezel.home.w}
        h={bezel.home.h}
        label="HOME"
        ariaLabel={model === '750' ? 'Home. Hold for the map.' : 'Home. Hold for Default Navigation.'}
        fontSize={10}
        class="gtn-hw-key"
        onPress={() => navDispatch({ type: 'home' })}
        onLongPress={() => navDispatch({ type: 'homeHold' })}
      />
      <BezelButton
        x={bezel.direct.x}
        y={bezel.direct.y}
        w={bezel.direct.w}
        h={bezel.direct.h}
        label={<DirectToGlyph />}
        ariaLabel="Direct-to"
        class="gtn-hw-key"
        onPress={() => pressDirectTo(g)}
      />
      <Knob
        id={`gtn${model}.knob`}
        x={bezel.knob.x}
        y={bezel.knob.y}
        size={bezel.knob.size}
        innerSize={bezel.knob.inner}
        label="Dual concentric knob. Push: COM, NAV, pages. Hold: flip-flop."
        {...knobLabels}
        {...flipFlop}
        onOuter={onOuter}
        onInner={onInner}
        onPush={onPush}
      />
    </div>
  );
}
