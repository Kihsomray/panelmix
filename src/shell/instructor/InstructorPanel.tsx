import type { PanelInfo } from '../../devices/types';
import { useSessionState } from '../context';
import { FailuresTab } from './FailuresTab';
import { ScenarioTab } from './ScenarioTab';
import { WeatherTab } from './WeatherTab';

/*
 * The instructor station: failures, weather and scenario starts, in the
 * drawer beside Fly.
 */

type Section = 'failures' | 'weather' | 'scenario';

const SECTIONS: readonly { readonly id: Section; readonly name: string }[] = [
  { id: 'failures', name: 'Failures' },
  { id: 'weather', name: 'Weather' },
  { id: 'scenario', name: 'Scenario' },
];

export function InstructorPanel({ panel }: { panel: PanelInfo }) {
  const [section, setSection] = useSessionState<Section>('ins.section', 'failures');
  return (
    <div class="drawer-body ins">
      <div class="seg ins-tabs" role="tablist" aria-label="Instructor station">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`ins-tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls="ins-panel"
            onClick={() => setSection(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div id="ins-panel" role="tabpanel" aria-labelledby={`ins-tab-${section}`}>
        {section === 'failures' && <FailuresTab panel={panel} />}
        {section === 'weather' && <WeatherTab />}
        {section === 'scenario' && <ScenarioTab />}
      </div>
    </div>
  );
}
