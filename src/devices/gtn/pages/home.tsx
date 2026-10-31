import { useRef } from 'preact/hooks';
import type { Gtn, PageView } from '../context';
import { AppIcon, type AppIconName } from '../icons';
import type { AppId, Page } from '../model';

/*
 * The Home page: the app icon grid. The 750Xi shows all its apps on one
 * pane; the 650Xi shows eight at a time and scrolls between panes with a
 * swipe, the dots, or the small knob.
 */

interface AppTile {
  readonly label: string;
  readonly icon: AppIconName;
  readonly page: Page;
}

const app = (label: string, icon: AppIconName, page: Page): AppTile => ({ label, icon, page });
const unavailable = (label: string, icon: AppIconName, id: AppId) => app(label, icon, { kind: 'app', app: id });

const TILES = {
  defaultNav: app('Default NAV', 'defaultNav', { kind: 'defaultNav' }),
  map: app('Map', 'map', { kind: 'map' }),
  traffic: unavailable('Traffic', 'traffic', 'traffic'),
  terrain: unavailable('Terrain', 'terrain', 'terrain'),
  weather: unavailable('Weather', 'weather', 'weather'),
  charts: unavailable('Charts', 'charts', 'charts'),
  flightPlan: app('Flight Plan', 'flightPlan', { kind: 'flightPlan', cursor: null }),
  proc: unavailable('PROC', 'proc', 'proc'),
  nearest: app('Nearest', 'nearest', { kind: 'nearest' }),
  waypointInfo: app('Waypoint Info', 'waypointInfo', { kind: 'waypointInfo' }),
  services: unavailable('Services', 'services', 'services'),
  utilities: unavailable('Utilities', 'utilities', 'utilities'),
  system: unavailable('System', 'system', 'system'),
} as const;

const T = TILES;

/** Home panes in the order the real units show them. */
const HOME_PANES: Record<Gtn['model'], readonly (readonly AppTile[])[]> = {
  '750': [[T.map, T.traffic, T.terrain, T.weather, T.charts, T.flightPlan, T.proc, T.nearest, T.waypointInfo, T.services, T.utilities, T.system]],
  '650': [
    [T.defaultNav, T.map, T.traffic, T.terrain, T.weather, T.flightPlan, T.proc, T.nearest],
    [T.waypointInfo, T.services, T.utilities, T.system],
  ],
};

const SWIPE_PX = 24;

function HomeBody({ g, pane }: { g: Gtn; pane: number }) {
  const panes = HOME_PANES[g.model];
  const tiles = panes[Math.min(pane, panes.length - 1)] ?? [];
  const setPane = (p: number) => g.go({ type: 'update', page: { kind: 'home', pane: Math.min(Math.max(p, 0), panes.length - 1) } });
  const down = useRef<number | null>(null);
  // A swipe that ends on an icon must not also open it.
  const swiped = useRef(false);
  return (
    <div
      class={`gtn-home gtn-home-${g.model}`}
      onPointerDown={(e) => {
        down.current = e.clientX;
        swiped.current = false;
      }}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (start === null || panes.length < 2) return;
        const dx = e.clientX - start;
        if (Math.abs(dx) > SWIPE_PX) {
          swiped.current = true;
          setPane(pane + (dx < 0 ? 1 : -1));
        }
      }}
      onClickCapture={(e) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div class="gtn-home-grid">
        {tiles.map((t) => (
          <button key={t.label} type="button" class="gtn-app" onClick={() => g.go({ type: 'open', page: t.page })}>
            <AppIcon name={t.icon} />
            <span class="gtn-app-label">{t.label}</span>
          </button>
        ))}
      </div>
      {panes.length > 1 && (
        <div class="gtn-pane-dots" role="tablist" aria-label="Home panes">
          {panes.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === pane}
              aria-label={`Home pane ${i + 1}`}
              class={`gtn-pane-dot${i === pane ? ' is-active' : ''}`}
              onClick={() => setPane(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function homeView(g: Gtn, page: Extract<Page, { kind: 'home' }>): PageView {
  const panes = HOME_PANES[g.model].length;
  return {
    body: <HomeBody g={g} pane={page.pane} />,
    controls: { back: 'none' },
    knob:
      panes > 1
        ? {
            inner: (n) => g.go({ type: 'update', page: { kind: 'home', pane: Math.min(Math.max(page.pane + Math.sign(n), 0), panes - 1) } }),
            innerIcon: 'scroll',
          }
        : {},
  };
}
