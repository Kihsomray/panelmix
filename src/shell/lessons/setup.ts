import { bearing, destination, type LatLon } from '../../core/geo';
import { NavDatabase, type Waypoint } from '../../core/navdb';
import type { PanelInfo } from '../../devices/types';
import type { SimCommand } from '../../sim/commands';
import type { SimState } from '../../sim/types';
import type { BooleanFailure, FailureAction } from '../instructor/failures';
import { planScenario } from '../instructor/scenario';
import { findApproach, scenarioEnv } from '../instructor/scenarioEnv';
import type { LessonEnv, SetupAction } from './types';

/*
 * Turns a lesson's set-up actions into simulator commands, plus failures to
 * schedule for later. Pure given the database and the procedures already
 * loaded (the caller loads the airports from `setupAirports` first).
 */

export interface SetupResult {
  readonly commands: readonly SimCommand[];
  /** Failures to hand to the instructor's schedule, as surprises happening within `withinSec`. */
  readonly failures: readonly { readonly action: FailureAction; readonly delaySec: number; readonly withinSec: number }[];
  /** What couldn't be set up (a missing navaid or procedure). */
  readonly problems: readonly string[];
}

/** The attitude source that fails on this panel: the vacuum pump for steam gauges, the AHRS for glass. */
export function attitudeFailure(panel: PanelInfo): BooleanFailure {
  return panel.pfd === 'steam' ? 'vacuum' : 'ahrs';
}

/** Airports whose procedure files must be loaded before `resolveSetup`. */
export function setupAirports(actions: readonly SetupAction[]): string[] {
  return [...new Set(actions.flatMap((a) => (a.kind === 'scenario' ? [a.airport] : [])))];
}

export function resolveSetup(actions: readonly SetupAction[], env: LessonEnv, state: SimState, random: () => number = Math.random): SetupResult {
  const commands: SimCommand[] = [];
  const failures: { action: FailureAction; delaySec: number; withinSec: number }[] = [];
  const problems: string[] = [];
  // Follow what earlier actions change, so later ones look things up from the new position and plan.
  let here: LatLon = state.aircraft;
  let plan: readonly Waypoint[] = state.fms.plan;
  let qnh = state.env.qnhInHg;

  const lookup = (ident: string): Waypoint | null => {
    const w = env.db.get(ident, here);
    if (!w) problems.push(`${ident} is not in the database.`);
    return w ? NavDatabase.toWaypoint(w) : null;
  };

  for (const a of actions) {
    switch (a.kind) {
      case 'commands':
        commands.push(...a.commands);
        for (const c of a.commands) if (c.type === 'sim.qnh') qnh = c.inHg;
        break;
      case 'position': {
        const ref = env.db.get(a.from, here);
        if (!ref) {
          problems.push(`${a.from} is not in the database.`);
          break;
        }
        // Radials are referenced to a navaid's own declination; elsewhere use today's variation.
        const variation = 'magVar' in ref ? ref.magVar : env.mag.variation(ref.lat, ref.lon);
        const pos = a.distanceNm > 0 ? destination(ref, a.radialMag + variation, a.distanceNm) : ref;
        const headingTrue = a.headingMag === 'toward' ? bearing(pos, ref) : env.mag.toTrue(a.headingMag, pos.lat, pos.lon);
        commands.push(
          { type: 'sim.reposition', lat: pos.lat, lon: pos.lon, altitudeFt: a.altitudeFt, headingTrue, iasKt: a.iasKt ?? 105 },
          // A repositioned airplane starts with its altimeter set.
          { type: 'baro.set', inHg: qnh },
        );
        here = pos;
        break;
      }
      case 'plan': {
        const wps = a.idents.map(lookup);
        if (wps.some((w) => !w)) break;
        plan = wps as Waypoint[];
        commands.push({ type: 'fms.removeApproach' }, { type: 'fms.cancelDirectTo' }, { type: 'fms.replacePlan', plan });
        break;
      }
      case 'directTo': {
        const w = lookup(a.ident);
        if (!w) break;
        const i = plan.findIndex((p) => p.ident === w.ident);
        commands.push({ type: 'fms.directTo', waypoint: w, planIndex: i >= 0 ? i : null });
        break;
      }
      case 'scenario': {
        const procs = env.procedures?.get(a.airport) ?? null;
        const approach = findApproach(procs, a.approach);
        const airport = env.db.airport(a.airport);
        if (!airport || !approach) {
          problems.push(`The ${a.approach} approach at ${a.airport} is not in the procedure database.`);
          break;
        }
        const result = planScenario(
          {
            airport: NavDatabase.toWaypoint(airport),
            fieldElevationFt: airport.elevationFt,
            procedures: procs,
            approach,
            transition: a.transition,
            start: a.start,
            load: a.load,
            autopilot: a.autopilot,
            setAltimeter: true,
            ...(a.tuneLocalizer !== undefined && { tuneLocalizer: a.tuneLocalizer }),
          },
          scenarioEnv(env.db, env.mag, approach, qnh),
        );
        if ('error' in result) {
          problems.push(result.error);
          break;
        }
        commands.push(...result.commands);
        problems.push(...result.notes);
        here = result.start;
        plan = [NavDatabase.toWaypoint(airport)];
        break;
      }
      case 'failure': {
        const failure = a.failure === 'attitude' ? attitudeFailure(env.panel) : a.failure;
        const [min, max] = a.delaySec;
        const delaySec = min + random() * Math.max(max - min, 0);
        const action: FailureAction = { kind: 'fail', failure, failed: true };
        if (delaySec <= 0) commands.push({ type: 'failure.set', failure, failed: true });
        else failures.push({ action, delaySec, withinSec: Math.max(max, delaySec) });
        break;
      }
    }
  }
  return { commands, failures, problems };
}
