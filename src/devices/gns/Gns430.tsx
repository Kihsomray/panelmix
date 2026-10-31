import type { DeviceProps } from '../types';
import { GnsUnit } from './GnsUnit';

/** Garmin GNS 430W: GPS/NAV/COM, 6.25 x 2.65 in bezel, 240 x 128 LCD. */
export default function Gns430(props: DeviceProps) {
  return <GnsUnit {...props} model="430" />;
}
