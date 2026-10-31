import { devicesFor } from '../devices/registry';
import type { Slot } from '../devices/types';
import { apChoices, PRESETS, xpdrChoices, type PanelConfig } from './panels';

/*
 * The dropdowns that build the panel. Native selects: they're the best
 * picker on every phone.
 */

const SLOT_LABELS: Record<Slot, string> = {
  pfd: 'Flight instruments (PFD)',
  nav: 'GPS / navigator (MFD)',
  xpdr: 'Transponder',
  ap: 'Autopilot',
};

export function PanelPicker({
  config,
  onChange,
  onPreset,
}: {
  config: PanelConfig;
  onChange: (slot: Slot, id: string) => void;
  onPreset: (id: string) => void;
}) {
  const preset = PRESETS.find(
    (p) => p.config.pfd === config.pfd && p.config.nav === config.nav && p.config.xpdr === config.xpdr && p.config.ap === config.ap,
  );
  const deviceOptions = (slot: Slot) =>
    devicesFor(slot).map((d) => (
      <option key={d.id} value={d.id}>
        {d.maker === 'Analog' ? d.name : `${d.maker} ${d.name}`}
      </option>
    ));

  return (
    <div class="picker">
      <label class="picker-field picker-preset">
        <span>Popular panels</span>
        <select value={preset?.id ?? ''} onChange={(e) => onPreset((e.currentTarget as HTMLSelectElement).value)}>
          <option value="" disabled>
            Custom mix
          </option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label class="picker-field">
        <span>{SLOT_LABELS.pfd}</span>
        <select value={config.pfd} onChange={(e) => onChange('pfd', (e.currentTarget as HTMLSelectElement).value)}>
          {deviceOptions('pfd')}
        </select>
      </label>
      <label class="picker-field">
        <span>{SLOT_LABELS.nav}</span>
        <select value={config.nav} onChange={(e) => onChange('nav', (e.currentTarget as HTMLSelectElement).value)}>
          {deviceOptions('nav')}
        </select>
      </label>
      <label class="picker-field">
        <span>{SLOT_LABELS.xpdr}</span>
        <select value={config.xpdr} onChange={(e) => onChange('xpdr', (e.currentTarget as HTMLSelectElement).value)}>
          {xpdrChoices(config).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label class="picker-field">
        <span>{SLOT_LABELS.ap}</span>
        <select value={config.ap} onChange={(e) => onChange('ap', (e.currentTarget as HTMLSelectElement).value)}>
          {apChoices(config).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
