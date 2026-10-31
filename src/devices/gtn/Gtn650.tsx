import type { DeviceProps } from '../types';
import { GtnUnit } from './GtnUnit';

/** Garmin GTN 650Xi: the wide 6.25 x 2.65 in unit. */
export function Gtn650({ panel }: DeviceProps) {
  return <GtnUnit model="650" panel={panel} />;
}

export default Gtn650;
