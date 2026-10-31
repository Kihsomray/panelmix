import type { Gtn, PageView } from '../context';
import type { Page } from '../model';
import { directToView } from './directTo';
import { flightPlanView } from './flightPlan';
import { homeView } from './home';
import { keyboardView, wptFindView } from './keyboard';
import { defaultNavView, mapView } from './map';
import { appView, messagesView } from './misc';
import { nearestListView, nearestView } from './nearest';
import { obsCourseView } from './obs';
import { findView, radioView } from './radio';
import { waypointInfoView, wptView } from './waypoint';
import { xpdrView } from './xpdr';

/** The view (body, control keys, knob behaviour) of whatever page is on screen. */
export function pageView(g: Gtn, page: Page): PageView {
  switch (page.kind) {
    case 'home':
      return homeView(g, page);
    case 'map':
      return mapView(g);
    case 'defaultNav':
      return defaultNavView(g, page);
    case 'flightPlan':
      return flightPlanView(g, page);
    case 'directTo':
      return directToView(g, page);
    case 'nearest':
      return nearestView(g);
    case 'nearestList':
      return nearestListView(g, page);
    case 'waypointInfo':
      return waypointInfoView(g);
    case 'wpt':
      return wptView(g, page);
    case 'xpdr':
      return xpdrView(g, page);
    case 'obsCourse':
      return obsCourseView(g, page);
    case 'radio':
      return radioView(g, page);
    case 'find':
      return findView(g, page);
    case 'keyboard':
      return keyboardView(g, page);
    case 'wptFind':
      return wptFindView(g, page);
    case 'messages':
      return messagesView(g);
    case 'app':
      return appView(g, page);
  }
}
