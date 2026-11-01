# v2 for device builders: what to call and what to read

The shared simulator now flies real instrument procedures (FAA CIFP), models localizers and
glideslopes, GPS approach scaling and glidepaths, holds and SUSP, system failures, the electrical bus,
winds aloft, turbulence, terrain and airspace. Every unit must now present all of it the way the real
unit does. Read docs/DEVICE_GUIDE.md and docs/V2_CONTRACT.md for the rules and the stack.

Testing hook: in development builds `globalThis.__panelmix` is the `Simulator`
(`__panelmix.dispatch(cmd)`, `__panelmix.getState()`, `__panelmix.getDerived()`), so Playwright tests
can set up scenarios directly. The shell's Instructor panel also starts approach scenarios
(airport, approach, transition, start position) and Lessons have "Do it for me" steps.

## Procedures

- Source: `useSim().procedures` (`ProcedureSource`: `has(ident)`, `get(ident)` = undefined while loading
  / null if none / `AirportProcedures`, `load(ident)`, `subscribe(fn)`). Data model in
  `src/core/procedures.ts`: `AirportProcedures { runways, approaches, departures, arrivals }`,
  `Approach { id, type, name (chart style), runway, minima, transitions, final, missed, localizer, path }`.
  `shortApproachName(a)` gives "RNAV 17", "ILS 16L", "VOR-A".
- Load / activate (commands in `src/sim/commands.ts`):
  - `{ type: 'fms.loadApproach', airport: Waypoint, approach, transition: string | null, activate: 'load' | 'activate' | 'vtf' }`
  - `{ type: 'fms.activateApproach', vectorsToFinal: boolean }`, `{ type: 'fms.removeApproach' }`
  - `{ type: 'fms.activateApproachLeg', index }` (activate a leg of the approach), `{ type: 'fms.activateMissed' }`
  - `{ type: 'fms.unsuspend' }` (SUSP), `{ type: 'fms.hold', waypoint, inboundCourseMag, turn, legTimeMin, legNm }`, `{ type: 'fms.exitHold' }`
  - `{ type: 'fms.directTo', waypoint, planIndex?, courseMag? }`: direct-to an approach fix activates the approach from that fix.
  - Departures/arrivals: data is in `AirportProcedures.departures/arrivals`; loading SIDs/STARs is not
    modelled by the FMS yet: show them on PROC pages and insert their fixes into the enroute plan with
    `fms.insert` if you offer loading (say so in the unit's help).
- Flight plan pages: `state.fms.approach` (`LoadedApproach { airport, approach, transition, legs: RouteLeg[], vectorsToFinal, activated }`),
  each `RouteLeg { path, to, label, role (IAF/IF/FAF/MAP/MAHP), segment (transition/final/missed), altitude, courseMag, turn, distanceNm, legTimeMin, verticalAngleDeg, flyover }`.
  `approachLegs(state.fms, pos, mag)` (from `src/sim/fms`) gives per-leg course, distance, cumulative distance and the active flag.
  `buildApproachLegs` and `approachMode(approach)` (`src/sim/fms/procedure.ts`) preview an approach before loading.
- Annunciation: `derived.approach` (`ApproachDerived`): `name`, `mode` (LPV, LP, LP+V, L/VNAV, LNAV+V, LNAV, ILS, LOC, VOR, NDB),
  `phase` (DPRT, TERM, ENR, APR, MAPR), `activated`, `vectorsToFinal`, `suspended`, `holding`,
  `activeLegIndex`, `fafIndex`, `mapIndex`, `missedIndex`, distances to FAF / MAP / threshold, `fullScaleNm`.
  `derived.gps`: `scale` (ENR, TERM, APR, MAPR, OBS), `phase`, `valid`, `legLabel`, plus everything it had.
- Vertical: `derived.vertical` (`VerticalDerived`): `source` GP (GPS glidepath) or GS (ILS glideslope),
  `advisory` (+V), `needle` (-1..1, positive = path above = fly up), `deviationFt`, `fullScaleFt`,
  `pathAltitudeFt`, `distanceNm`, `valid`. Garmin convention: magenta diamond for GP, green diamond for GS.
- CDI: `derived.cdi.kind` (GPS, VOR, LOC, ILS), `label` (GPS, VOR1, LOC1, ILS1), `fullScaleDeg`,
  `backCourse`; per receiver `derived.vor[i].localizer`, `.glideslope`, `.distanceNm`.
  Localizer course is the published course whatever the OBS. Tune ILS/LOC: `db.localizer(ident)`.
- Autopilot: `state.ap.approach` (APR selected), `state.ap.verticalArmed === 'GS'` (GS/GP armed, white),
  `state.ap.vertical === 'GS'` (GS/GP active, green; tell GP from GS with `derived.vertical.source`),
  `state.ap.lateralArmed === 'NAV'`. Commands `ap.approach {on}`, `ap.armGlidepath {on}`, `ap.vertical {mode:'GS'}` (arms).
- Fixes and airways: `db.fixes` (kind `fix`, `region` ENRT or airport) are in `db.find/complete/search`;
  `db.airwaysAt(ident)`, `db.airway(name)`.

## Systems and failures (`derived.systems`)

- `air` {valid, iasKt, altitudeFt, verticalSpeedFpm, tasKt, oatC, pressureAltitudeFt}: what pitot-static
  instruments show (blocked pitot/static give wrong values with no flag; ADC failure sets `valid` false
  for glass air data: red X on the tapes).
- `attitude` {valid, pitchDeg, bankDeg, slip, turnRateDps, headingValid, headingMag}: the AHRS (glass
  units). AHRS failure: red X on attitude and heading.
- `vacuum` {suctionInHg, rigidity, pitchDeg, bankDeg, headingErrorDeg}: analog attitude indicator and
  heading indicator (steam). Command `systems.alignHeadingIndicator` when the pilot realigns the DG.
- `turnCoordinator` {powered, turnRateDps, slip} (OFF flag when unpowered).
- `electrical` {busVolts, batteryAmps, batteryCharge, avionicsPowered, alternatorFailed, alternatorOnline, batteryMinutes}:
  when `avionicsPowered` is false, units without their own battery go dark (G5 and Aspen have internal
  batteries and keep running, showing it; GTN, GNS, G1000, transponders, KAP 140 and GFC 500 servos lose power).
- `terrain` {elevationFt, heightAglFt, alert none/caution/warning, suppressed}: TAWS annunciations.
- `airspace` {inside, ahead}; `annunciators` {lowVolts, lowVacuum, oilPressure, lowFuelL, lowFuelR};
  `displays` {pfd, mfd: normal / failed / reversionary} (G1000); `gpsValid` (GPS LOI flags); `engineRunning`;
  wind at altitude `windFromTrue`, `windKt`.
- Use `derived.systems.air` / `.attitude` (not `state.aircraft`) for what an instrument displays.

## Map layers (`paintMap` options, all off unless set)

```ts
const { state, derived, db, terrain, airspace } = useSim();
paintMap(ctx, {
  width, height, db, ownship, rangeNm, upTrue,
  route: { plan: state.fms.plan, activeLeg: state.fms.activeLeg },
  terrain: { provider: terrain, mode: 'relative' /* or 'topo' */, altitudeFt: state.aircraft.altitudeFt },
  airspace, fixes: true, airways: true,
  approach: state.fms.approach && { legs: state.fms.approach.legs, activeIndex: derived.approach?.activeLegIndex ?? null },
});
// Add terrainRevision(terrain) (exported from src/ui/map/paintMap.ts) and, for 'relative', the altitude
// rounded to 50 ft to the repaint key of maps that only repaint when something changes.
```
Terrain draws up to about 250 nm range, airspace B/C/D up to 200/120/60 nm, fixes to 20 nm, airways to 80 nm.
Paint cost: plain about 1 ms, overlays about 2 ms, terrain 6 to 12 ms per paint on the Pi, so keep
repaints throttled (about twice a second) as they are now.
