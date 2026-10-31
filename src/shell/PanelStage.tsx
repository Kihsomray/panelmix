import type { ComponentType } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { device } from '../devices/registry';
import type { DeviceProps, DeviceSpec, PanelInfo, Slot } from '../devices/types';
import { DeviceFrame } from '../ui/DeviceFrame';
import { Icon } from './Icon';
import { computeLayout, focusWidth } from './layout';
import type { PanelConfig } from './panels';

/*
 * Lays the chosen units out like a panel: flight instruments on the left,
 * the navigator with the transponder and autopilot stacked on the right.
 * Wide screens get two columns sized for readability (not to physical
 * scale); phones get a single column. Any unit can be focused to fill the
 * screen.
 */

/** Height of the fixed sim bar plus a little breathing room. */
const SIMBAR_ALLOWANCE = 74;

interface Placed {
  readonly slot: Slot;
  readonly spec: DeviceSpec;
  readonly width: number;
}

/** The element's width, and the height left between its top and the sim bar. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setSize({ w: el.clientWidth, h: Math.max(window.innerHeight - top - SIMBAR_ALLOWANCE, 200) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return [ref, size] as const;
}

function useDeviceComponent(spec: DeviceSpec | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; Comp: ComponentType<DeviceProps> } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!spec) return;
    let alive = true;
    setError(false);
    spec
      .load()
      .then((m) => alive && setLoaded({ id: spec.id, Comp: m.default }))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [spec?.id]);
  return { Comp: loaded && spec && loaded.id === spec.id ? loaded.Comp : null, error };
}

function DeviceSlot({
  placed,
  panel,
  onFocus,
  onHelp,
  focused = false,
}: {
  placed: Placed;
  panel: PanelInfo;
  onFocus: () => void;
  onHelp: () => void;
  focused?: boolean;
}) {
  const { spec, width } = placed;
  const { Comp, error } = useDeviceComponent(spec);
  return (
    <section
      class={`device-slot${focused ? ' is-focused' : ''}`}
      style={{ width: `${width}px` }}
      aria-label={`${spec.maker} ${spec.name}`}
      {...(focused && { role: 'dialog', 'aria-modal': true })}
    >
      <header class="device-slot-bar">
        <span class="device-slot-name">
          <span class="device-slot-maker">{spec.maker}</span> {spec.name}
        </span>
        <span class="device-slot-actions">
          <button type="button" class="icon-btn" onClick={onHelp} aria-label={`How to use the ${spec.name}`} title="Controls">
            <Icon name="help" />
          </button>
          <button
            type="button"
            class="icon-btn"
            onClick={onFocus}
            aria-label={focused ? 'Back to the full panel' : `Focus the ${spec.name}`}
            title={focused ? 'Back to panel' : 'Focus'}
          >
            <Icon name={focused ? 'shrink' : 'expand'} />
          </button>
        </span>
      </header>
      <DeviceFrame width={spec.width} height={spec.height} label={`${spec.maker} ${spec.name}`}>
        {Comp ? (
          <Comp spec={spec} panel={panel} />
        ) : (
          <div class="device-loading">{error ? 'Could not load this unit. Check your connection.' : 'Loading…'}</div>
        )}
      </DeviceFrame>
    </section>
  );
}

export function PanelStage({
  config,
  panel,
  onHelp,
}: {
  config: PanelConfig;
  panel: PanelInfo;
  onHelp: (spec: DeviceSpec) => void;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [focus, setFocus] = useState<Slot | null>(null);

  const pfd = device(config.pfd)!;
  const nav = device(config.nav)!;
  const xpdr = device(config.xpdr);
  const ap = device(config.ap);
  const right = [nav, xpdr, ap].filter((d): d is DeviceSpec => !!d);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const layout = computeLayout({ width: size.w, height: size.h, pfd: { width: pfd.width, height: pfd.height }, stack: right });
  const twoColumns = layout.columns === 2;

  let left: Placed[] = [];
  let rightPlaced: Placed[] = [];
  if (size.w > 0) {
    if (twoColumns) {
      left = [{ slot: 'pfd', spec: pfd, width: pfd.width * layout.pfdScale }];
      rightPlaced = right.map((d) => ({ slot: d.slot, spec: d, width: d.width * layout.stackScale }));
    } else {
      // One column: each unit as wide as the screen, within reason.
      const fit = (d: DeviceSpec) => Math.min(size.w, d.width * 1.6);
      left = [{ slot: 'pfd', spec: pfd, width: fit(pfd) }];
      rightPlaced = right.map((d) => ({ slot: d.slot, spec: d, width: fit(d) }));
    }
  }

  // Focusing re-sizes the same mounted unit (so its pages and cursors are kept)
  // and pins it over the panel.
  const focusedWidth = (p: Placed) =>
    focusWidth(
      { width: p.spec.width, height: p.spec.height },
      { width: Math.min(window.innerWidth, size.w + 28) - 20, height: window.innerHeight - 64 - SIMBAR_ALLOWANCE - 34 },
    );
  const slot = (p: Placed) => {
    const isFocused = focus === p.slot;
    return (
      <DeviceSlot
        key={p.spec.id}
        placed={isFocused ? { ...p, width: focusedWidth(p) } : p}
        panel={panel}
        focused={isFocused}
        onFocus={() => setFocus(isFocused ? null : p.slot)}
        onHelp={() => onHelp(p.spec)}
      />
    );
  };

  return (
    <div ref={ref} class={`panel-stage${twoColumns ? ' is-two-col' : ' is-one-col'}${focus ? ' has-focus' : ''}`}>
      {size.w > 0 && (
        <>
          <div class="panel-col panel-col-left">{left.map(slot)}</div>
          <div class="panel-col panel-col-right">{rightPlaced.map(slot)}</div>
        </>
      )}
      {focus && <div class="focus-backdrop" onClick={() => setFocus(null)} aria-hidden="true" />}
    </div>
  );
}
