import { NO_AIRSPACE, type AirspaceSource } from './airspace';

/** public/data/airspace.json: { v: 1, items: [[cls, name, lowerFt, upperFt, ring]] } */
export interface RawAirspace {
  readonly v: 1;
  readonly items: readonly [string, string, number, number, number[]][];
}

/** Builds the airspace query structure. Implemented with the airspace pipeline. */
export function createAirspaceSource(_raw: RawAirspace | null): AirspaceSource {
  return NO_AIRSPACE;
}
