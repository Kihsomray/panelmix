import { NO_AIRSPACE, type AirspaceSource } from '../core/airspace';
import { distanceNm, norm360 } from '../core/geo';
import type { MagneticModel } from '../core/magvar';
import type { NavDatabase } from '../core/navdb';
import type { ProcedureSource } from '../core/procedures';
import { NO_TERRAIN, type TerrainProvider } from '../core/terrain';
import { densityAltitude, densityRatio, indicatedAltitude, outsideAirTempC, pressureAltitude, STD_INHG } from './atmosphere';
import { guidance } from './autopilot';
import { applyCommand, type SimCommand } from './commands';
import { stepFlight } from './flight';
import { approachDerived, fmsSteering, gpsSolution, sequence, verticalDerived, type GpsSolution } from './fms';
import type { ApproachDerived, FmsSteering, VerticalDerived } from './fms/types';
import { bearingSolution, cdiSolution, vorSolution, type BearingSolution, type CdiSolution, type VorSolution } from './radionav';
import { computeSystems, stepSystems, type SystemsContext, type SystemsField } from './systems';
import type { SystemsDerived } from './systems/types';
import type { SimState } from './types';

/*
 * The simulator: owns the shared state, advances it in real time and
 * publishes it to every device. Values many devices need (the GPS solution,
 * both VOR receivers, the CDI picture) are computed once per state here
 * rather than in each display.
 */

export interface Derived {
  readonly magVar: number;
  readonly headingMag: number;
  readonly trackMag: number;
  readonly pressureAltitudeFt: number;
  /** Altitude shown by altimeters using the shared Kollsman setting (29.92 when STD). */
  readonly indicatedAltitudeFt: number;
  readonly densityAltitudeFt: number;
  readonly oatC: number;
  readonly sigma: number;
  readonly gps: GpsSolution;
  readonly vor: readonly [VorSolution, VorSolution];
  readonly cdi: CdiSolution;
  readonly bearing1: BearingSolution;
  readonly bearing2: BearingSolution;
  readonly flightDirector: { readonly bankDeg: number; readonly pitchDeg: number } | null;
  readonly stalled: boolean;
  readonly unreadMessages: number;
  /** Wind relative to the nose: headwind (+) / tailwind (-) and crosswind from the right (+). */
  readonly windComponents: { readonly headwindKt: number; readonly crosswindKt: number };
  /** Wind direction relative to the airplane's heading, for PFD wind vectors. */
  readonly windRelativeDeg: number;
  /** Indicated values (with failures), electrical, terrain and airspace awareness. */
  readonly systems: SystemsDerived;
  /** The loaded instrument approach, or null. */
  readonly approach: ApproachDerived | null;
  /** Vertical deviation (GPS glidepath or ILS glideslope), or null when there is no vertical path. */
  readonly vertical: VerticalDerived | null;
  /** What the FMS asks an autopilot in NAV to fly on the active leg. */
  readonly steering: FmsSteering | null;
}

/** Optional data sources beyond the navigation database. */
export interface SimProviders {
  readonly terrain?: TerrainProvider;
  readonly airspace?: AirspaceSource;
  readonly procedures?: ProcedureSource;
}

export type Listener = () => void;

/** Longest real-time step taken in one go; a stalled tab doesn't teleport the airplane. */
const MAX_FRAME_S = 0.1;
const SUBSTEP_S = 0.05;
const FLOOR_REFRESH_S = 2;

export class Simulator {
  private state: SimState;
  private derivedFor: SimState | null = null;
  private derivedValue: Derived | null = null;
  private readonly listeners = new Set<Listener>();
  private frame = 0;
  private lastFrameAt = 0;
  private floorFt = 0;
  /** The nearest airport, refreshed with the floor: TAWS terminal clearances and the landing inhibit. */
  private nearestField: SystemsField | null = null;
  private floorCheckedAt = -Infinity;
  private stalled = false;
  private lastStallMessageAt = -Infinity;

  readonly terrain: TerrainProvider;
  readonly airspace: AirspaceSource;
  readonly procedures: ProcedureSource | null;

  constructor(
    readonly db: NavDatabase,
    readonly mag: MagneticModel,
    initial: SimState,
    providers: SimProviders = {},
  ) {
    this.state = initial;
    this.terrain = providers.terrain ?? NO_TERRAIN;
    this.airspace = providers.airspace ?? NO_AIRSPACE;
    this.procedures = providers.procedures ?? null;
  }

  getState = (): SimState => this.state;

  getDerived = (): Derived => {
    if (this.derivedFor !== this.state || !this.derivedValue) {
      this.derivedValue = this.compute(this.state);
      this.derivedFor = this.state;
    }
    return this.derivedValue;
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch = (cmd: SimCommand): void => {
    const next = applyCommand(this.state, cmd, { mag: this.mag, db: this.db });
    if (next !== this.state) {
      this.state = next;
      this.emit();
    }
  };

  /** Replaces the whole state, e.g. to reset the session. */
  reset(next: SimState): void {
    this.state = next;
    this.emit();
  }

  start(): void {
    if (this.frame) return;
    this.lastFrameAt = performance.now();
    const loop = (now: number) => {
      const real = Math.min((now - this.lastFrameAt) / 1000, MAX_FRAME_S);
      this.lastFrameAt = now;
      if (!this.state.paused) {
        this.step(real * this.state.rate);
        this.emit();
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Advances the simulation by `seconds` of sim time. Public for tests and fast-forward. */
  step(seconds: number): void {
    let remaining = seconds;
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, SUBSTEP_S);
      this.state = this.advance(this.state, dt);
      remaining -= dt;
    }
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private advance(s: SimState, dt: number): SimState {
    const d = this.compute(s);
    const time = s.time + dt;

    // Hand flying: yoke input rolls and pitches the trimmed attitude; release holds it.
    let attitudeHold = s.attitudeHold;
    if (!s.ap.engaged && (s.controls.roll !== 0 || s.controls.pitch !== 0)) {
      attitudeHold = {
        bankDeg: Math.min(Math.max(attitudeHold.bankDeg + s.controls.roll * 20 * dt, -45), 45),
        pitchDeg: Math.min(Math.max(attitudeHold.pitchDeg + s.controls.pitch * 5 * dt, -20), 25),
      };
    }

    const g = guidance({
      state: { ...s, attitudeHold },
      headingMag: d.headingMag,
      trackMag: d.trackMag,
      sigma: d.sigma,
      cdi: d.cdi,
      gps: d.gps,
      vorDistanceNm: d.cdi.source === 'GPS' ? null : distanceToStation(d, s),
      steering: d.steering,
      vertical: d.vertical,
    });

    if (time - this.floorCheckedAt > FLOOR_REFRESH_S || time < this.floorCheckedAt) {
      const near = this.db.nearestAirports(s.aircraft, 1, {}, 8)[0];
      this.floorFt = near ? near.item.elevationFt : 0;
      this.nearestField = near ? near.item : null;
      this.floorCheckedAt = time;
    }

    const sys = stepSystems(s, dt, this.systemsContext(s, d));
    const { aircraft, stalled } = stepFlight(s.aircraft, g.targets, s.env, sys.effects, dt);
    let next: SimState = { ...s, time, aircraft, attitudeHold, ap: g.ap, systems: sys.systems };
    for (const m of sys.messages) next = applyCommand(next, { type: 'msg.post', text: m.text, level: m.level }, { mag: this.mag });

    // One STALL message per stall, not one per buffet: repeat only after 20 s of flying.
    if (stalled && !this.stalled && time - this.lastStallMessageAt > 20) {
      next = applyCommand(next, { type: 'msg.post', text: 'STALL', level: 'caution' }, { mag: this.mag });
      this.lastStallMessageAt = time;
    }
    this.stalled = stalled;

    // Without a GPS position the FMS can't tell where the airplane is along the route.
    if (d.systems.gpsValid) {
      const fms = sequence(next.fms, aircraft, aircraft.groundSpeedKt, {
        trackTrue: aircraft.trackTrue,
        altitudeFt: aircraft.altitudeFt,
        tasKt: aircraft.tasKt,
        time,
      });
      if (fms !== next.fms) next = { ...next, fms };
    }

    if (next.xpdr.identUntil !== null && time >= next.xpdr.identUntil) {
      next = { ...next, xpdr: { ...next.xpdr, identUntil: null } };
    }
    return next;
  }

  private compute(s: SimState): Derived {
    const a = s.aircraft;
    const magVar = this.mag.variation(a.lat, a.lon);
    const pAlt = pressureAltitude(a.altitudeFt, s.env.qnhInHg);
    const sigma = densityRatio(pAlt, s.env.isaDeviationC);
    const indicatedAltitudeFt = indicatedAltitude(a.altitudeFt, s.env.qnhInHg, s.bugs.baroStd ? STD_INHG : s.bugs.baroInHg);
    const oatC = outsideAirTempC(pAlt, s.env.isaDeviationC);
    const systems = computeSystems(s, {
      ...this.systemsContextBase(),
      indicatedAltitudeFt,
      headingMag: norm360(a.headingTrue - magVar),
      oatC,
    });
    // Navigation: the GPS solution and steering go invalid with the GPS (failure or no power).
    const gpsValid = systems.gpsValid;
    const gps = gpsSolution(s.fms, a, a.trackTrue, a.groundSpeedKt, this.mag, gpsValid);
    const vor: [VorSolution, VorSolution] = [
      vorSolution(this.db, s.radios.nav[0].activeKhz, a, a.altitudeFt, s.nav.obsMag[0]),
      vorSolution(this.db, s.radios.nav[1].activeKhz, a, a.altitudeFt, s.nav.obsMag[1]),
    ];
    const cdi = cdiSolution(s, gps, vor);
    const steering = fmsSteering(s, a, this.mag, gpsValid);
    const vertical = verticalDerived(s, a, this.mag, vor, gpsValid);
    const g = guidance({
      state: s,
      headingMag: norm360(a.headingTrue - magVar),
      trackMag: norm360(a.trackTrue - magVar),
      sigma,
      cdi,
      gps,
      vorDistanceNm: null,
      steering,
      vertical,
    });
    const windRelativeDeg = norm360(systems.windFromTrue - a.headingTrue);
    const rel = (windRelativeDeg * Math.PI) / 180;
    return {
      magVar,
      headingMag: norm360(a.headingTrue - magVar),
      trackMag: norm360(a.trackTrue - magVar),
      pressureAltitudeFt: pAlt,
      indicatedAltitudeFt,
      densityAltitudeFt: densityAltitude(pAlt, s.env.isaDeviationC),
      oatC,
      sigma,
      gps,
      vor,
      cdi,
      bearing1: bearingSolution(s.nav.bearing1, gps, vor),
      bearing2: bearingSolution(s.nav.bearing2, gps, vor),
      flightDirector: g.flightDirector,
      stalled: a.iasKt < 48,
      unreadMessages: s.messages.filter((m) => !m.read).length,
      windComponents: { headwindKt: systems.windKt * Math.cos(rel), crosswindKt: systems.windKt * Math.sin(rel) },
      windRelativeDeg,
      systems,
      approach: approachDerived(s, a, this.mag),
      vertical,
      steering,
    };
  }

  private systemsContextBase() {
    return { mag: this.mag, terrain: this.terrain, airspace: this.airspace, fieldElevationFt: this.floorFt, field: this.nearestField };
  }

  private systemsContext(_s: SimState, d: Derived): SystemsContext {
    return {
      ...this.systemsContextBase(),
      indicatedAltitudeFt: d.indicatedAltitudeFt,
      headingMag: d.headingMag,
      oatC: d.oatC,
      // Already computed for this state: stepSystems reuses it instead of recomputing.
      derived: d.systems,
    };
  }
}

/** Distance to the VOR or localizer antenna the CDI shows. */
function distanceToStation(d: Derived, s: SimState): number | null {
  const v = d.vor[s.nav.cdiSource === 'NAV1' ? 0 : 1];
  if (v.distanceNm !== undefined) return v.distanceNm;
  return v.station ? distanceNm(s.aircraft, v.station) : null;
}
