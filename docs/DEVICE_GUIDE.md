# Building a device for PanelMix

PanelMix is a browser avionics trainer. The pilot picks a PFD, a navigator, a
transponder and an autopilot from dropdowns; the units share one simulator, so
they talk to each other the way they do in the airplane (a flight plan built on
the navigator drives the PFD's course needle, the CDI key picks GPS or VLOC, an
autopilot flies the heading bug set on the HSI, and so on).

Read `src/devices/steam/` first: it is the reference device.

## Stack

- Preact + TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, Vitest.
- No new npm dependencies.
- Commands (run from the repo root):
  - `npx tsc --noEmit` (typecheck)
  - `npx vitest run src/devices/<folder>` (a device's tests), `npm run check` (everything)
  - `npm run dev` (dev server)
  - Pick the panel with the URL hash, e.g. `http://localhost:5173/#pfd=steam&nav=gns430w&xpdr=gtx345&ap=none`.
    Device ids: `steam g5 aspen-e1000 g1000-pfd g1000-mfd gns430w gns530w gtn650xi gtn750xi gtx345 kt76a kap140 gfc500`;
    `xpdr` and `ap` also accept `integrated` (GTN- or G1000-controlled transponder, G1000 GFC 700) and `ap=none`.

## Keep a device self-contained

- A device lives entirely in its own folder under `src/devices/`, including its `spec.ts` (size, summary,
  `help`) and its tests. Register it once in `src/devices/registry.ts`.
- Shared code (`src/sim`, `src/core`, `src/ui`, `src/shell`) changes only when several devices need the
  same thing; work around one-off needs inside the device folder.
- Styles go in the device's own CSS file (e.g. `src/devices/gns/gns.css`) imported by its component, with
  class names prefixed by the family (`gns-`, `gtn-`, `g1000-`, `g5-`, `aspen-`, `xpdr-`, `ap-`).
- No em dashes or en dashes anywhere (UI text, comments, help). Use a hyphen or rewrite.

## The device contract (`src/devices/types.ts`)

A device is the default export of the module your `spec.load()` imports:
`(props: { spec: DeviceSpec; panel: PanelInfo }) => JSX`. It is drawn at a fixed design size,
`spec.width x spec.height` px, at 100 px per inch of the real bezel. `DeviceFrame` scales it to fit,
so lay everything out with absolute positions in design px. Make the size match the real unit's proportions.

`panel` tells you what else is installed: `panel.cdiSources` (the order a CDI key cycles, e.g.
`['GPS','NAV1']`), `panel.xpdr` (`'integrated'` means a GTN or the G1000 must show transponder controls),
`panel.ap` (`'integrated'` = G1000 GFC 700; `'gfc500'`, `'kap140'`, `'none'`).

## The simulator (`src/sim`)

- `useSim()` returns `{ state, derived, dispatch, db, mag }` and re-renders every frame. Use it in the
  top component. `useSimSelector(fn, equal)` re-renders only when a slice changes (good for static bezels).
- `state` (`src/sim/types.ts`): aircraft, radios (2 COM, 2 NAV, active/standby kHz), xpdr, bugs (heading,
  altitude, VS, airspeed, baro, std), nav (cdiSource, obsMag for NAV1/2, bearing pointer sources),
  fms (plan, activeLeg, obsMode, obsCourseMag), ap (engaged, flightDirector, lateral ROL/HDG/NAV,
  vertical PIT/ALT/VS/IAS, altitudeArmed, refs), messages.
- `derived` (`src/sim/simulator.ts`): headingMag, trackMag, indicatedAltitudeFt (using the shared baro),
  pressureAltitudeFt, oatC, `gps` (GpsSolution: to/from/next, dtkMag, bearingMag, distanceNm, crossTrackNm,
  toFrom, needle, scale ENR/TERM, ete, destination...), `vor` (two VorSolutions), `cdi` (whatever the CDI
  source shows: label GPS/VOR1, courseMag, needle -1..1, toFrom, flag, color), `bearing1/2`,
  `flightDirector`, `stalled`, `unreadMessages`, `windComponents`, `windRelativeDeg`.
- `dispatch(cmd)`: every change goes through a `SimCommand` (`src/sim/commands.ts`): `com.swap`,
  `com.setStandby`, `nav.swap`, `nav.setStandby`, `xpdr.code`, `xpdr.mode`, `xpdr.ident`, `bug.heading`,
  `bug.altitude`, `bug.verticalSpeed`, `bug.airspeed`, `baro.set`, `baro.std`, `minimums.set`,
  `cdi.source`, `cdi.cycle` (pass `panel.cdiSources`), `obs.set`, `course.set`, `bearing.set`,
  `fms.directTo`, `fms.cancelDirectTo`, `fms.activateLeg`, `fms.insert`, `fms.remove`, `fms.replacePlan`,
  `fms.invert`, `fms.clear`, `fms.obs`, `ap.engage`, `ap.flightDirector`, `ap.lateral`, `ap.vertical`,
  `ap.armAltitude`, `ap.level`, `ap.nudge`, `msg.readAll`, and sim controls. Read the reducer: it holds
  the rules (frequency snapping, ident timeout, entering OBS on the current DTK, etc.).
- Nav database `db` (`src/core/navdb.ts`): `find(ident)`, `get(ident, near)`, `airport(ident)`,
  `complete(prefix)` (Garmin spell-ahead), `search(prefix)`, `nearestAirports(pos, n, filter)`,
  `nearestNavaids(pos, n, 'vor'|'ndb')`, `inBox(...)`, `tune(khz, pos, alt)`. Airports have runways and
  frequencies (CTAF, TWR, GND, ATIS, AWOS, APP...). There are no fixes/intersections, procedures,
  localizers or airspace in the database: show the real page structure with an honest
  "Not in the trainer database" message where those would be.
  Flight plans store plain `Waypoint`s (`NavDatabase.toWaypoint(record)`).
- Expensive queries (nearest lists) must not run every frame: memoize on a coarse key
  (e.g. position rounded to 0.02 degrees, or `Math.floor(state.time)`).

## The kit (`src/ui`)

- `Box`, `DeviceFrame` (scaling, already applied by the shell), `useDeviceScale()`.
- `Knob` (`src/ui/controls/Knob.tsx`): single or dual concentric (`innerSize`), `onOuter`, `onInner`,
  `onPush`, `onLongPush`, labels for the touch dock. Gestures, wheel, keyboard and the touch dock are
  handled for you. Give every knob a unique `id` (prefix with your device id).
- `BezelButton`: real buttons with `onPress`, `onLongPress` (hold 700 ms), `repeat`, `lit`, looks
  `garmin | garmin-light | aspen | bendix | softkey | touch`. Use them for every physical key.
- `Screen` (glass area), `ScreenSvg`, `ScreenCanvas` (crisp canvas with a draw callback).
- Instruments: `AttitudeIndicator`, `SpeedTape`, `AltitudeTape`, `VsiTape`, `HsiRose`, colours in
  `instruments/palette.ts` (`AV`), fonts `AV_FONT` / CSS `var(--av)` (Barlow Semi Condensed 500/600/700).
  Use them with your own sizes and styles, wrap them, or draw your own where the real unit differs.
- Map: `paintMap(ctx, options)` draws basemap, airports, navaids, the plan (active leg magenta) and the
  ownship; returns the projection for your own overlays. `MAP_STYLES.garmin | gns`, `RANGE_STEPS`, `stepRange`.
- Knob character entry for identifiers: `src/ui/identEntry.ts` (`turnSmall` / `turnLarge` with spell-ahead).
- Formatting: `src/ui/format.ts` (bearings, distances, ETE, squawk) and `src/core/frequency.ts`
  (`COM`/`NAV` bands, `stepMhz`, `stepChannel`, `formatCom`, `formatNav`, `parseKeypad`).

## Quality bar

In order of importance:

1. Faithful to the real unit. Research it before building (official pilot's guides are public PDFs; use
   web search and fetch). Bezel layout, key names and positions, knob functions, page names and order,
   colours and screen layout should match the real thing closely. Where you simplify, simplify the depth,
   not the look or the button names.
2. Every physical control responds. Each key and knob must do its real primary action. Secondary
   behaviours (press-and-hold, push-to-toggle) where the real unit has them.
3. The core workflows a student practises work end to end against the shared simulator (listed in your
   assignment).
4. Code quality: small modules, pure reducers for page and cursor logic with unit tests, typed, no
   `any`, no dead code, comments that explain the why. Render cost matters (it re-renders every frame).
5. Looks right at the sizes it will be shown: from about 350 px wide (phone) to 1300 px. Check both.
6. Accessible: every control has a clear `label` / `ariaLabel`.

Before calling a device done: typecheck, run the tests, and look at screenshots at phone and desktop
widths while actually pressing its keys and turning its knobs.
