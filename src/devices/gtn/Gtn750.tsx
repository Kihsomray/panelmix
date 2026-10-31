import type { DeviceProps } from '../types';
import { GtnUnit } from './GtnUnit';

/** Garmin GTN 750Xi: the portrait 6.25 x 6.00 in unit. */
export function Gtn750({ panel }: DeviceProps) {
  return <GtnUnit model="750" panel={panel} />;
}

export default Gtn750;
