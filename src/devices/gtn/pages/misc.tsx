import type { Gtn, PageView } from '../context';
import { AppIcon, type AppIconName } from '../icons';
import type { AppId, Page } from '../model';
import { NotAvailable } from '../ui';

/*
 * The message list, and the frames of the apps whose data the trainer does
 * not have (traffic, terrain, weather, charts, procedures...): the real page
 * title and symbol with a plain statement of what is missing.
 */

export function messagesView(g: Gtn): PageView {
  const list = [...g.state.messages].reverse();
  return {
    title: 'Messages',
    body: (
      <div class="gtn-list gtn-messages" role="log">
        {list.length === 0 && <div class="gtn-empty">No messages</div>}
        {list.map((m) => (
          <div key={m.id} class={`gtn-msg${m.level === 'caution' ? ' is-caution' : ''}${m.read ? '' : ' is-new'}`}>
            {m.text}
          </div>
        ))}
      </div>
    ),
    controls: {},
    knob: {},
  };
}

interface AppInfo {
  readonly title: string;
  readonly icon: AppIconName;
  readonly reason: string;
}

const APPS: Record<AppId, AppInfo> = {
  traffic: { title: 'Traffic', icon: 'traffic', reason: 'The trainer has no other aircraft or traffic receiver (ADS-B In, TAS).' },
  terrain: { title: 'Terrain', icon: 'terrain', reason: 'There is no terrain or obstacle database in the trainer.' },
  weather: { title: 'Weather', icon: 'weather', reason: 'No datalink weather (FIS-B, SiriusXM) or radar is simulated.' },
  charts: { title: 'Charts', icon: 'charts', reason: 'Approach charts and airport diagrams are not in the trainer database.' },
  proc: { title: 'Procedures', icon: 'proc', reason: 'Departures, arrivals and approaches are not in the trainer database.' },
  services: { title: 'Services', icon: 'services', reason: 'Telephone, text messaging and music need connected services the trainer does not have.' },
  utilities: { title: 'Utilities', icon: 'utilities', reason: 'Trip and fuel planning, timers and checklists are not simulated.' },
  system: { title: 'System', icon: 'system', reason: 'Setup pages (units, backlight, database status) are not simulated.' },
  audio: { title: 'Audio Panel', icon: 'services', reason: 'No remote audio panel is installed with this unit.' },
  intersection: { title: 'Nearest Intersection', icon: 'intersection', reason: 'Intersections are not in the trainer database.' },
  vrp: { title: 'Nearest VRP', icon: 'vrp', reason: 'Visual reporting points are not in the trainer database.' },
  user: { title: 'User Waypoints', icon: 'user', reason: 'No user waypoints have been created.' },
  airspace: { title: 'Nearest Airspace', icon: 'airspace', reason: 'Airspace is not in the trainer database.' },
  artcc: { title: 'Nearest ARTCC', icon: 'artcc', reason: 'Center frequencies are not in the trainer database.' },
  fss: { title: 'Nearest FSS', icon: 'fss', reason: 'Flight service frequencies are not in the trainer database.' },
  wxfreq: { title: 'Nearest Weather', icon: 'wxfreq', reason: 'Use Nearest Airport: airport frequencies include ATIS, ASOS and AWOS.' },
};

export function appView(_g: Gtn, page: Extract<Page, { kind: 'app' }>): PageView {
  const a = APPS[page.app];
  return {
    title: a.title,
    body: (
      <div class="gtn-app-page">
        <div class="gtn-app-page-icon">
          <AppIcon name={a.icon} />
        </div>
        <NotAvailable>{a.reason}</NotAvailable>
      </div>
    ),
    controls: {},
    knob: {},
  };
}
