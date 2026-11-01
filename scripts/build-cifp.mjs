#!/usr/bin/env node
/*
 * Builds the trainer's instrument procedure data from the FAA CIFP into public/data:
 *
 *   fixes.json        enroute (EA) and terminal (PC) waypoints    { v, cycle, fixes: RawFix[] }
 *   localizers.json   localizers and glideslopes (PI with PG)     { v, cycle, items: RawLocalizer[] }
 *   airways.json      Victor, T, J and Q routes (ER)              { v, cycle, items: RawAirway[] }
 *   proc/index.json   airports that have procedures               { v, cycle, airports }
 *   proc/{ID}.json    runways, approaches, SIDs and STARs         AirportProcedures
 *
 *   node scripts/build-cifp.mjs [--cifp FILE]
 *
 * Source: FAA Coded Instrument Flight Procedures (public domain), unzipped to
 * .cache/cifp/FAACIFP18. The file is ARINC 424-18: fixed-width records of 132
 * columns, plus the version 19 conventions the FAA readme lists (route type H
 * and qualifier F for RNAV (RNP) approaches, level of service continuation
 * records). Column numbers in this file are the 1-based ones of the spec.
 * Output formats: src/core/navdb.ts (Raw*) and src/core/procedures.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cifpArg = process.argv.indexOf('--cifp');
const CIFP = cifpArg > 0 ? process.argv[cifpArg + 1] : path.join(ROOT, '.cache', 'cifp', 'FAACIFP18');
const OUT = path.join(ROOT, 'public', 'data');
const PROC_OUT = path.join(OUT, 'proc');
/** fixes.json is loaded at boot, so it has a budget; procedures load per airport. */
const FIX_BUDGET_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Field decoding

/** Columns `from`..`to` (1-based, inclusive), as the ARINC 424 record layouts number them. */
const col = (r, from, to = from) => r.slice(from - 1, to);
const trimmed = (r, from, to) => col(r, from, to).trim();

const round = (x, places) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};
const r5 = (x) => round(x, 5);
const norm360 = (d) => {
  const v = round(((d % 360) + 360) % 360, 1);
  return v === 360 ? 0 : v;
};

/** "N39050643" (ddmmss.ss) or "N3905064260" (ddmmss.ssss, path points). */
function parseLat(s) {
  const m = /^([NS])(\d{2})(\d{2})(\d{2})(\d*)$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(`${m[4]}.${m[5] || '0'}`) / 3600;
  return m[1] === 'S' ? -v : v;
}

/** "W077333818" (dddmmss.ss) or "W07733381845". */
function parseLon(s) {
  const m = /^([EW])(\d{3})(\d{2})(\d{2})(\d*)$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(`${m[4]}.${m[5] || '0'}`) / 3600;
  return m[1] === 'W' ? -v : v;
}

function parsePos(r, latFrom, latTo, lonFrom, lonTo) {
  const lat = parseLat(col(r, latFrom, latTo));
  const lon = parseLon(col(r, lonFrom, lonTo));
  return lat === null || lon === null ? null : { lat, lon };
}

/** Magnetic variation or station declination, "W0100" = 10.0 W; east positive. "T" = true north. */
function parseVar(s) {
  const m = /^([EWT])(\d{4})$/.exec(s);
  if (!m) return null;
  if (m[1] === 'T') return 0;
  const v = Number(m[2]) / 10;
  return m[1] === 'W' ? -v : v;
}

/** "03000", "FL240", "-0012"; "UNKNN" and blanks are null. */
function parseAlt(s) {
  const t = s.trim();
  if (/^FL\d{3}$/.test(t)) return Number(t.slice(2)) * 100;
  if (/^[-+]?\d+$/.test(t)) return Number(t);
  return null;
}

/** Fixed-point number with `places` implied decimals ("1713" = 171.3), or null. */
function fixed(s, places) {
  const t = s.trim();
  return /^[-+]?\d+$/.test(t) ? Number(t) / 10 ** places : null;
}

const int = (s) => fixed(s, 0);

/** Course, bearing or radial in tenths ("1713" = 171.3), wrapped into [0, 360) like src/core/geo.ts norm360. */
function course(s) {
  if (!/^\d{4}$/.test(s)) return null;
  const v = Number(s) / 10;
  return v >= 360 ? round(v - 360, 1) : v;
}

/** "RW17" -> "17"; non-numeric idents ("NE") are stored without the prefix already. */
const runwayIdent = (s) => s.trim().replace(/^RW/, '');

// ---------------------------------------------------------------------------
// Geometry (spherical earth is plenty for courses and sanity checks)

const EARTH_NM = 3440.065;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function distanceNm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingTrue(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Pass 1: read every record into lookup tables

if (!fs.existsSync(CIFP)) {
  console.error(`CIFP file not found: ${CIFP}
Download the current cycle from https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
and unzip FAACIFP18 into .cache/cifp/ (or pass --cifp FILE).`);
  process.exit(1);
}
const text = fs.readFileSync(CIFP, 'latin1');
const CYCLE = /VOLUME (\d{4})/.exec(text.slice(0, 2000))?.[1] ?? 'unknown';

/** PA: ident -> { lat, lon, magVar, elevFt } */
const airports = new Map();
/** PG: airport -> Map(runway ident -> threshold) */
const runways = new Map();
/** PC: "airport|ident" -> waypoint; also by ident for procedures that borrow another airport's waypoint. */
const terminalWpts = new Map();
const terminalByIdent = new Map();
/** EA: ident -> waypoint (identifiers are unique across the file). */
const enrouteWpts = new Map();
/** D: "ident|icao" -> VHF navaid (VOR, VOR/DME, VORTAC, TACAN, DME, ILS/DME). */
const vhfNavaids = new Map();
/** DB: "ident|icao" -> NDB; PN: "airport|ident" -> terminal NDB. */
const ndbs = new Map();
const terminalNdbs = new Map();
/** PI: "airport|ident" -> localizer. */
const localizers = new Map();
/** PP: "airport|approach id" -> FAS data block. */
const pathPoints = new Map();
/** PD/PE/PF records per airport, in file order. */
const procRecords = new Map();
/** ER records, in file order. */
const airwayRecords = [];

const pushTo = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** Primary records carry continuation number 0 or 1 (1 = continuations follow). */
const isPrimary = (r, column) => r[column - 1] === '0' || r[column - 1] === '1';

for (const raw of text.split(/\r?\n/)) {
  if (raw[0] !== 'S') continue; // header records start with H; tailored (T) records are not in the FAA file
  const r = raw.padEnd(132);
  const section = r[4];
  if (section === 'P') {
    const apt = trimmed(r, 7, 10);
    if (r[5] === 'N') {
      // Terminal NDB: navaid layout, so its subsection is in column 6.
      const pos = parsePos(r, 33, 41, 42, 51);
      if (pos && isPrimary(r, 22)) terminalNdbs.set(`${apt}|${trimmed(r, 14, 17)}`, { ident: trimmed(r, 14, 17), ...pos });
      continue;
    }
    switch (r[12]) {
      case 'A': {
        const pos = parsePos(r, 33, 41, 42, 51);
        if (pos && isPrimary(r, 22)) {
          airports.set(apt, { ...pos, magVar: parseVar(col(r, 52, 56)) ?? 0, elevFt: parseAlt(col(r, 57, 61)) ?? 0 });
        }
        break;
      }
      case 'G': {
        const pos = parsePos(r, 33, 41, 42, 51);
        if (!pos || !isPrimary(r, 22)) break;
        const bearing = col(r, 28, 31);
        const rwy = {
          ident: runwayIdent(col(r, 14, 18)),
          ...pos,
          elevationFt: parseAlt(col(r, 67, 71)),
          tchFt: int(col(r, 76, 77)),
          // "1710" = 171.0 magnetic; "171T" = true (high latitudes), converted once the airport variation is known.
          courseMag: course(bearing),
          courseTrue: /^\d{3}T$/.test(bearing) ? Number(bearing.slice(0, 3)) : null,
          lengthFt: int(col(r, 23, 27)),
          localizer: trimmed(r, 82, 85),
        };
        let byIdent = runways.get(apt);
        if (!byIdent) runways.set(apt, (byIdent = new Map()));
        byIdent.set(rwy.ident, rwy);
        break;
      }
      case 'C': {
        const pos = parsePos(r, 33, 41, 42, 51);
        if (!pos || !isPrimary(r, 22)) break;
        // Waypoint type A = arc center fix: only the center of RF legs, not a waypoint pilots fly to.
        const w = { ident: trimmed(r, 14, 18), ...pos, airport: apt, arcCenter: r[26] === 'A' };
        terminalWpts.set(`${apt}|${w.ident}`, w);
        pushTo(terminalByIdent, w.ident, w);
        break;
      }
      case 'I': {
        const pos = parsePos(r, 33, 41, 42, 51);
        if (!pos || !isPrimary(r, 22)) break;
        const bearing = col(r, 52, 55);
        const gs = parsePos(r, 56, 64, 65, 74);
        localizers.set(`${apt}|${trimmed(r, 14, 17)}`, {
          ident: trimmed(r, 14, 17),
          airport: apt,
          freqKhz: (int(col(r, 23, 27)) ?? 0) * 10,
          runway: runwayIdent(col(r, 28, 32)),
          ...pos,
          courseMag: course(bearing),
          courseTrue: /^\d{3}T$/.test(bearing) ? Number(bearing.slice(0, 3)) : null,
          widthDeg: fixed(col(r, 84, 87), 2),
          gs: gs && fixed(col(r, 88, 90), 2) ? { ...gs, angleDeg: fixed(col(r, 88, 90), 2), elevationFt: parseAlt(col(r, 98, 102)) } : null,
          magVar: parseVar(col(r, 91, 95)) ?? 0,
          gsTchFt: int(col(r, 96, 97)),
        });
        break;
      }
      case 'P': {
        // Path point (FAS data block). Primary: col 27 = 1; continuation (col 27 = 2) only repeats heights.
        if (!isPrimary(r, 27)) break;
        const ltp = parsePos(r, 38, 48, 49, 60);
        const fpap = parsePos(r, 71, 81, 82, 93);
        const gpa = fixed(col(r, 67, 70), 2);
        const tch = fixed(col(r, 103, 108), 1);
        if (!ltp || !fpap || !gpa || tch === null) break;
        pathPoints.set(`${apt}|${trimmed(r, 14, 19)}`, {
          ...ltp,
          fpap,
          runway: runwayIdent(col(r, 20, 24)),
          angleDeg: gpa,
          tchFt: r[108] === 'M' ? tch / 0.3048 : tch,
        });
        break;
      }
      case 'D':
      case 'E':
      case 'F':
        pushTo(procRecords, apt, r);
        break;
      default:
        break;
    }
  } else if (section === 'E') {
    if (r[5] === 'A') {
      const pos = parsePos(r, 33, 41, 42, 51);
      if (pos && isPrimary(r, 22)) enrouteWpts.set(trimmed(r, 14, 18), { ident: trimmed(r, 14, 18), ...pos });
    } else if (r[5] === 'R') {
      airwayRecords.push(r);
    }
  } else if (section === 'D' && isPrimary(r, 22)) {
    const ident = trimmed(r, 14, 17);
    if (r[5] === ' ') {
      // VOR position when there is a VOR, otherwise the DME (DME-only, ILS/DME).
      const pos = parsePos(r, 33, 41, 42, 51) ?? parsePos(r, 56, 64, 65, 74);
      if (pos) vhfNavaids.set(`${ident}|${col(r, 20, 21)}`, { ident, ...pos });
    } else if (r[5] === 'B') {
      const pos = parsePos(r, 33, 41, 42, 51);
      if (pos) ndbs.set(`${ident}|${col(r, 20, 21)}`, { ident, ...pos });
    }
  }
}

// True runway and localizer bearings (Alaska) become magnetic with the local variation.
for (const [apt, byIdent] of runways) {
  const variation = airports.get(apt)?.magVar ?? 0;
  for (const rwy of byIdent.values()) {
    if (rwy.courseMag === null && rwy.courseTrue !== null) rwy.courseMag = norm360(rwy.courseTrue - variation);
  }
}
for (const loc of localizers.values()) {
  if (loc.courseMag === null && loc.courseTrue !== null) loc.courseMag = norm360(loc.courseTrue - loc.magVar);
}

// ---------------------------------------------------------------------------
// Fix resolution: every procedure leg names its fix by identifier, ICAO region
// and the section/subsection of the record that defines it.

const stats = {
  unresolved: new Map(),
  pathTerminators: new Map(),
  firstLegs: new Map(),
  approachTypes: new Map(),
  dropped: [],
  rfRadiusMismatch: 0,
  rfLegs: 0,
  afLegs: 0,
  noFinalApproachPath: 0,
  defaultedMinima: 0,
};
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

/** The candidate closest to `near` (the procedure's airport) when an identifier is shared. */
function nearest(list, near) {
  if (!list || list.length === 0) return undefined;
  if (!near || list.length === 1) return list[0];
  return list.reduce((best, w) => (distanceNm(near, w) < distanceNm(near, best) ? w : best));
}

/** The record a fix reference names, by its section and subsection (cols 37-38 for leg fixes). */
function lookupFix(apt, ident, icao, sectionCode) {
  switch (sectionCode) {
    case 'PC': {
      // Waypoints of the procedure's own airport first; a few procedures borrow a neighbour's.
      const w = terminalWpts.get(`${apt}|${ident}`) ?? nearest(terminalByIdent.get(ident), airports.get(apt));
      return w && { found: w, kind: 'fix', terminal: `${w.airport}|${w.ident}` };
    }
    case 'EA': {
      const w = enrouteWpts.get(ident);
      return w && { found: w, kind: 'fix' };
    }
    case 'D ': {
      const n = vhfNavaids.get(`${ident}|${icao}`);
      return n && { found: n, kind: 'vor' };
    }
    case 'DB': {
      const n = ndbs.get(`${ident}|${icao}`);
      return n && { found: n, kind: 'ndb' };
    }
    case 'PN': {
      const n = terminalNdbs.get(`${apt}|${ident}`) ?? ndbs.get(`${ident}|${icao}`);
      return n && { found: n, kind: 'ndb' };
    }
    case 'PG': {
      const t = runways.get(apt)?.get(runwayIdent(ident));
      return t && { found: t, kind: 'runway' };
    }
    case 'PA': {
      const a = airports.get(ident);
      return a && { found: a, kind: 'airport' };
    }
    case 'PI': {
      const l = localizers.get(`${apt}|${ident}`);
      return l && { found: l, kind: 'loc' };
    }
    case '  ':
      // A few records leave the section blank: try what an identifier like this usually is.
      for (const code of ['D ', 'DB', 'PN', 'PI', 'PC', 'EA', 'PG', 'PA']) {
        const hit = lookupFix(apt, ident, icao, code);
        if (hit) return hit;
      }
      return undefined;
    default:
      return undefined;
  }
}

/** Legs whose fix (or arc center) names a record that is not in the file. */
const brokenLegs = new WeakSet();
/** Leg -> "airport|ident" of the terminal waypoint it flies to, for the fixes.json budget. */
const legTerminal = new WeakMap();

/** A ProcFix for a fix reference, or null (counted) when the record it names is not in the file. */
function resolveFix(apt, ident, icao, sectionCode) {
  const hit = lookupFix(apt, ident, icao, sectionCode);
  if (!hit) {
    count(stats.unresolved, `${apt || 'airway'} ${ident} (${sectionCode.trim() || 'no section'})`);
    return null;
  }
  const fix = { ident, lat: r5(hit.found.lat), lon: r5(hit.found.lon), kind: hit.kind };
  if (hit.terminal) legTerminal.set(fix, hit.terminal);
  return fix;
}

// ---------------------------------------------------------------------------
// Procedure legs (PD/PE/PF primary records, ARINC 424 section 4.1.9.1)

/**
 * Altitude description (col 83) with altitude 1 (85-89) and 2 (90-94).
 * G/H: on the FAF of an ILS final, the glideslope intercept altitude is
 * altitude 1 (altitude 2 is where the glideslope itself crosses the fix).
 * I/J: on the FACF, altitude 1 is the crossing restriction at that fix and
 * altitude 2 the intercept altitude, which the FAF carries again, so the FACF
 * keeps its own restriction. V/X/Y are step-down fixes whose altitude 2 is the
 * vertical path altitude.
 */
function altitudeConstraint(desc, a1, a2) {
  switch (desc) {
    case '+':
    case 'J':
    case 'V':
      return a1 === null ? undefined : { kind: 'atOrAbove', ft: a1 };
    case '-':
    case 'Y':
      return a1 === null ? undefined : { kind: 'atOrBelow', ft: a1 };
    case ' ':
    case '@':
    case 'I':
    case 'X':
      return a1 === null ? undefined : { kind: 'at', ft: a1 };
    case 'B':
      if (a1 === null || a2 === null) return a1 === null ? undefined : { kind: 'at', ft: a1 };
      return { kind: 'between', aboveFt: Math.min(a1, a2), belowFt: Math.max(a1, a2) };
    case 'C':
      return a2 === null ? undefined : { kind: 'atOrAbove', ft: a2 };
    case 'G':
    case 'H': {
      const ft = a1 ?? a2;
      return ft === null ? undefined : { kind: 'glideslope', ft };
    }
    default:
      return undefined;
  }
}

function legFromRecord(r, apt) {
  const pathTerm = col(r, 48, 49);
  count(stats.pathTerminators, pathTerm);
  const leg = { path: pathTerm };

  const fixIdent = trimmed(r, 30, 34);
  if (fixIdent) {
    const fix = resolveFix(apt, fixIdent, col(r, 35, 36), col(r, 37, 38));
    if (fix) leg.fix = fix;
    else brokenLegs.add(leg);
  }
  const turn = r[43];
  if (turn === 'L' || turn === 'R') leg.turn = turn;

  const courseMag = course(col(r, 71, 74));
  if (courseMag !== null) leg.courseMag = courseMag;

  // Route distance, or hold leg length / time ("T010" = 1.0 min). On CD, FD and VD
  // legs it is the DME distance from the recommended navaid that ends the leg.
  const dist = col(r, 75, 78);
  if (/^T\d{3}$/.test(dist)) leg.legTimeMin = Number(dist.slice(1)) / 10;
  else if (/^\d{4}$/.test(dist) && Number(dist) > 0) leg.distanceNm = Number(dist) / 10;

  const alt = altitudeConstraint(r[82], parseAlt(col(r, 85, 89)), parseAlt(col(r, 90, 94)));
  if (alt) leg.altitude = alt;

  const speed = int(col(r, 100, 102));
  if (speed) leg.speedKt = speed;

  const vertical = fixed(col(r, 103, 106), 2);
  if (vertical) leg.verticalAngleDeg = vertical;

  const navIdent = trimmed(r, 51, 54);
  const navaid = navIdent ? resolveFix(apt, navIdent, col(r, 55, 56), col(r, 79, 80)) : null;
  const theta = course(col(r, 63, 66));
  const rho = fixed(col(r, 67, 70), 1);

  if (pathTerm === 'RF') {
    // Center fix (107-111, section 115-116) and arc radius in thousandths of a nm (57-62).
    // On other legs the same columns hold the MSA center, which is not a leg property.
    stats.rfLegs++;
    const centerIdent = trimmed(r, 107, 111);
    const center = centerIdent ? resolveFix(apt, centerIdent, col(r, 113, 114), col(r, 115, 116)) : null;
    const radius = fixed(col(r, 57, 62), 3);
    if (center) leg.arcCenter = { lat: center.lat, lon: center.lon };
    if (radius) leg.arcRadiusNm = radius;
    if (!center || !radius) brokenLegs.add(leg);
    else if (leg.fix && Math.abs(distanceNm(center, leg.fix) - radius) > 0.05) stats.rfRadiusMismatch++;
  } else if (pathTerm === 'AF') {
    // DME arc: centered on the recommended navaid, radius = rho; theta is the radial
    // of the fix that ends the arc, the course field the radial where it begins.
    stats.afLegs++;
    if (navaid && rho) {
      leg.arcCenter = { lat: navaid.lat, lon: navaid.lon };
      leg.arcRadiusNm = rho;
    } else brokenLegs.add(leg);
  }
  if (navaid) {
    leg.recommendedNavaid = navaid;
    if (theta !== null) leg.thetaDeg = theta;
    if (rho !== null) leg.rhoNm = rho;
  }

  // Waypoint description code, col 43: A IAF, B IF, C IAF with hold, D IAF + FACF,
  // F FAF, I FACF (the IF of the final), M MAP. Col 41 Y/B: fly-over.
  switch (r[42]) {
    case 'A':
    case 'C':
      leg.iaf = true;
      break;
    case 'D':
      leg.iaf = true;
      leg.if = true;
      break;
    case 'B':
    case 'I':
      leg.if = true;
      break;
    case 'F':
      leg.faf = true;
      break;
    case 'M':
      leg.map = true;
      break;
    default:
      break;
  }
  if (r[40] === 'Y' || r[40] === 'B') leg.flyover = true;
  return leg;
}

const sequence = (r) => Number(col(r, 27, 29));

/** Primary records grouped by route type and transition, legs in sequence order. */
function routes(recs) {
  const out = new Map();
  for (const r of recs) {
    if (!isPrimary(r, 39)) continue;
    pushTo(out, `${r[19]}|${trimmed(r, 21, 25)}`, r);
  }
  for (const list of out.values()) list.sort((a, b) => sequence(a) - sequence(b));
  return out;
}

function legsOf(recs, apt, label) {
  const legs = recs.map((r) => legFromRecord(r, apt));
  if (legs[0]) count(stats.firstLegs, `${label} ${legs[0].path}`);
  return legs;
}

const isBroken = (legs) => legs.some((l) => brokenLegs.has(l));

/**
 * fixes.json keeps terminal waypoints by how pilots use them, best first:
 * approach IAF/IF/FAF, holding fixes, missed approach fixes, other approach
 * fixes (step-downs, feeders), SID and STAR fixes.
 */
const ROLE = { approachKey: 5, hold: 4, missed: 3, approach: 2, sidStar: 1, unused: 0 };
const ROLE_NAMES = ['unused', 'SID/STAR', 'other approach', 'missed approach', 'holding', 'approach IAF/IF/FAF'];
const terminalRole = new Map();
function noteRoles(legs, roleOf) {
  for (const leg of legs) {
    const key = leg.fix && legTerminal.get(leg.fix);
    if (!key) continue;
    const role = leg.path[0] === 'H' ? Math.max(ROLE.hold, roleOf(leg)) : roleOf(leg);
    if ((terminalRole.get(key) ?? 0) < role) terminalRole.set(key, role);
  }
}

// ---------------------------------------------------------------------------
// Approaches (PF)

/** Route type (col 20) to the approach type and the chart title's prefix. */
const APPROACH_TYPES = {
  I: ['ILS', 'ILS'],
  L: ['LOC', 'LOC'],
  B: ['LOC BC', 'LOC BC'],
  X: ['LDA', 'LDA'],
  U: ['SDF', 'SDF'],
  R: ['RNAV', 'RNAV (GPS)'],
  H: ['RNP', 'RNAV (RNP)'],
  P: ['GPS', 'GPS'],
  V: ['VOR', 'VOR'],
  S: ['VOR', 'VOR'], // VOR approach using a VOR/DME or VORTAC
  D: ['VOR/DME', 'VOR/DME'],
  N: ['NDB', 'NDB'],
  Q: ['NDB/DME', 'NDB/DME'],
  T: ['TACAN', 'TACAN'],
  G: ['IGS', 'IGS'],
  J: ['GLS', 'GLS'],
};
const LOCALIZER_TYPES = new Set(['ILS', 'LOC', 'LOC BC', 'LDA', 'SDF', 'IGS']);
const MINIMA = new Set(['LPV', 'LP', 'LNAV/VNAV', 'LNAV']);

/**
 * Approach identifier: route type letter, runway, optional multiple-approach
 * suffix ("R17", "I16L", "R21-Y", "R17LY"), or circling ("VOR-A", "VDM-A",
 * "RNVA"). Ids are normalised to put the suffix after a dash ("R17L-Y") so
 * shortApproachName reads it the same way for every runway.
 */
function parseApproachId(id) {
  let m = /^([A-Z])(\d{2})([LRC]?)(?:-?([A-Z]))?$/.exec(id);
  if (m) {
    const runway = `${m[2]}${m[3]}`;
    return { runway, suffix: m[4] ?? null, letter: null, id: m[4] ? `${m[1]}${runway}-${m[4]}` : id };
  }
  m = /^([A-Z]{3})-?([A-Z])$/.exec(id);
  if (m) return { runway: null, suffix: null, letter: m[2], id: `${m[1]}-${m[2]}` };
  return { runway: null, suffix: null, letter: null, id, label: id.slice(1) };
}

function approachName(prefix, parsed, copter) {
  const base = copter ? `COPTER ${prefix}` : prefix;
  if (parsed.runway) {
    const rwy = parsed.runway.replace(/^0(?=\d)/, '');
    return `${base}${parsed.suffix ? ` ${parsed.suffix}` : ''} RWY ${rwy}`;
  }
  if (parsed.letter) return `${base}-${parsed.letter}`;
  return `${base} ${parsed.label}`;
}

/** Level of service continuation (col 40 = W): authorised flag + 10-character name, three times. */
function levelsOfService(r) {
  const out = [];
  for (const at of [41, 52, 63]) {
    if (r[at - 1] !== 'A') continue;
    const name = trimmed(r, at + 1, at + 10);
    if (MINIMA.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Course of the segment into the MAP: coded on CF legs, otherwise from the fix
 * before it (not from the FAF: RNP finals turn on RF legs after the FAF).
 */
function finalApproachCourse(final, apt) {
  const at = final.findLastIndex((l) => l.map);
  const mapLeg = final[at];
  if (!mapLeg) return null;
  if (mapLeg.courseMag !== undefined) return mapLeg.courseMag;
  const from = final.slice(0, at).findLast((l) => l.fix && mapLeg.fix && distanceNm(l.fix, mapLeg.fix) > 0.2);
  if (!from || !mapLeg.fix) return null;
  return norm360(bearingTrue(from.fix, mapLeg.fix) - (airports.get(apt)?.magVar ?? 0));
}

/**
 * The vertical path: the FAS data block (PP) when there is one, the
 * glideslope for an ILS, otherwise the published vertical angle from the
 * runway threshold and its TCH (50 ft when the runway has none).
 */
function finalApproachPath(apt, rawId, type, runway, final, loc) {
  const variation = airports.get(apt)?.magVar ?? 0;
  const pp = pathPoints.get(`${apt}|${rawId}`);
  if (pp) {
    const thr = runways.get(apt)?.get(pp.runway);
    return {
      thresholdLat: r5(pp.lat),
      thresholdLon: r5(pp.lon),
      thresholdElevationFt: thr?.elevationFt ?? airports.get(apt)?.elevFt ?? 0,
      tchFt: round(pp.tchFt, 1),
      angleDeg: pp.angleDeg,
      courseMag: norm360(bearingTrue(pp, pp.fpap) - variation),
    };
  }
  const thr = runway ? runways.get(apt)?.get(runway) : undefined;
  if (type === 'ILS' && loc?.gs) {
    const locThr = runways.get(apt)?.get(loc.runway) ?? thr;
    if (locThr && loc.courseMag !== null) {
      return {
        thresholdLat: r5(locThr.lat),
        thresholdLon: r5(locThr.lon),
        thresholdElevationFt: locThr.elevationFt ?? 0,
        tchFt: loc.gsTchFt ?? locThr.tchFt ?? 50,
        angleDeg: loc.gs.angleDeg,
        courseMag: loc.courseMag,
      };
    }
  }
  const angled = final.findLast((l) => l.map && l.verticalAngleDeg) ?? final.findLast((l) => l.verticalAngleDeg);
  if (!angled || !thr) return undefined;
  const course = finalApproachCourse(final, apt) ?? thr.courseMag;
  if (course === null) return undefined;
  return {
    thresholdLat: r5(thr.lat),
    thresholdLon: r5(thr.lon),
    thresholdElevationFt: thr.elevationFt ?? 0,
    tchFt: thr.tchFt || 50,
    angleDeg: Math.abs(angled.verticalAngleDeg),
    courseMag: course,
  };
}

function buildApproach(apt, rawId, recs) {
  const byRoute = routes(recs);
  const transitions = [];
  let finalRecs = null;
  for (const [key, list] of byRoute) {
    const [routeType, name] = key.split('|');
    if (routeType !== 'A') {
      finalRecs ??= list;
      continue;
    }
    const transition = { name: name || trimmed(list[0], 30, 34), legs: legsOf(list, apt, 'approach transition') };
    if (isBroken(transition.legs)) stats.dropped.push(`${apt} ${rawId} transition ${transition.name}`);
    else transitions.push(transition);
  }
  if (!finalRecs) return null;
  const head = finalRecs[0];
  const routeType = head[19];
  const qualifier1 = head[118];
  const copter = head[119] === 'H';
  const known = APPROACH_TYPES[routeType];
  if (!known) return null;
  // Qualifier F = RNP AR, also when an older record still codes the route as RNAV.
  const [type, prefix] = qualifier1 === 'F' ? APPROACH_TYPES.H : known;

  // Final through the MAP (col 43 = M); the missed approach follows (its first leg has M in col 42).
  const legs = legsOf(finalRecs, apt, 'approach final');
  let missedFrom = finalRecs.findIndex((r) => r[42] === 'M') + 1;
  if (missedFrom === 0) missedFrom = finalRecs.findIndex((r) => r[41] === 'M');
  if (missedFrom < 0) missedFrom = legs.length;
  const final = legs.slice(0, missedFrom);
  const missed = legs.slice(missedFrom);
  if (missed[0]) count(stats.firstLegs, `approach missed ${missed[0].path}`);
  if (isBroken(legs)) {
    stats.dropped.push(`${apt} ${rawId}`);
    return null;
  }
  for (const t of transitions) noteRoles(t.legs, (l) => (l.iaf || l.if || l.faf ? ROLE.approachKey : ROLE.approach));
  noteRoles(final, (l) => (l.iaf || l.if || l.faf ? ROLE.approachKey : ROLE.approach));
  noteRoles(missed, () => ROLE.missed);

  let minima = [];
  const los = recs.find((r) => !isPrimary(r, 39) && r[39] === 'W' && r[19] !== 'A');
  if (los) minima = levelsOfService(los);
  else if (type === 'RNAV' || type === 'GPS') {
    // Older RNAV (GPS) and GPS records have no level of service record: LNAV (or circling on LNAV) is what they offer.
    minima = ['LNAV'];
    stats.defaultedMinima++;
  }

  const parsed = parseApproachId(rawId);
  let localizerIdent;
  let loc;
  if (LOCALIZER_TYPES.has(type)) {
    // The localizer the final legs are flown on (recommended navaid in section PI), else the runway's (PG col 82-85).
    const searched = [...finalRecs, ...[...byRoute].filter(([key]) => key[0] === 'A').flatMap(([, list]) => list)];
    const rec = searched.find((r) => col(r, 79, 80) === 'PI') ?? searched.find((r) => col(r, 37, 38) === 'PI');
    if (rec) localizerIdent = col(rec, 79, 80) === 'PI' ? trimmed(rec, 51, 54) : trimmed(rec, 30, 34);
    else localizerIdent = runways.get(apt)?.get(parsed.runway ?? '')?.localizer || undefined;
    loc = localizerIdent ? localizers.get(`${apt}|${localizerIdent}`) : undefined;
  }
  const finalPath = finalApproachPath(apt, rawId, type, parsed.runway, final, loc);
  if (!finalPath && type !== 'RNP' && parsed.runway) stats.noFinalApproachPath++;
  count(stats.approachTypes, type);

  const approach = {
    id: parsed.id,
    type,
    name: approachName(prefix, parsed, copter),
    runway: parsed.runway,
    minima,
    transitions,
    final,
    missed,
  };
  if (localizerIdent) approach.localizer = localizerIdent;
  if (finalPath) approach.path = finalPath;
  return approach;
}

// ---------------------------------------------------------------------------
// SIDs (PD) and STARs (PE)

/** Route type (col 20) to the part of the procedure it codes. Engine-out SIDs (0) are left out. */
const SID_PARTS = { 1: 'runway', 4: 'runway', F: 'runway', T: 'runway', 2: 'common', 5: 'common', M: 'common', 3: 'enroute', 6: 'enroute', S: 'enroute', V: 'enroute' };
const STAR_PARTS = { 1: 'enroute', 4: 'enroute', 7: 'enroute', F: 'enroute', 2: 'common', 5: 'common', 8: 'common', M: 'common', 3: 'runway', 6: 'runway', 9: 'runway', S: 'runway' };

function buildTerminalProcedure(apt, kind, id, recs) {
  const parts = kind === 'SID' ? SID_PARTS : STAR_PARTS;
  const runwayTransitions = [];
  const enrouteTransitions = [];
  let common = [];
  for (const [key, list] of routes(recs)) {
    const [routeType, name] = key.split('|');
    const part = parts[routeType];
    if (!part) continue;
    const legs = legsOf(list, apt, `${kind} ${part}`);
    const label = name || trimmed(list[0], 30, 34);
    if (part === 'common') {
      if (isBroken(legs)) {
        stats.dropped.push(`${apt} ${kind} ${id}`);
        return null;
      }
      // One common route per procedure in practice; join them if a file ever codes more.
      common = common.length ? [...common, ...legs] : legs;
    } else if (isBroken(legs)) stats.dropped.push(`${apt} ${kind} ${id} transition ${label}`);
    else (part === 'runway' ? runwayTransitions : enrouteTransitions).push({ name: label, legs });
  }
  if (!common.length && !runwayTransitions.length && !enrouteTransitions.length) return null;
  for (const legs of [common, ...runwayTransitions.map((t) => t.legs), ...enrouteTransitions.map((t) => t.legs)]) {
    noteRoles(legs, () => ROLE.sidStar);
  }
  return { id, kind, name: id, runwayTransitions, common, enrouteTransitions };
}

// ---------------------------------------------------------------------------
// Pass 2: per-airport procedure files

fs.mkdirSync(PROC_OUT, { recursive: true });
for (const f of fs.readdirSync(PROC_OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(PROC_OUT, f));

const totals = { approaches: 0, sids: 0, stars: 0, transitions: 0, legs: 0, procBytes: 0 };
const procAirports = [];

for (const [apt, recs] of procRecords) {
  const groups = new Map();
  for (const r of recs) pushTo(groups, `${r[12]}|${trimmed(r, 14, 19)}`, r);
  const approaches = [];
  const departures = [];
  const arrivals = [];
  for (const [key, list] of groups) {
    const [sub, id] = key.split('|');
    if (sub === 'F') {
      const a = buildApproach(apt, id, list);
      if (a) approaches.push(a);
    } else {
      const p = buildTerminalProcedure(apt, sub === 'D' ? 'SID' : 'STAR', id, list);
      if (p) (sub === 'D' ? departures : arrivals).push(p);
    }
  }
  if (!approaches.length && !departures.length && !arrivals.length) continue;

  const thresholds = [...(runways.get(apt)?.values() ?? [])]
    .sort((a, b) => a.ident.localeCompare(b.ident, 'en', { numeric: true }))
    .map((t) => ({
      ident: t.ident,
      lat: r5(t.lat),
      lon: r5(t.lon),
      elevationFt: t.elevationFt ?? airports.get(apt)?.elevFt ?? 0,
      tchFt: t.tchFt || null,
      courseMag: t.courseMag,
      lengthFt: t.lengthFt || null,
    }));
  const file = { v: 1, airport: apt, cycle: CYCLE, runways: thresholds, approaches, departures, arrivals };
  const json = JSON.stringify(file);
  fs.writeFileSync(path.join(PROC_OUT, `${apt}.json`), json);
  procAirports.push(apt);
  totals.procBytes += json.length;
  totals.approaches += approaches.length;
  totals.sids += departures.length;
  totals.stars += arrivals.length;
  for (const a of approaches) {
    totals.transitions += a.transitions.length;
    totals.legs += a.final.length + a.missed.length + a.transitions.reduce((n, t) => n + t.legs.length, 0);
  }
  for (const p of [...departures, ...arrivals]) {
    totals.transitions += p.runwayTransitions.length + p.enrouteTransitions.length;
    totals.legs += p.common.length + [...p.runwayTransitions, ...p.enrouteTransitions].reduce((n, t) => n + t.legs.length, 0);
  }
}
procAirports.sort();
const indexJson = JSON.stringify({ v: 1, cycle: CYCLE, airports: procAirports });
fs.writeFileSync(path.join(PROC_OUT, 'index.json'), indexJson);
totals.procBytes += indexJson.length;

// ---------------------------------------------------------------------------
// fixes.json: every enroute waypoint, and the terminal waypoints that fit the budget

const fixRow = (w, region) => [w.ident, r5(w.lat), r5(w.lon), region];
const enrouteRows = [...enrouteWpts.values()].map((w) => fixRow(w, 'ENRT'));
const samePlace = (row, w) => Math.abs(row[1] - w.lat) < 1e-4 && Math.abs(row[2] - w.lon) < 1e-4;
const enrouteAt = new Map(enrouteRows.map((row) => [row[0], row]));

// One row per physical terminal waypoint: arc centers are not waypoints, and a fix coded
// as an enroute waypoint or at several airports keeps a single entry (its best role).
const terminalByRole = ROLE_NAMES.map(() => []);
const terminalSeen = new Map();
for (const w of terminalWpts.values()) {
  if (w.arcCenter) continue;
  const e = enrouteAt.get(w.ident);
  if (e && samePlace(e, w)) continue;
  const role = terminalRole.get(`${w.airport}|${w.ident}`) ?? ROLE.unused;
  const twin = (terminalSeen.get(w.ident) ?? []).find((t) => samePlace(t.row, w));
  if (twin) {
    if (role > twin.role) twin.role = role;
    continue;
  }
  const entry = { row: fixRow(w, w.airport), role };
  pushTo(terminalSeen, w.ident, entry);
}
for (const list of terminalSeen.values()) for (const t of list) terminalByRole[t.role].push(t.row);

// Approach IAF/IF/FAF always; then each lower role only if all of it still fits, so
// what the file holds is predictable (never "half the step-down fixes").
const rowBytes = (row) => JSON.stringify(row).length + 1;
let fixBytes = JSON.stringify({ v: 1, cycle: CYCLE, fixes: [] }).length + enrouteRows.reduce((n, row) => n + rowBytes(row), 0);
const keptRoles = [];
const leftOutRoles = [];
for (let role = ROLE.approachKey; role >= ROLE.unused; role--) {
  const rows = terminalByRole[role];
  const bytes = rows.reduce((n, row) => n + rowBytes(row), 0);
  if (role === ROLE.approachKey || (fixBytes + bytes <= FIX_BUDGET_BYTES && leftOutRoles.length === 0)) {
    fixBytes += bytes;
    keptRoles.push(role);
  } else leftOutRoles.push(role);
}
const fixRows = [...enrouteRows, ...keptRoles.flatMap((role) => terminalByRole[role])].sort((a, b) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0,
);
const fixesJson = JSON.stringify({ v: 1, cycle: CYCLE, fixes: fixRows });
fs.writeFileSync(path.join(OUT, 'fixes.json'), fixesJson);

// ---------------------------------------------------------------------------
// localizers.json

const locRows = [...localizers.values()]
  .filter((l) => l.courseMag !== null && l.freqKhz > 0)
  .sort((a, b) => (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : a.airport < b.airport ? -1 : 1))
  .map((l) => {
    const thr = runways.get(l.airport)?.get(l.runway);
    return [
      l.ident,
      l.airport,
      l.runway,
      l.freqKhz,
      r5(l.lat),
      r5(l.lon),
      l.courseMag,
      l.widthDeg ?? 5,
      l.gs ? r5(l.gs.lat) : null,
      l.gs ? r5(l.gs.lon) : null,
      l.gs ? l.gs.angleDeg : null,
      l.gs ? l.gs.elevationFt : null,
      thr ? r5(thr.lat) : null,
      thr ? r5(thr.lon) : null,
      thr ? thr.elevationFt : null,
      thr ? (l.gsTchFt ?? thr.tchFt ?? null) : null,
      l.magVar,
    ];
  });
const localizersJson = JSON.stringify({ v: 1, cycle: CYCLE, items: locRows });
fs.writeFileSync(path.join(OUT, 'localizers.json'), localizersJson);

// ---------------------------------------------------------------------------
// airways.json: V, T, J and Q routes, one entry per continuous segment

const AIRWAY = /^[VTJQ]\d+$/;
const airwayGroups = new Map();
for (const r of airwayRecords) {
  const name = trimmed(r, 14, 18);
  if (!AIRWAY.test(name)) continue;
  pushTo(airwayGroups, `${col(r, 2, 4)}|${name}`, r);
}
const airwayRows = [];
let airwayGaps = 0;
// Names repeat across customer areas (V3 runs in Florida to Maine and on Hawaii): the
// contiguous US (USA) goes first, since NavDatabase.airway(name) returns the first entry.
const areaRank = (key) => (key.startsWith('USA|') ? 0 : 1);
for (const [key, list] of [...airwayGroups].sort((a, b) => areaRank(a[0]) - areaRank(b[0]))) {
  const name = key.split('|')[1];
  list.sort((a, b) => Number(col(a, 26, 29)) - Number(col(b, 26, 29)));
  const level = 'LHB'.includes(list[0][45]) && list[0][45] !== ' ' ? list[0][45] : /^[VT]/.test(name) ? 'L' : 'H';
  let segment = [];
  const flush = () => {
    if (segment.length >= 2) airwayRows.push([name, level, segment]);
    segment = [];
  };
  for (const r of list) {
    const ident = trimmed(r, 30, 34);
    const fix = resolveFix('', ident, col(r, 35, 36), col(r, 37, 38));
    if (fix) segment.push([ident, fix.lat, fix.lon]);
    else {
      // Never draw a line through a fix we cannot place.
      airwayGaps++;
      flush();
    }
    // Col 41 E: end of a continuous segment; the airway resumes at the next record.
    if (r[40] === 'E') flush();
  }
  flush();
}
// Stable sort: segments of one airway keep their area and along-route order.
airwayRows.sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
const airwaysJson = JSON.stringify({ v: 1, cycle: CYCLE, items: airwayRows });
fs.writeFileSync(path.join(OUT, 'airways.json'), airwaysJson);

// ---------------------------------------------------------------------------
// Report

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const sortedCounts = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
const roleList = (roles) => roles.map((role) => `${terminalByRole[role].length} ${ROLE_NAMES[role]}`).join(', ');
console.log(`CIFP cycle ${CYCLE}`);
console.log(
  `fixes.json       ${fixRows.length} fixes, ${mb(fixesJson.length)} (${fixesJson.length} bytes): ${enrouteRows.length} enroute; terminal: ${roleList(keptRoles)}`,
);
if (leftOutRoles.length) console.log(`                 left out for the ${FIX_BUDGET_BYTES} byte budget: ${roleList(leftOutRoles)}`);
console.log(`localizers.json  ${locRows.length} localizers (${locRows.filter((l) => l[10] !== null).length} with glideslope), ${kb(localizersJson.length)}`);
console.log(
  `airways.json     ${airwayRows.length} segments of ${new Set(airwayRows.map((a) => a[0])).size} airways, ` +
    `${airwayRows.reduce((n, a) => n + a[2].length, 0)} fixes, ${kb(airwaysJson.length)}${airwayGaps ? `, ${airwayGaps} unresolved fixes` : ''}`,
);
console.log(
  `proc/            ${procAirports.length} airports + index.json (${procAirports.length + 1} files), ${mb(totals.procBytes)}: ` +
    `${totals.approaches} approaches, ${totals.sids} SIDs, ${totals.stars} STARs, ${totals.transitions} transitions, ${totals.legs} legs`,
);
console.log(`approach types   ${sortedCounts(stats.approachTypes)}`);
console.log(`path terminators ${sortedCounts(stats.pathTerminators)}`);
console.log(`first legs       ${sortedCounts(stats.firstLegs)}`);
console.log(
  `RF legs ${stats.rfLegs} (${stats.rfRadiusMismatch} with center-to-fix distance off the radius by > 0.05 nm), AF legs ${stats.afLegs}, ` +
    `straight-in approaches without a vertical path (VDA 000: LP-only, dive and drive) ${stats.noFinalApproachPath}, ` +
    `RNAV/GPS approaches without a level of service record (minima = LNAV) ${stats.defaultedMinima}`,
);
const unresolvedTotal = [...stats.unresolved.values()].reduce((n, v) => n + v, 0);
console.log(`unresolved fix references ${unresolvedTotal}${unresolvedTotal ? `: ${[...stats.unresolved.keys()].slice(0, 20).join(', ')}` : ''}`);
if (stats.dropped.length) console.log(`left out (a fix the file does not define): ${stats.dropped.join(', ')}`);
