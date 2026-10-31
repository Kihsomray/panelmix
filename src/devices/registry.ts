import { gfc500Spec, kap140Spec } from './autopilot/spec';
import { aspenSpec } from './aspen/spec';
import { g1000MfdSpec, g1000PfdSpec } from './g1000/spec';
import { g5Spec } from './g5/spec';
import { gns430Spec, gns530Spec } from './gns/spec';
import { gtn650Spec, gtn750Spec } from './gtn/spec';
import { steamSpec } from './steam/spec';
import type { DeviceSpec, Slot } from './types';
import { gtx345Spec, kt76aSpec } from './xpdr/spec';

/** Every unit the trainer offers, in picker order within each slot. */
export const DEVICES: readonly DeviceSpec[] = [
  steamSpec,
  g5Spec,
  aspenSpec,
  g1000PfdSpec,
  gns430Spec,
  gns530Spec,
  gtn650Spec,
  gtn750Spec,
  g1000MfdSpec,
  gtx345Spec,
  kt76aSpec,
  kap140Spec,
  gfc500Spec,
];

const byId = new Map(DEVICES.map((d) => [d.id, d]));

export function device(id: string): DeviceSpec | undefined {
  return byId.get(id);
}

export function devicesFor(slot: Slot): DeviceSpec[] {
  return DEVICES.filter((d) => d.slot === slot);
}
