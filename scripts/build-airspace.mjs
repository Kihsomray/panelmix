#!/usr/bin/env node
/*
 * Builds public/data/airspace.json: US Class B, C and D airspace from the
 * FAA Class Airspace dataset (Aeronautical Information Services, public
 * domain, republished every 56 days on the FAA ArcGIS hub).
 *
 *   node scripts/build-airspace.mjs [--refresh]
 *
 * Downloads are cached in .cache/airspace-src/ (--refresh fetches a new copy).
 * The output format is documented in src/core/airspaceSource.ts.
 *
 * Limits: SFC floors become 0 and MSL values are kept. US B/C/D volumes are
 * all SFC or MSL in feet today; AGL limits (and SFC with a height, which the
 * dataset uses for some foreign areas) would be converted with the field
 * elevation of the volume's airport from public/data/navdata.json, and flight
 * levels with 100 ft per level. "Up to but not including" ceilings keep their
 * value.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'airspace-src');
const OUT = path.join(ROOT, 'public', 'data', 'airspace.json');
const NAVDATA = path.join(ROOT, 'public', 'data', 'navdata.json');

const HUB_DATASET = 'c6a62360338e408cb1512366ad61559e_0';
/** Where the hub said the dataset's FeatureServer layer was when this script was written. */
const KNOWN_LAYER = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0';
/** The service allows 2,000 records per request, but full-resolution pages that big time out. */
const PAGE_SIZE = 100;
/** US airspace only: foreign areas in the dataset (Canada, Mexico, the Bahamas, the Pacific) have no LOCAL_TYPE. */
const WHERE = "LOCAL_TYPE IN ('CLASS_B','CLASS_C','CLASS_D')";
/** Douglas-Peucker tolerance, degrees of latitude (about 220 m). */
export const SIMPLIFY_DEG = 0.002;
/** Coordinates are written with 4 decimals (11 m). */
const PLACES = 4;
/** Ceiling used for UNLTD (none in US B/C/D, kept for completeness). */
const UNLIMITED_FT = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= tries) throw new Error(`${url}: ${err instanceof Error ? err.message : err}`);
      await sleep(2000 * attempt);
    }
  }
}

async function readCache(name) {
  try {
    return await fs.readFile(path.join(CACHE, name), 'utf8');
  } catch {
    return null;
  }
}

/** The dataset's FeatureServer layer and effective date, looked up from the hub id. */
async function datasetInfo() {
  const cached = await readCache('layer.json');
  if (cached) return JSON.parse(cached);
  let info = { url: KNOWN_LAYER, effective: null };
  try {
    const meta = JSON.parse(await fetchText(`https://hub.arcgis.com/api/v3/datasets/${HUB_DATASET}`));
    const attrs = meta?.data?.attributes ?? {};
    // "Current Effective Date: 0901Z 29 Oct 2026 to 0901Z 24 Dec 2026"
    const m = /Effective Date:\s*\d{4}Z\s+(\d{1,2} \w{3} \d{4})/.exec(attrs.description ?? '');
    const effective = m ? new Date(`${m[1]} UTC`) : null;
    info = {
      url: attrs.url ?? KNOWN_LAYER,
      effective: effective && !Number.isNaN(effective.getTime()) ? effective.toISOString().slice(0, 10) : null,
    };
  } catch (err) {
    console.warn(`hub lookup failed (${err.message}); using ${KNOWN_LAYER}`);
  }
  await fs.writeFile(path.join(CACHE, 'layer.json'), JSON.stringify(info));
  return info;
}

/** Every B/C/D feature as GeoJSON, paging through the layer's query endpoint. */
async function downloadFeatures(layer) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const name = `page-${String(offset).padStart(5, '0')}.geojson`;
    let text = await readCache(name);
    if (!text) {
      const q = new URLSearchParams({
        where: WHERE,
        outFields: '*',
        orderByFields: 'OBJECTID',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
        f: 'geojson',
      });
      text = await fetchText(`${layer}/query?${q}`);
      const page = JSON.parse(text);
      if (page.error) throw new Error(`${layer}: ${JSON.stringify(page.error)}`);
      await fs.writeFile(path.join(CACHE, name), text);
      process.stdout.write(`\rdownloaded ${offset + page.features.length} features`);
    }
    const page = JSON.parse(text);
    features.push(...page.features);
    if (!page.properties?.exceededTransferLimit || page.features.length === 0) break;
  }
  process.stdout.write('\n');
  return features;
}

// ---------------------------------------------------------------------------
// Geometry

/** Perpendicular distance from p to segment a-b, in a flat frame where x is scaled by `k` (cos of the latitude). */
function segmentDistance(p, a, b, k) {
  const ax = a[0] * k;
  const bx = b[0] * k;
  const px = p[0] * k;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline of [lon, lat] points (iterative, so long arcs cannot overflow the stack). */
export function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const k = Math.cos((points[0][1] * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1;
    let worstD = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last], k);
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Simplifies a closed ring (first point repeated at the end). The ring is split
 * at the vertex farthest from its start so neither half degenerates.
 */
export function simplifyRing(ring, tolerance) {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return ring.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      far = i;
      farD = d;
    }
  }
  const a = simplifyLine(pts.slice(0, far + 1), tolerance);
  const b = simplifyLine([...pts.slice(far), pts[0]], tolerance);
  const out = [...a, ...b.slice(1)];
  // A tiny ring can collapse below a triangle; keep it at a finer tolerance.
  return out.length >= 4 || tolerance < 1e-5 ? out : simplifyRing(ring, tolerance / 4);
}

const roundTo = (n) => Number(n.toFixed(PLACES));

/** Rounds a closed ring and drops points that became duplicates. */
function packRing(ring) {
  const out = [];
  for (const [lon, lat] of ring) {
    const x = roundTo(lon);
    const y = roundTo(lat);
    if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue;
    out.push(x, y);
  }
  // Closed exactly: the map draws several rings in one array and splits them at the closing point.
  if (out[0] !== out[out.length - 2] || out[1] !== out[out.length - 1]) out.push(out[0], out[1]);
  return out;
}

/** Even-odd point in polygon over flat [lon, lat, ...] rings (outer ring then holes, same rule as src/core/airspace.ts). */
function contains(flat, lon, lat) {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i];
    const yi = flat[i + 1];
    const xj = flat[j];
    const yj = flat[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (degrees of latitude) from a point to the nearest edge of flat rings. */
function edgeDistance(flat, lon, lat, k) {
  let best = Infinity;
  const p = [lon, lat];
  for (let i = 2; i < flat.length; i += 2) {
    const d = segmentDistance(p, [flat[i - 2], flat[i - 1]], [flat[i], flat[i + 1]], k);
    if (d < best) best = d;
  }
  return best;
}

function bboxOf(flat) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    w = Math.min(w, flat[i]);
    e = Math.max(e, flat[i]);
    s = Math.min(s, flat[i + 1]);
    n = Math.max(n, flat[i + 1]);
  }
  return [w, s, e, n];
}

/** Area of a single closed ring, square degrees of latitude (x scaled by `k`). */
function ringArea(flat, k) {
  let a = 0;
  for (let i = 2; i < flat.length; i += 2) a += (flat[i - 2] * flat[i + 1] - flat[i] * flat[i - 1]) * k;
  return Math.abs(a / 2);
}

/**
 * Where a volume's altitude label goes: the point deepest inside it (largest
 * distance to its boundary), staying clear of airport and VOR symbols and of
 * the smaller volumes of the same airspace drawn inside it (a Class C core
 * inside its shelf). A grid search is plenty at map label sizes.
 */
function labelPoint(vol, siblings, obstacles) {
  const [w, s, e, n] = vol.bbox;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const siblingsInside = siblings.filter((o) => o !== vol && o.area < vol.area * 0.98 && overlaps(o.bbox, vol.bbox));
  const near = obstacles.filter((p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
  const search = (steps, inner) => {
    let best = null;
    let bestScore = -Infinity;
    for (let iy = 0; iy <= steps; iy++) {
      const lat = s + ((n - s) * iy) / steps;
      for (let ix = 0; ix <= steps; ix++) {
        const lon = w + ((e - w) * ix) / steps;
        const at = [roundTo(lon), roundTo(lat)];
        if (!contains(vol.ring, at[0], at[1])) continue;
        if (inner.some((o) => contains(o.ring, lon, lat))) continue;
        let score = edgeDistance(vol.ring, lon, lat, k);
        for (const o of inner) score = Math.min(score, edgeDistance(o.ring, lon, lat, k));
        for (const p of near) score = Math.min(score, Math.hypot((lon - p.lon) * k, lat - p.lat) * 0.8);
        // Ties (a Class D circle around its airport) go to the north-east, where charts put the label.
        score += ((lat - s) / (n - s) + (lon - w) / (e - w)) * 1e-6;
        if (score > bestScore) {
          bestScore = score;
          best = at;
        }
      }
    }
    return best;
  };
  // Slivers can miss a coarse grid, or lie wholly inside smaller siblings: search again finer, then anywhere.
  return search(24, siblingsInside) ?? search(24, []) ?? search(120, []) ?? [vol.ring[0], vol.ring[1]];
}

const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---------------------------------------------------------------------------
// Attributes

let airportsByIdent = null;
/** Symbols labels keep clear of: towered or larger airports and VORs. */
let symbols = [];

/** Field elevation of an airspace's airport, for AGL limits (navdata.json, built by build-navdata.mjs). */
async function fieldElevation(props) {
  if (!airportsByIdent) {
    airportsByIdent = new Map();
    try {
      const nav = JSON.parse(await fs.readFile(NAVDATA, 'utf8'));
      // [ident, name, city, state, lat, lon, elevation, size, flags, ...]; flags bit 1 = towered.
      for (const a of nav.airports) airportsByIdent.set(a[0], { lat: a[4], lon: a[5], elevationFt: a[6] });
      symbols = [
        ...nav.airports.filter((a) => a[7] > 0 || (a[8] & 1) !== 0).map((a) => ({ lat: a[4], lon: a[5] })),
        // [ident, name, type, freq, lat, lon, ...]
        ...nav.navaids.filter((n) => n[2].startsWith('VOR')).map((n) => ({ lat: n[4], lon: n[5] })),
      ];
    } catch {
      console.warn('navdata.json not found: AGL limits are treated as MSL');
    }
  }
  return airportOf(props)?.elevationFt ?? 0;
}

function airportOf(props) {
  if (!airportsByIdent) return null;
  for (const id of [props.ICAO_ID, props.IDENT, props.IDENT && `K${props.IDENT}`]) {
    const a = id && airportsByIdent.get(id);
    if (a) return a;
  }
  return null;
}

/** A floor or ceiling in ft MSL. */
async function limitFt(value, uom, code, props) {
  const v = Number(value) || 0;
  const ft = uom === 'FL' || code === 'STD' ? v * 100 : uom === 'M' ? v * 3.28084 : v;
  switch (code) {
    case 'SFC':
      // "SFC" with a height means above the surface.
      return ft === 0 ? 0 : ft + (await fieldElevation(props));
    case 'AGL':
      return ft + (await fieldElevation(props));
    case 'UNLTD':
      return UNLIMITED_FT;
    default:
      return Math.round(ft);
  }
}

// ---------------------------------------------------------------------------

export async function buildAirspace(features) {
  // Load the airport table once (for label placement and any AGL limits).
  await fieldElevation({});
  const volumes = [];
  for (const f of features) {
    const p = f.properties;
    const cls = p.CLASS;
    if (!['B', 'C', 'D'].includes(cls) || !f.geometry) continue;
    const lowerFt = await limitFt(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE, p);
    const upperFt = await limitFt(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE, p);
    const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const rings of polygons) {
      // Outer ring followed by its holes, each closed; the even-odd rule handles the holes.
      const ring = rings.flatMap((r) => packRing(simplifyRing(r, SIMPLIFY_DEG)));
      const bbox = bboxOf(ring);
      const k = Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180);
      volumes.push({ cls, name: p.NAME.trim(), lowerFt, upperFt, ring, bbox, area: ringArea(packRing(rings[0]), k), props: p });
    }
  }
  const byName = new Map();
  for (const v of volumes) byName.set(v.name, [...(byName.get(v.name) ?? []), v]);
  // Larger volumes first, so a map draws small ones (and their labels) on top.
  volumes.sort((a, b) => a.cls.localeCompare(b.cls) || b.area - a.area);
  return volumes.map((v) => [v.cls, v.name, v.lowerFt, v.upperFt, v.ring, labelPoint(v, byName.get(v.name), symbols)]);
}

async function main() {
  if (process.argv.includes('--refresh')) await fs.rm(CACHE, { recursive: true, force: true });
  await fs.mkdir(CACHE, { recursive: true });
  const info = await datasetInfo();
  const features = await downloadFeatures(info.url);
  const items = await buildAirspace(features);
  const counts = { B: 0, C: 0, D: 0 };
  let points = 0;
  for (const it of items) {
    counts[it[0]]++;
    points += it[4].length / 2;
  }
  const body = items.map((it) => JSON.stringify(it)).join(',\n');
  const json = `{"v":1,"effective":${JSON.stringify(info.effective)},"items":[\n${body}\n]}\n`;
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, json);
  console.log(
    `${items.length} volumes (B ${counts.B}, C ${counts.C}, D ${counts.D}), ${points} points, ` +
      `${(json.length / 1024).toFixed(0)} kB -> ${path.relative(ROOT, OUT)} (effective ${info.effective ?? 'unknown'})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
