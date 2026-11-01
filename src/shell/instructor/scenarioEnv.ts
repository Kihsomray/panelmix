import { distanceNm } from '../../core/geo';
import type { MagneticModel } from '../../core/magvar';
import { NavDatabase, type Waypoint } from '../../core/navdb';
import { shortApproachName, type AirportProcedures, type Approach, type ProcFix } from '../../core/procedures';
import type { ScenarioEnv } from './scenario';

/*
 * Database lookups the scenario planner needs, kept out of scenario.ts so
 * the placement math stays pure and testable on hand-built procedures.
 */

/** The flight plan waypoint for a procedure fix: the database record when there is one at that spot. */
export function procFixWaypoint(db: NavDatabase, fix: ProcFix): Waypoint {
  const rec = db.get(fix.ident, fix);
  if (rec && distanceNm(rec, fix) < 1) return NavDatabase.toWaypoint(rec);
  const kind = fix.kind === 'vor' || fix.kind === 'ndb' || fix.kind === 'airport' ? fix.kind : 'fix';
  return { kind, ident: fix.ident, name: fix.ident, lat: fix.lat, lon: fix.lon };
}

export function scenarioEnv(db: NavDatabase, mag: MagneticModel, approach: Approach, qnhInHg: number): ScenarioEnv {
  const loc = approach.localizer ? db.localizer(approach.localizer) : undefined;
  return {
    mag,
    qnhInHg,
    localizer: loc ? { ident: loc.ident, freqKhz: loc.freqKhz, courseMag: loc.courseMag } : null,
    waypoint: (fix) => procFixWaypoint(db, fix),
  };
}

/** An approach by CIFP id ("R17") or Garmin short name ("RNAV 17"). */
export function findApproach(procs: AirportProcedures | null | undefined, key: string): Approach | undefined {
  return procs?.approaches.find((a) => a.id === key) ?? procs?.approaches.find((a) => shortApproachName(a) === key);
}
