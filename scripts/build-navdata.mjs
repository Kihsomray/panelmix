#!/usr/bin/env node
/*
 * Builds the trainer's navigation database and basemap into public/data.
 *
 *   node scripts/build-navdata.mjs [--cache DIR]
 *
 * Sources (all public domain):
 *   - OurAirports (https://ourairports.com/data/): airports, runways, frequencies, navaids
 *   - NOAA World Magnetic Model 2025, via the `geomagnetism` package: magnetic variation grid
 *   - Natural Earth 1:50m (https://www.naturalearthdata.com): coastline, lakes, borders
 *
 * Output is compact positional arrays; src/core/navdb.ts documents and decodes them.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import geomagnetism from 'geomagnetism';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const cacheArg = process.argv.indexOf('--cache');
const CACHE = cacheArg > 0 ? process.argv[cacheArg + 1] : path.join(ROOT, '.cache');

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';
const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

/** Area covered by the basemap and magnetic grid: the US including Alaska and Hawaii. */
const BOUNDS = { south: 15, north: 72, west: -180, east: -60 };
const MAGVAR_DATE = new Date('2026-11-01T00:00:00Z');

async function fetchCached(url, name) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return text;
  }
}

/** RFC 4180 CSV parser: quoted fields, embedded commas, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const round = (n, places) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
const num = (s) => (s === '' || s === undefined ? null : Number(s));

/**
 * The identifier a Garmin database shows: the ICAO code when there is one,
 * otherwise the FAA location identifier (W05, 0V4). OurAirports leaves many
 * ICAO codes blank but carries them as the GPS code (KJYO).
 */
function garminIdent(a) {
  if (a.icao_code) return a.icao_code;
  if (/^[A-Z]{4}$/.test(a.gps_code)) return a.gps_code;
  return a.local_code || a.ident;
}

const SURFACE_HARD = /^(ASP|ASPH|CON|CONC|PEM|BIT|PAV|TAR|MAC|PSP|ASPH-CONC|CONC-ASPH|ASPH-G|ASPH-F|ASPH-E|ASPH-P|CONC-G|CONC-E|CONC-F)/i;
const SURFACE_WATER = /^(WATER|W)$/i;
const surfaceCode = (s) => (SURFACE_WATER.test(s) ? 2 : SURFACE_HARD.test(s) ? 0 : 1);

/** OurAirports frequency types to the short labels avionics use. */
const FREQ_TYPES = {
  TWR: 'TWR', GND: 'GND', ATIS: 'ATIS', 'D-ATIS': 'ATIS', AWOS: 'AWOS', 'AWOS-3': 'AWOS', 'AWOS-3P': 'AWOS',
  'AWOS-3PT': 'AWOS', ASOS: 'ASOS', CTAF: 'CTAF', UNIC: 'UNICOM', UNICOM: 'UNICOM', CLD: 'CLNC', CLNC: 'CLNC',
  'CLNC DEL': 'CLNC', APP: 'APP', DEP: 'DEP', 'A/D': 'APP', CNTR: 'CTR', CTR: 'CTR', FSS: 'FSS', RDO: 'FSS',
  'A/G': 'UNICOM', MULTICOM: 'MULTI', AFIS: 'AFIS', RCO: 'RCO',
};

async function buildNavdata() {
  const [airportsCsv, runwaysCsv, freqsCsv, navaidsCsv] = await Promise.all([
    fetchCached(`${OURAIRPORTS}/airports.csv`, 'airports.csv'),
    fetchCached(`${OURAIRPORTS}/runways.csv`, 'runways.csv'),
    fetchCached(`${OURAIRPORTS}/airport-frequencies.csv`, 'airport-frequencies.csv'),
    fetchCached(`${OURAIRPORTS}/navaids.csv`, 'navaids.csv'),
  ]);

  const runwaysByAirport = new Map();
  for (const r of parseCsv(runwaysCsv)) {
    if (r.closed === '1') continue;
    const list = runwaysByAirport.get(r.airport_ref) ?? [];
    list.push(r);
    runwaysByAirport.set(r.airport_ref, list);
  }
  const freqsByAirport = new Map();
  for (const f of parseCsv(freqsCsv)) {
    const list = freqsByAirport.get(f.airport_ref) ?? [];
    list.push(f);
    freqsByAirport.set(f.airport_ref, list);
  }

  const airports = [];
  const seen = new Set();
  for (const a of parseCsv(airportsCsv)) {
    if (a.iso_country !== 'US') continue;
    if (!['small_airport', 'medium_airport', 'large_airport'].includes(a.type)) continue;
    const ident = garminIdent(a);
    // Public-use fields carry an ICAO code or a three-character FAA identifier;
    // four-character identifiers like VA67 are almost all private strips.
    if (!(/^[A-Z]{4}$/.test(ident) || /^[A-Z0-9]{3}$/.test(ident))) continue;
    if (seen.has(ident)) continue;
    seen.add(ident);

    const runways = (runwaysByAirport.get(a.id) ?? [])
      .filter((r) => Number(r.length_ft) > 0 && r.le_ident)
      .map((r) => [
        r.le_ident,
        r.he_ident,
        Number(r.length_ft),
        num(r.width_ft) ?? 0,
        surfaceCode(r.surface),
        r.lighted === '1' ? 1 : 0,
        num(r.le_latitude_deg) === null ? null : round(Number(r.le_latitude_deg), 5),
        num(r.le_longitude_deg) === null ? null : round(Number(r.le_longitude_deg), 5),
        num(r.he_latitude_deg) === null ? null : round(Number(r.he_latitude_deg), 5),
        num(r.he_longitude_deg) === null ? null : round(Number(r.he_longitude_deg), 5),
        num(r.le_heading_degT) === null ? null : round(Number(r.le_heading_degT), 1),
      ])
      .sort((x, y) => y[2] - x[2]);
    if (runways.length === 0) continue;

    const freqs = [];
    const freqSeen = new Set();
    for (const f of freqsByAirport.get(a.id) ?? []) {
      const type = FREQ_TYPES[f.type?.toUpperCase()] ?? null;
      const mhz = Number(f.frequency_mhz);
      if (!type || !(mhz >= 108 && mhz < 137)) continue;
      const khz = Math.round(mhz * 1000);
      const key = `${type}:${khz}`;
      if (freqSeen.has(key)) continue;
      freqSeen.add(key);
      freqs.push([type, khz, (f.description || '').slice(0, 40)]);
    }

    const towered = freqs.some((f) => f[0] === 'TWR');
    const lit = runways.some((r) => r[5] === 1);
    const hard = runways[0][4] === 0;
    const flags = (towered ? 1 : 0) | (lit ? 2 : 0) | (hard ? 4 : 0);
    const size = a.type === 'large_airport' ? 2 : a.type === 'medium_airport' ? 1 : 0;

    airports.push([
      ident,
      a.name,
      a.municipality || '',
      (a.iso_region || '').replace(/^US-/, ''),
      round(Number(a.latitude_deg), 5),
      round(Number(a.longitude_deg), 5),
      num(a.elevation_ft) ?? 0,
      size,
      flags,
      runways,
      freqs,
    ]);
  }
  airports.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  const NAVAID_TYPES = new Set(['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME']);
  const navaids = parseCsv(navaidsCsv)
    .filter((n) => n.iso_country === 'US' && NAVAID_TYPES.has(n.type) && n.frequency_khz)
    .map((n) => [
      n.ident,
      n.name,
      n.type,
      Number(n.frequency_khz),
      round(Number(n.latitude_deg), 5),
      round(Number(n.longitude_deg), 5),
      num(n.elevation_ft) ?? 0,
      round(num(n.magnetic_variation_deg) ?? 0, 1),
      n.power || '',
    ])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  return {
    v: 1,
    source: 'OurAirports (public domain)',
    built: new Date().toISOString().slice(0, 10),
    airports,
    navaids,
  };
}

function buildMagvar() {
  const model = geomagnetism.model(MAGVAR_DATE);
  const step = 1;
  const values = [];
  for (let lat = BOUNDS.south; lat <= BOUNDS.north; lat += step) {
    for (let lon = BOUNDS.west; lon <= BOUNDS.east; lon += step) {
      values.push(round(model.point([lat, lon]).decl, 1));
    }
  }
  return {
    v: 1,
    model: 'WMM-2025',
    date: MAGVAR_DATE.toISOString().slice(0, 10),
    south: BOUNDS.south,
    north: BOUNDS.north,
    west: BOUNDS.west,
    east: BOUNDS.east,
    step,
    values,
  };
}

// Basemap ------------------------------------------------------------------

/** Douglas-Peucker on [lon, lat] pairs, tolerance in degrees. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d2;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const inBounds = ([lon, lat]) =>
  lon >= BOUNDS.west - 1 && lon <= BOUNDS.east + 1 && lat >= BOUNDS.south - 1 && lat <= BOUNDS.north + 1;

/** Splits a line into the runs that fall inside the bounds, then simplifies and flattens each. */
function clipAndPack(line, tolerance) {
  const out = [];
  let run = [];
  for (const p of line) {
    if (inBounds(p)) run.push(p);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  }
  if (run.length) out.push(run);
  return out
    .map((r) => simplify(r, tolerance))
    .filter((r) => r.length >= 2)
    .map((r) => r.flatMap(([lon, lat]) => [round(lon, 3), round(lat, 3)]));
}

function linesOf(geojson, filter = () => true) {
  const lines = [];
  for (const f of geojson.features) {
    if (!filter(f.properties)) continue;
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    else if (g.type === 'Polygon') lines.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) lines.push(p[0]);
  }
  return lines;
}

async function buildBasemap() {
  const load = async (name) => JSON.parse(await fetchCached(`${NATURAL_EARTH}/${name}.geojson`, `${name}.geojson`));
  const [coast, lakes, states, borders] = await Promise.all([
    load('ne_50m_coastline'),
    load('ne_50m_lakes'),
    load('ne_50m_admin_1_states_provinces_lines'),
    load('ne_50m_admin_0_boundary_lines_land'),
  ]);
  const tol = 0.015;
  const pack = (lines) => lines.flatMap((l) => clipAndPack(l, tol));
  return {
    v: 1,
    source: 'Natural Earth 1:50m (public domain)',
    coast: pack(linesOf(coast)),
    lakes: pack(linesOf(lakes)),
    states: pack(linesOf(states, (p) => ['USA', 'CAN', 'MEX'].includes(p.ADM0_A3))),
    borders: pack(linesOf(borders)),
  };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const [navdata, basemap] = await Promise.all([buildNavdata(), buildBasemap()]);
  const magvar = buildMagvar();
  const write = async (name, data) => {
    const text = JSON.stringify(data);
    await fs.writeFile(path.join(OUT, name), text);
    console.log(`${name.padEnd(16)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
  };
  await write('navdata.json', navdata);
  await write('magvar.json', magvar);
  await write('basemap.json', basemap);
  console.log(`${navdata.airports.length} airports, ${navdata.navaids.length} navaids`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
