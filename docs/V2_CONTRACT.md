# PanelMix v2: the contract

v2 turns PanelMix from a buttonology trainer into an IFR trainer: real instrument procedures from the
FAA CIFP (approaches with transitions, missed approaches and holds, SIDs and STARs), ILS localizer and
glideslope, fixes and airways, GPS approach scaling and glidepaths, autopilot approach modes, system
failures with an instructor station, terrain and airspace awareness, and guided lessons.

Several builders work at once. Each owns files; everything else is read-only for them. The shared
types below are the contract: build against them, extend them only inside files you own.

Read docs/DEVICE_GUIDE.md first for the stack, the kit and the quality bar. Commands from the repo root:
`npx tsc --noEmit`, `npx vitest run <paths>`, `npx vite --port <port> --strictPort --host 127.0.0.1`,
screenshots with `node ../tools/shot.mjs "<url>" /tmp/x.png dark <width> 0 "<actions js>" <height>`.

Rules for everyone:
- Never run git commands that write. `git status` / `git diff` are fine.
- Before editing a file someone else may also touch, re-read it; make small, local edits.
- Keep the whole project compiling (`npx tsc --noEmit` clean) and all tests passing when you finish.
  If your change breaks a device folder, make the smallest mechanical fix there and list it in your report.
- No em dashes or en dashes anywhere. No new npm dependencies.
- Data from public-domain sources only (FAA CIFP, FAA airspace, NOAA, OurAirports, AWS terrain tiles).

## Shared contract files (read-only unless you own them)

| File | What it defines |
|---|---|
| `src/core/procedures.ts` | Procedure data model: `Approach`, `ProcLeg` (ARINC path terminators), `ProcTransition`, `TerminalProcedure`, `RunwayThreshold`, `AirportProcedures`, `ProcedureSource`, `shortApproachName` |
| `src/core/navdb.ts` | Adds `kind: 'fix'` waypoints (`Fix`), `Localizer`, `Airway`, raw formats `RawFix`, `RawLocalizer`, `RawAirway`, and `db.fixes`, `db.localizers`, `db.airways`, `db.tuneLocalizer`, `db.localizer`, `db.airway`, `db.airwaysAt` |
| `src/core/terrain.ts` | `TerrainProvider`, tile format and naming |
| `src/core/airspace.ts` | `AirspaceVolume`, `AirspaceSource`, `ringContains` |
| `src/sim/fms/types.ts` | `FmsState` (now with `approach`, `suspended`, `hold`), `RouteLeg`, `LoadedApproach`, `HoldState`, `ApproachDerived`, `VerticalDerived`, `FmsSteering` |
| `src/sim/systems/types.ts` | `SystemsState` (failures, weather, battery), `SystemsDerived` (indicated air data, attitude, electrical, terrain, airspace), `FlightEffects` |
| `src/sim/types.ts` | `SimState` (now with `systems`), autopilot `verticalArmed` (GS/GP arm), `approach` (APR), vertical mode `GS` |
| `src/sim/commands.ts` (union only) | New commands: `fms.loadApproach`, `fms.activateApproach`, `fms.removeApproach`, `fms.unsuspend`, `fms.hold`, `fms.exitHold`, `fms.directTo` with `courseMag`, `ap.armGlidepath`, `ap.approach`, and the systems commands (`failure.*`, `weather.*`, `systems.chargeBattery`) |
| `src/sim/simulator.ts` (Derived) | `derived.systems`, `derived.approach`, `derived.vertical`, `derived.steering`; providers `sim.terrain`, `sim.airspace`, `sim.procedures` (also on `useSim()`) |

Boot (`src/app.tsx` `boot()`) already loads `data/fixes.json`, `data/localizers.json`, `data/airways.json`,
`data/airspace.json`, `data/proc/index.json` when they exist, and builds the terrain service.

## Builders and what they own

### 1. CIFP data (owns `scripts/build-cifp.mjs`, `src/core/procdb.ts`, `src/core/cifp.test.ts`, generated `public/data/{fixes,localizers,airways}.json` and `public/data/proc/`)
Parse `.cache/cifp/FAACIFP18` (ARINC 424-18, 132-column records; FAA readme in the same folder) into
the formats in `navdb.ts` (`RawFix`, `RawLocalizer`, `RawAirway`) and `procedures.ts`
(`AirportProcedures` per airport plus `proc/index.json` = `{ v: 1, cycle, airports: [...] }`).
Resolve every leg's fix to coordinates (terminal waypoints PC, enroute EA, VHF D, NDB DB/PN, runway PG,
localizer PI). Split approaches into transitions, final (through the MAP) and missed; set IAF/IF/FAF/MAP
flags; read altitude constraints, vertical angles, RF/AF arc data, hold legs; minima lines from the
approach continuation records (LPV, LNAV/VNAV, LNAV); the final approach path from the PP (FAS data
block) or runway threshold + vertical angle; the localizer for ILS/LOC. Runways from PG. Include SIDs and
STARs. Size budget: fixes.json under 2 MB, procedure files lazily loaded (any size per file, keep
reasonable). Tests that read the generated files and check known procedures (KJYO RNAV 17 with its
transitions and LPV, KJYO ILS 17 with IJYO 111.75, a DME arc, an RF leg, a SID, a STAR). Add an
`npm run cifp` script note in your report (don't edit package.json; I'll add it).

### 2. Terrain, airspace and map layers (owns `scripts/build-terrain.mjs`, `scripts/build-airspace.mjs`, `src/core/terrainService.ts`, `src/core/airspaceSource.ts`, `src/ui/map/*`, generated `public/terrain/` and `public/data/airspace.json`)
- Terrain tiles per `terrain.ts` for the contiguous US (plus Alaska and Hawaii if cheap), from AWS
  Terrain Tiles (terrarium PNGs, public dataset, fetched at build time; no CORS at runtime). Write a tiny
  PNG decoder/encoder with node:zlib. Skip all-water tiles; write `public/terrain/index.json`.
  Runtime `createTerrainService` loads tiles as images (same origin), reads pixels, caches, interpolates.
- Airspace from the FAA Class Airspace dataset (ArcGIS hub id `c6a62360338e408cb1512366ad61559e_0`),
  classes B, C, D, simplified, into `airspace.json` (format in `airspaceSource.ts`), and
  `createAirspaceSource` with bounding-box and point-in-volume queries.
- Map layers in `paintMap` (new options, all off by default so devices opt in): terrain (`topo` shading
  and TAWS-style `relative` colors: red within 100 ft below the airplane or above, yellow within 1,000 ft
  below), airspace (Garmin styles: Class B blue, C magenta, D dashed blue), fixes (small triangles at
  short ranges), airways (V/T at low ranges), and the loaded approach (`fms.approach.legs`: magenta
  active leg, white others, missed approach, holds drawn as racetracks, arcs as arcs). Keep paint cost low.

### 3. FMS and navigation (owns `src/sim/fms.ts` and `src/sim/fms/*` except types.ts additions that keep the contract, `src/sim/radionav.ts`, `src/sim/autopilot.ts`, `src/sim/commands.ts`, `src/sim/simulator.ts` (FMS/nav parts), `src/sim/defaults.ts`, `src/sim/persist.ts`, sim tests)
Make the FMS fly real procedures:
- `fms.loadApproach` builds `LoadedApproach.legs` (`RouteLeg`s) from the selected transition, final
  and missed; `activate` modes load / activate (fly from the transition's first fix, or the IF) /
  vectors to final (extended final approach course into the FAF). Enroute plan then approach, the way
  Garmin units sequence it.
- Leg types: IF, TF, CF, DF, RF (true arc guidance), AF (DME arc), CA/FA/VA (to altitude), VI/CI
  (intercept the next leg), VM/FM (manual termination), FC/FD/CD (distance), HM/HA/HF holds with
  direct / teardrop / parallel entries and racetrack legs (1 min below 14,000 ft or published), PI as
  a course reversal. Fly-by turn anticipation, fly-over where flagged.
- SUSP at the MAP: sequencing suspends; `fms.unsuspend` continues into the missed approach.
  Pilot holds (`fms.hold`, `fms.exitHold`). D-> with `courseMag`.
- CDI scaling: ENR 2.0, TERM 1.0 within 30 nm of the destination, APR from 2 nm before the FAF to
  0.3 nm at the FAF (linear for LNAV, angular for LPV/LNAV+V/LP); MAPR 1.0 after the MAP.
  `derived.approach` with mode (LPV, LNAV+V, L/VNAV, LNAV, LP, ILS, LOC, VOR...) and phase.
- Vertical guidance `derived.vertical`: GPS glidepath from the final approach path (TCH, angle,
  threshold) with angular full scale, advisory +V for LNAV approaches with a vertical angle; ILS
  glideslope from the localizer's GS. `derived.steering` for NAV mode on every leg type.
- NAV receivers: localizers (`db.tuneLocalizer`) with real course width, reverse sensing on back
  course, glideslope needle; CDI label LOC1/ILS.
- Autopilot: NAV follows `derived.steering`; `ap.approach` (APR) = NAV with approach flag and GS/GP arm
  when a vertical path exists; `ap.armGlidepath`; vertical mode `GS` tracks the path (capture from
  below or level within about a dot). KAP 140 style GS arm/capture and GFC GP/GS both map onto this.
- Tests: fly KJYO RNAV 17 (LPV) from a transition to minimums and through the missed approach into the
  hold, and the ILS 17, with the autopilot, closed loop. Holds with each entry. CDI scaling transitions.
  Use fixtures built from the real CIFP records (the CIFP builder is producing the real files at the
  same time; switch tests to the real files if they appear).

### 4. Systems and weather (owns `src/sim/systems/*`, `src/sim/flight.ts`, `src/sim/atmosphere.ts`; may edit only the systems wiring lines in `src/sim/simulator.ts`)
Implement `stepSystems` and `computeSystems` for real:
- Failures: vacuum (analog AI/DG spin down; expose what steam gauges need in derived), pitot blockage
  (indicated airspeed acts like an altimeter), static blockage (frozen altimeter, VSI zero, airspeed
  error), alternator (battery discharge, bus voltage, LOW VOLTS message, avionics off when flat),
  AHRS and ADC (invalid flags), GPS loss (derived.systems.gpsValid false; the FMS reads it to flag GPS),
  engine rough (power loss with surges) and failed (windmilling, glide), display failures (flags only).
- Weather: winds aloft layers interpolated with altitude (wind at the airplane), turbulence (light /
  moderate / severe) as smooth noise on bank, vertical speed and airspeed through `FlightEffects`.
- Terrain: ground elevation from `ctx.terrain` (fallback field elevation), height above ground, TAWS-like
  caution/warning from a short look-ahead (not near the destination runway when configured to land).
- Airspace: inside/ahead Class B/C/D from `ctx.airspace` with "Inside Class B" style advisories once.
- Engine: in `flight.ts`, a failed engine windmills (RPM from airspeed), rough runs at reduced power.
- Tests for each failure and weather effect.

### 5. Instructor station and lessons (owns `src/shell/*` except `panels.ts` rules, `src/app.tsx` UI parts, `src/styles/app.css`)
- Instructor station (a tab or sheet next to Fly): toggle every failure (immediately or after a delay),
  weather (surface wind, winds aloft at 3,000 / 6,000 / 9,000 ft, turbulence, altimeter), and
  scenarios: start at an airport's approach (pick airport, approach, transition; position the airplane
  sensibly, load the approach, optionally engage the autopilot), at a holding fix, on a 10 nm final.
- Lessons: a framework of guided exercises with steps whose checks read `SimState` / `Derived` / the
  panel, hints per device family (GNS, GTN, G1000, G5, Aspen, KAP 140, GFC 500, steam), progress, and
  a debrief. At least: radios and transponder, direct-to and flight plans, autopilot basics, VOR
  tracking, RNAV approach with LPV to minimums and the missed approach, ILS approach, holding, partial
  panel after a vacuum or AHRS failure. Lessons may require procedures or failures from the other
  builders: write the checks against the contract types.
- Tests for lesson checks with hand-built states.
