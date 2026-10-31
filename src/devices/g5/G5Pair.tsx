import { useState } from 'preact/hooks';
import { useSim } from '../../sim/hooks';
import type { DeviceProps } from '../types';
import './g5.css';
import { G5Unit, UNIT_H } from './G5Unit';
import { INITIAL_SHARED, type G5Shared } from './menu';
import { SharedDefs } from './Overlays';

/*
 * The common G5 retrofit: one G5 as the attitude indicator in the six-pack's
 * top center hole and a second one below it as the HSI. Both units are the
 * same instrument; only the page each starts on differs, and either can show
 * the other's page from its menu (the backup the real pair provides). ESP
 * is a system setting, so the pair holds it for both units; GPS steering
 * lives in the shared autopilot state.
 */

/** Space between the two instrument holes. */
const UNIT_GAP = 16;

export function G5Pair({ panel }: DeviceProps) {
  const { state, derived } = useSim();
  const [shared, setShared] = useState<G5Shared>(INITIAL_SHARED);
  const common = { state, derived, panel, shared, onShared: setShared };
  return (
    <div class="g5-pair">
      <SharedDefs />
      <G5Unit id="g5-adi" y={0} initialPage="pfd" label="G5 attitude indicator" {...common} />
      <G5Unit id="g5-hsi" y={UNIT_H + UNIT_GAP} initialPage="hsi" label="G5 HSI" {...common} />
    </div>
  );
}

export default G5Pair;
