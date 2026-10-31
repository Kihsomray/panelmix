import { bearing, distanceNm } from '../../../core/geo';
import { NavDatabase, type Waypoint } from '../../../core/navdb';
import { formatBearing, formatDistance } from '../../../ui/format';
import { openWaypointInfo } from '../actions';
import type { Gtn, PageView } from '../context';
import { fieldValue, type FieldId } from '../fields';
import { CdiBar } from '../frame';
import { MapCanvas, mapVersion, screenToLatLon, type MapPicture } from '../mapCanvas';
import type { Page } from '../model';
import type { MapOrientation } from '../settings';
import { DataField, Key } from '../ui';

/*
 * The Map page (and the 650Xi Default Navigation page): moving map with the
 * NAV range ring, four user fields in the corners, north indicator and
 * orientation label, the CDI / nav status bar (750Xi), and tap-to-select:
 * tapping a waypoint highlights it, shows its banner and makes it the
 * Direct-To candidate.
 */

const ORIENTATION_LABEL: Record<MapOrientation, string> = { north: 'NORTH UP', track: 'TRK UP', heading: 'HDG UP' };
const TAP_RADIUS_PX = 22;

function upTrue(g: Gtn, o: MapOrientation): number {
  const a = g.state.aircraft;
  return o === 'north' ? 0 : o === 'track' ? a.trackTrue : a.headingTrue;
}

function movingMapPicture(g: Gtn, h: number): MapPicture {
  const a = g.state.aircraft;
  return {
    db: g.db,
    center: a,
    ownship: { lat: a.lat, lon: a.lon, headingTrue: a.headingTrue },
    ringNm: g.settings.rangeNm,
    ringShare: g.model === '750' ? 0.36 : h < 200 ? 0.38 : 0.36,
    upTrue: upTrue(g, g.settings.orientation),
    plan: g.state.fms.plan,
    activeLeg: g.state.fms.activeLeg,
    declutter: g.settings.detail,
    highlight: g.settings.mapSelection,
    navRing: true,
    magVar: g.derived.magVar,
    trackTrue: a.trackTrue,
    groundSpeedKt: a.groundSpeedKt,
  };
}

/** The airport, navaid or plan waypoint nearest to a tap, within reach of a finger. */
function pick(g: Gtn, p: MapPicture, w: number, h: number, x: number, y: number): Waypoint | null {
  const at = screenToLatLon(p, w, h, x, y);
  const pxPerNm = (Math.min(w, h) * p.ringShare) / p.ringNm;
  const reachNm = TAP_RADIUS_PX / pxPerNm;
  const dLat = reachNm / 60;
  const dLon = dLat / Math.max(Math.cos((at.lat * Math.PI) / 180), 0.2);
  const box = g.db.inBox(at.lat - dLat, at.lon - dLon, at.lat + dLat, at.lon + dLon);
  const candidates: Waypoint[] = [...g.state.fms.plan, ...box.airports, ...box.navaids];
  let best: Waypoint | null = null;
  let bestNm = reachNm;
  for (const c of candidates) {
    const d = distanceNm(at, c);
    if (d <= bestNm) {
      best = c;
      bestNm = d;
    }
  }
  return best ? NavDatabase.toWaypoint(best) : null;
}

function NorthIndicator({ g }: { g: Gtn }) {
  const up = upTrue(g, g.settings.orientation);
  return (
    <div class="gtn-north" aria-hidden="true">
      <svg viewBox="-14 -14 28 28">
        <g transform={`rotate(${-up})`}>
          <path d="M0 -12 L8 10 L0 5 L-8 10 Z" fill="#e8eef4" stroke="#000" stroke-width="1" />
          <text x="0" y="3" text-anchor="middle" font-size="9" font-weight="700" fill="#000">
            N
          </text>
        </g>
      </svg>
      <span>{ORIENTATION_LABEL[g.settings.orientation]}</span>
    </div>
  );
}

function CornerField({ g, id, index, where }: { g: Gtn; id: FieldId; index: number; where: 'map' | 'nav' }) {
  const f = fieldValue(id, g);
  const editing = g.settings.editingFields === where;
  const corner = where === 'map' ? ['tl', 'tr', 'bl', 'br'][index] : '';
  if (editing) {
    return (
      <Key
        class={`gtn-userfield is-editing gtn-corner-${corner}`}
        label={`Change field ${index + 1}, now ${id}`}
        onPress={() => g.go({ type: 'modal', modal: { kind: 'fieldPicker', where, index } })}
      >
        <span class="gtn-field-label">{id}</span>
      </Key>
    );
  }
  if (id === 'OFF') return null;
  return <DataField class={`gtn-userfield gtn-corner-${corner}`} label={f.label} value={f.value} unit={f.unit} tone={f.tone} />;
}

function SelectionBanner({ g, w }: { g: Gtn; w: Waypoint }) {
  const a = g.state.aircraft;
  const brg = g.mag.toMagnetic(bearing(a, w), a.lat, a.lon);
  return (
    <button type="button" class="gtn-map-banner" onClick={() => openWaypointInfo(g, w)} aria-label={`${w.ident}: open waypoint information`}>
      <span class="gtn-ident gtn-cyan">{w.ident}</span>
      <span class="gtn-map-banner-name">{w.name}</span>
      <span>
        {formatBearing(brg)} {formatDistance(distanceNm(a, w))}
        <small>NM</small>
      </span>
    </button>
  );
}

function MapBody({ g, showCdi }: { g: Gtn; showCdi: boolean }) {
  const { w, h } = g.box;
  const picture = movingMapPicture(g, h);
  const fields = g.settings.mapFields;
  return (
    <div class="gtn-map">
      <div
        class="gtn-map-canvas"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const scale = r.width / w;
          const hit = pick(g, picture, w, h, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
          g.set({ type: 'mapSelect', waypoint: hit });
        }}
        onWheel={(e) => {
          e.preventDefault();
          if (Math.abs(e.deltaY) > 2) g.set({ type: 'zoom', steps: e.deltaY > 0 ? 1 : -1 });
        }}
      >
        <MapCanvas w={w} h={h} picture={picture} version={mapVersion(picture, w, h, g.state.fms.revision)} label="Moving map" />
      </div>
      {fields.map((id, i) => (
        <CornerField key={i} g={g} id={id} index={i} where="map" />
      ))}
      <NorthIndicator g={g} />
      {g.settings.mapSelection && <SelectionBanner g={g} w={g.settings.mapSelection} />}
      {showCdi && <CdiBar g={g} class="gtn-map-cdi" />}
    </div>
  );
}

export function mapView(g: Gtn): PageView {
  const zoom = (steps: number) => g.set({ type: 'zoom', steps });
  return {
    body: <MapBody g={g} showCdi={g.model === '750'} />,
    controls: {
      menu: () => g.go({ type: 'modal', modal: { kind: 'mapMenu' } }),
      cdiObs: g.model === '750',
      zoom: true,
      ...(g.settings.editingFields === 'map' && { onBack: () => g.set({ type: 'editFields', page: null }) }),
    },
    // Small knob clockwise zooms in.
    knob: { inner: (n) => zoom(-n), innerIcon: 'zoom' },
  };
}

// Default Navigation (650Xi) ------------------------------------------------------

function DefaultNavBody({ g }: { g: Gtn }) {
  const editing = g.settings.editingFields === 'nav';
  return (
    <div class="gtn-defnav">
      <CdiBar g={g} class="gtn-defnav-cdi" />
      <div class="gtn-defnav-fields">
        {g.settings.navFields.map((id, i) => {
          const f = fieldValue(id, g);
          return (
            <Key
              key={i}
              class={`gtn-defnav-field${editing ? ' is-editing' : ''}`}
              label={`${id} ${f.value}${editing ? ', tap to change' : ''}`}
              onPress={() => editing && g.go({ type: 'modal', modal: { kind: 'fieldPicker', where: 'nav', index: i } })}
            >
              <span class="gtn-field-label">{id === 'OFF' ? '' : id}</span>
              <span class={`gtn-field-value gtn-${f.tone}`}>
                {f.value}
                {f.unit && <small>{f.unit}</small>}
              </span>
            </Key>
          );
        })}
      </div>
    </div>
  );
}

export function defaultNavView(g: Gtn, _page: Extract<Page, { kind: 'defaultNav' }>): PageView {
  return {
    title: 'Default Navigation',
    body: <DefaultNavBody g={g} />,
    controls: {
      menu: () => g.go({ type: 'modal', modal: { kind: 'navMenu' } }),
      cdiObs: true,
      ...(g.settings.editingFields === 'nav' && { onBack: () => g.set({ type: 'editFields', page: null }) }),
    },
    knob: {},
  };
}
