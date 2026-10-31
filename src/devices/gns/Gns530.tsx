import type { DeviceProps } from '../types';
import { GnsUnit } from './GnsUnit';

/** Garmin GNS 530W: the 430W's functions with a 320 x 234 LCD, a VNAV key and a map on the default NAV page. */
export default function Gns530(props: DeviceProps) {
  return <GnsUnit {...props} model="530" />;
}
