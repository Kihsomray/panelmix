import type { JSX } from 'preact';
import { openWaypointInfo, setActive, setStandby } from './actions';
import type { Gtn } from './context';
import { FIELD_IDS, FIELD_NAMES } from './fields';
import { gtnFreq } from './format';
import type { Modal } from './model';
import { addWaypoint } from './pages/flightPlan';
import { airportFrequencyChoices, chooseFindFrequency } from './pages/radio';
import type { MapOrientation } from './settings';
import { InertKey, Key, Popup } from './ui';

/*
 * Pop-up menus over the page: flight plan waypoint options, the flight plan
 * and map menus, confirmations, frequency loading and the user-field picker.
 * Options the trainer cannot perform are drawn grayed, as the real unit
 * grays what is unavailable.
 */

const close = (g: Gtn) => g.go({ type: 'modal', modal: null });

function WaypointOptions({ g, index }: { g: Gtn; index: number }) {
  const w = g.state.fms.plan[index];
  if (!w) return null;
  const run = (fn: () => void) => () => {
    close(g);
    fn();
  };
  return (
    <Popup title={`${w.ident} Options`} class="gtn-menu">
      <div class="gtn-menu-grid">
        <Key onPress={run(() => g.dispatch({ type: 'fms.activateLeg', index }))}>Activate Leg</Key>
        <Key onPress={run(() => addWaypoint(g, index))}>Insert Before</Key>
        <Key onPress={run(() => addWaypoint(g, index + 1))}>Insert After</Key>
        <InertKey note="Along-track offsets are not simulated">Along Track</InertKey>
        <InertKey note="Holds are not simulated">Hold at Waypoint</InertKey>
        <InertKey note="Charts are not in the trainer database">View Charts</InertKey>
        <InertKey note="Procedures are not in the trainer database">Load Procedure</InertKey>
        <InertKey note="Search and rescue patterns are not simulated">Load SAR</InertKey>
        <Key onPress={run(() => openWaypointInfo(g, w))}>Waypoint Info</Key>
        <InertKey note="Airways are not in the trainer database">Load Airway</InertKey>
        <Key class="gtn-key-warn" onPress={() => g.go({ type: 'modal', modal: { kind: 'confirm', action: 'removeWpt', index } })}>
          Remove
        </Key>
      </div>
    </Popup>
  );
}

function FlightPlanMenu({ g }: { g: Gtn }) {
  const empty = g.state.fms.plan.length === 0;
  return (
    <Popup title="Flight Plan Menu" class="gtn-menu">
      <div class="gtn-menu-grid">
        <InertKey note="Stored flight plans are not simulated">Catalog</InertKey>
        <Key disabled={empty} onPress={() => g.go({ type: 'modal', modal: { kind: 'confirm', action: 'deleteFpl', index: -1 } })}>
          Delete
        </Key>
        <Key
          disabled={empty}
          onPress={() => {
            g.dispatch({ type: 'fms.invert' });
            close(g);
          }}
        >
          Invert
        </Key>
        <InertKey note="Parallel track is not simulated">Parallel Track</InertKey>
        <InertKey note="The columns are fixed in the trainer">Edit Data Fields</InertKey>
        <InertKey note="Airways are not in the trainer database">Collapse All Airways</InertKey>
      </div>
    </Popup>
  );
}

function Confirm({ g, m }: { g: Gtn; m: Extract<Modal, { kind: 'confirm' }> }) {
  const w = g.state.fms.plan[m.index];
  const text = m.action === 'deleteFpl' ? 'Delete the active flight plan?' : `Remove ${w?.ident ?? 'waypoint'} from the flight plan?`;
  const ok = () => {
    if (m.action === 'deleteFpl') g.dispatch({ type: 'fms.clear' });
    else g.dispatch({ type: 'fms.remove', index: m.index });
    close(g);
  };
  return (
    <Popup title="Confirm" class="gtn-confirm">
      <p>{text}</p>
      <div class="gtn-confirm-keys">
        <Key onPress={() => close(g)}>Cancel</Key>
        <Key class="gtn-key-ok" onPress={ok}>
          OK
        </Key>
      </div>
    </Popup>
  );
}

function LoadFrequency({ g, m }: { g: Gtn; m: Extract<Modal, { kind: 'loadFreq' }> }) {
  const radio = m.band === 'com' ? 'COM' : 'NAV';
  const load = (fn: () => void) => () => {
    fn();
    close(g);
  };
  return (
    <Popup title={`${m.label} ${gtnFreq(m.band, m.khz)}`} class="gtn-confirm">
      <p>Load the frequency into {radio}:</p>
      <div class="gtn-confirm-keys">
        <Key onPress={load(() => setActive(g, m.band, m.khz))}>{radio} Active</Key>
        <Key class="gtn-key-ok" onPress={load(() => setStandby(g, m.band, m.khz))}>
          {radio} Standby
        </Key>
      </div>
    </Popup>
  );
}

function FrequencyList({ g, ident }: { g: Gtn; ident: string }) {
  return (
    <Popup title={`${ident} Frequencies`} class="gtn-menu">
      <div class="gtn-menu-list">
        {airportFrequencyChoices(g, ident).map((f, i) => (
          <Key key={`${f.khz}-${i}`} onPress={() => chooseFindFrequency(g, f.khz)}>
            {f.label}
          </Key>
        ))}
      </div>
    </Popup>
  );
}

const ORIENTATIONS: readonly { id: MapOrientation; label: string }[] = [
  { id: 'north', label: 'North Up' },
  { id: 'track', label: 'Track Up' },
  { id: 'heading', label: 'Heading Up' },
];
const DETAIL = ['All', '-1', '-2', '-3'];

function MapMenu({ g }: { g: Gtn }) {
  const s = g.settings;
  const next = ORIENTATIONS[(ORIENTATIONS.findIndex((o) => o.id === s.orientation) + 1) % ORIENTATIONS.length]!;
  return (
    <Popup title="Map Menu" class="gtn-menu">
      <div class="gtn-menu-grid">
        <Key class="gtn-setting-key" label={`Orientation ${s.orientation}. Tap to change.`} onPress={() => g.set({ type: 'orientation', orientation: next.id })}>
          <span class="gtn-opt-label">Orientation</span>
          <span class="gtn-opt-value">{ORIENTATIONS.find((o) => o.id === s.orientation)!.label}</span>
        </Key>
        <Key class="gtn-setting-key" label={`Detail ${DETAIL[s.detail]}. Tap to change.`} onPress={() => g.set({ type: 'detail' })}>
          <span class="gtn-opt-label">Detail</span>
          <span class="gtn-opt-value">{DETAIL[s.detail]}</span>
        </Key>
        <Key
          onPress={() => {
            g.set({ type: 'editFields', page: 'map' });
            close(g);
          }}
        >
          Change User Fields
        </Key>
        <Key
          onPress={() => {
            g.set({ type: 'restoreMapFields' });
            close(g);
          }}
        >
          Restore User Fields
        </Key>
        <InertKey note="Topographic data is not in the trainer" class="gtn-function-off">
          TOPO
        </InertKey>
        <InertKey note="Terrain data is not in the trainer" class="gtn-function-off">
          Terrain
        </InertKey>
        <InertKey note="Traffic is not simulated" class="gtn-function-off">
          Traffic
        </InertKey>
        <InertKey note="Datalink weather is not simulated" class="gtn-function-off">
          NEXRAD
        </InertKey>
      </div>
    </Popup>
  );
}

function NavMenu({ g }: { g: Gtn }) {
  return (
    <Popup title="Default Navigation Menu" class="gtn-menu">
      <div class="gtn-menu-grid">
        <Key
          onPress={() => {
            g.set({ type: 'editFields', page: 'nav' });
            close(g);
          }}
        >
          Configure User Fields
        </Key>
        <Key
          onPress={() => {
            g.set({ type: 'restoreNavFields' });
            close(g);
          }}
        >
          Restore Defaults
        </Key>
      </div>
    </Popup>
  );
}

function FieldPicker({ g, m }: { g: Gtn; m: Extract<Modal, { kind: 'fieldPicker' }> }) {
  const current = m.where === 'map' ? g.settings.mapFields[m.index] : g.settings.navFields[m.index];
  return (
    <Popup title="Select Data Field" class="gtn-menu gtn-field-picker">
      <div class="gtn-menu-list">
        {FIELD_IDS.map((id) => (
          <Key
            key={id}
            selected={id === current}
            label={FIELD_NAMES[id]}
            onPress={() => {
              g.set(m.where === 'map' ? { type: 'mapField', index: m.index, field: id } : { type: 'navField', index: m.index, field: id });
              g.set({ type: 'editFields', page: null });
              close(g);
            }}
          >
            <span class="gtn-picker-id">{id}</span>
            <span class="gtn-picker-name">{FIELD_NAMES[id]}</span>
          </Key>
        ))}
      </div>
    </Popup>
  );
}

export function ModalView({ g, modal }: { g: Gtn; modal: Modal }): JSX.Element | null {
  switch (modal.kind) {
    case 'wptOptions':
      return <WaypointOptions g={g} index={modal.index} />;
    case 'fplMenu':
      return <FlightPlanMenu g={g} />;
    case 'confirm':
      return <Confirm g={g} m={modal} />;
    case 'loadFreq':
      return <LoadFrequency g={g} m={modal} />;
    case 'freqList':
      return <FrequencyList g={g} ident={modal.ident} />;
    case 'mapMenu':
      return <MapMenu g={g} />;
    case 'navMenu':
      return <NavMenu g={g} />;
    case 'fieldPicker':
      return <FieldPicker g={g} m={modal} />;
  }
}
