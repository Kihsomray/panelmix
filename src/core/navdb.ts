import { bearing, distanceNm, radioHorizonNm, type LatLon } from './geo';

/*
 * The navigation database: airports (with runways and frequencies) and radio
 * navaids, decoded from public/data/navdata.json. Lookups mirror what a real
 * navigator offers: exact identifier, Garmin-style spell-ahead completion,
 * nearest lists and tuning a navaid by frequency.
 */

/** `fix`: an RNAV waypoint or intersection from the CIFP (enroute or terminal). */
export type WaypointKind = 'airport' | 'vor' | 'ndb' | 'fix' | 'user';

/**
 * A waypoint as stored in flight plans and passed between devices: plain,
 * serialisable data. Look the full record up in the database when needed.
 */
export interface Waypoint {
  readonly kind: WaypointKind;
  readonly ident: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export type RunwaySurface = 'hard' | 'soft' | 'water';

export interface RunwayEnd {
  readonly ident: string;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly headingTrue: number | null;
}

export interface Runway {
  /** "17/35" */
  readonly name: string;
  readonly ends: readonly [RunwayEnd, RunwayEnd];
  readonly lengthFt: number;
  readonly widthFt: number;
  readonly surface: RunwaySurface;
  readonly lighted: boolean;
}

export type FrequencyType =
  | 'ATIS' | 'AWOS' | 'ASOS' | 'CLNC' | 'GND' | 'TWR' | 'CTAF' | 'UNICOM' | 'MULTI'
  | 'APP' | 'DEP' | 'CTR' | 'FSS' | 'AFIS' | 'RCO';

export interface AirportFrequency {
  readonly type: FrequencyType;
  readonly khz: number;
  readonly description: string;
}

export interface Airport extends Waypoint {
  readonly kind: 'airport';
  readonly city: string;
  readonly state: string;
  readonly elevationFt: number;
  /** 0 small, 1 medium, 2 large. */
  readonly size: 0 | 1 | 2;
  readonly towered: boolean;
  readonly lighted: boolean;
  readonly hardSurface: boolean;
  /** Longest first. */
  readonly runways: readonly Runway[];
  readonly frequencies: readonly AirportFrequency[];
}

export type NavaidType = 'VOR' | 'VOR-DME' | 'VORTAC' | 'NDB' | 'NDB-DME';

export interface Navaid extends Waypoint {
  readonly kind: 'vor' | 'ndb';
  readonly type: NavaidType;
  /** kHz: 113500 for a VOR on 113.50, 382 for an NDB on 382 kHz. */
  readonly freqKhz: number;
  readonly elevationFt: number;
  /** Station declination used for radials, east positive. */
  readonly magVar: number;
  readonly hasDme: boolean;
  /** Service range class from the source data: HIGH, MEDIUM (low altitude), LOW (terminal). */
  readonly power: string;
}

export interface Fix extends Waypoint {
  readonly kind: 'fix';
  /** "ENRT" for enroute waypoints, or the airport a terminal waypoint belongs to ("KJYO"). */
  readonly region: string;
}

/** A localizer (with its glideslope when it is an ILS), from the CIFP. */
export interface Localizer {
  readonly ident: string;
  readonly airport: string;
  readonly runway: string;
  readonly freqKhz: number;
  /** Localizer antenna. */
  readonly lat: number;
  readonly lon: number;
  /** Front course, degrees magnetic. */
  readonly courseMag: number;
  /** Full course width, degrees (typically 3 to 6). */
  readonly widthDeg: number;
  readonly glideslope: {
    readonly lat: number;
    readonly lon: number;
    readonly angleDeg: number;
    readonly elevationFt: number;
  } | null;
  readonly threshold: { readonly lat: number; readonly lon: number; readonly elevationFt: number; readonly tchFt: number } | null;
  /** Station declination used for the course, east positive. */
  readonly magVar: number;
}

export interface Airway {
  /** "V143", "T289", "J6", "Q80" */
  readonly name: string;
  /** L low, H high, B both. */
  readonly level: 'L' | 'H' | 'B';
  readonly fixes: readonly { readonly ident: string; readonly lat: number; readonly lon: number }[];
}

export type AnyWaypoint = Airport | Navaid | Fix | Waypoint;

export interface NearestResult<T> {
  readonly item: T;
  readonly distanceNm: number;
  readonly bearingTrue: number;
}

export interface NearestAirportFilter {
  readonly minRunwayFt?: number;
  readonly surface?: 'any' | 'hard' | 'hard-soft';
}

// Raw positional format written by scripts/build-navdata.mjs.
type RawRunway = [string, string, number, number, 0 | 1 | 2, 0 | 1, number | null, number | null, number | null, number | null, number | null];
type RawAirport = [string, string, string, string, number, number, number, 0 | 1 | 2, number, RawRunway[], [FrequencyType, number, string][]];
type RawNavaid = [string, string, NavaidType, number, number, number, number, number, string];
/** [ident, lat, lon, region] */
export type RawFix = [string, number, number, string];
/** [ident, airport, runway, freqKhz, lat, lon, courseMag, widthDeg, gsLat, gsLon, gsAngle, gsElevFt, thrLat, thrLon, thrElevFt, tchFt, magVar] */
export type RawLocalizer = [
  string, string, string, number, number, number, number, number,
  number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number | null, number,
];
/** [name, level, [[ident, lat, lon], ...]] */
export type RawAirway = [string, 'L' | 'H' | 'B', [string, number, number][]];

/** Optional CIFP-derived data (public/data/fixes.json, localizers.json, airways.json). */
export interface RawNavExtras {
  readonly fixes?: readonly RawFix[];
  readonly localizers?: readonly RawLocalizer[];
  readonly airways?: readonly RawAirway[];
}

export interface RawNavdata {
  readonly v: 1;
  readonly built: string;
  readonly airports: RawAirport[];
  readonly navaids: RawNavaid[];
}

const SURFACES: readonly RunwaySurface[] = ['hard', 'soft', 'water'];

function decodeAirport(r: RawAirport): Airport {
  const [ident, name, city, state, lat, lon, elev, size, flags, runways, freqs] = r;
  return {
    kind: 'airport',
    ident,
    name,
    city,
    state,
    lat,
    lon,
    elevationFt: elev,
    size,
    towered: (flags & 1) !== 0,
    lighted: (flags & 2) !== 0,
    hardSurface: (flags & 4) !== 0,
    runways: runways.map(([le, he, len, wid, surf, lit, leLat, leLon, heLat, heLon, leHdg]) => ({
      name: `${le}/${he}`,
      ends: [
        { ident: le, lat: leLat, lon: leLon, headingTrue: leHdg },
        { ident: he, lat: heLat, lon: heLon, headingTrue: leHdg === null ? null : (leHdg + 180) % 360 },
      ],
      lengthFt: len,
      widthFt: wid,
      surface: SURFACES[surf] ?? 'soft',
      lighted: lit === 1,
    })),
    frequencies: freqs.map(([type, khz, description]) => ({ type, khz, description })),
  };
}

function decodeLocalizer(r: RawLocalizer): Localizer {
  const [ident, airport, runway, freqKhz, lat, lon, courseMag, widthDeg, gsLat, gsLon, gsAngle, gsElev, thrLat, thrLon, thrElev, tch, magVar] = r;
  return {
    ident,
    airport,
    runway,
    freqKhz,
    lat,
    lon,
    courseMag,
    widthDeg,
    glideslope:
      gsLat !== null && gsLon !== null && gsAngle !== null ? { lat: gsLat, lon: gsLon, angleDeg: gsAngle, elevationFt: gsElev ?? 0 } : null,
    threshold:
      thrLat !== null && thrLon !== null ? { lat: thrLat, lon: thrLon, elevationFt: thrElev ?? 0, tchFt: tch ?? 50 } : null,
    magVar,
  };
}

function decodeNavaid(r: RawNavaid): Navaid {
  const [ident, name, type, freqKhz, lat, lon, elev, magVar, power] = r;
  const isNdb = type.startsWith('NDB');
  return {
    kind: isNdb ? 'ndb' : 'vor',
    ident,
    name,
    type,
    freqKhz,
    lat,
    lon,
    elevationFt: elev,
    magVar,
    hasDme: type === 'VOR-DME' || type === 'VORTAC' || type === 'NDB-DME',
    power,
  };
}

/** Service range by class, nm. Line of sight limits it further at low altitude. */
const SERVICE_RANGE_NM: Record<string, number> = { HIGH: 130, MEDIUM: 40, LOW: 25 };

const KIND_ORDER: Record<WaypointKind, number> = { airport: 0, vor: 1, ndb: 2, fix: 3, user: 4 };
const CELL_DEG = 1;

export class NavDatabase {
  readonly airports: readonly Airport[];
  readonly navaids: readonly Navaid[];
  readonly built: string;
  /** Every identifier, sorted, for spell-ahead and prefix search. */
  private readonly byIdent: readonly AnyWaypoint[];
  private readonly navaidsByFreq = new Map<number, Navaid[]>();
  private readonly grid = new Map<string, { airports: Airport[]; navaids: Navaid[] }>();

  readonly fixes: readonly Fix[];
  readonly localizers: readonly Localizer[];
  readonly airways: readonly Airway[];
  private readonly localizersByFreq = new Map<number, Localizer[]>();
  private readonly airwaysByFix = new Map<string, Airway[]>();

  constructor(raw: RawNavdata, extras: RawNavExtras = {}) {
    this.built = raw.built;
    this.airports = raw.airports.map(decodeAirport);
    this.navaids = raw.navaids.map(decodeNavaid);
    this.fixes = (extras.fixes ?? []).map(([ident, lat, lon, region]) => ({ kind: 'fix', ident, name: ident, lat, lon, region }));
    this.localizers = (extras.localizers ?? []).map(decodeLocalizer);
    this.airways = (extras.airways ?? []).map(([name, level, fixes]) => ({
      name,
      level,
      fixes: fixes.map(([ident, lat, lon]) => ({ ident, lat, lon })),
    }));
    for (const l of this.localizers) {
      const list = this.localizersByFreq.get(l.freqKhz) ?? [];
      list.push(l);
      this.localizersByFreq.set(l.freqKhz, list);
    }
    for (const w of this.airways) {
      for (const f of w.fixes) {
        const list = this.airwaysByFix.get(f.ident) ?? [];
        list.push(w);
        this.airwaysByFix.set(f.ident, list);
      }
    }
    this.byIdent = [...this.airports, ...this.navaids, ...this.fixes].sort(
      (a, b) => (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
    );
    for (const n of this.navaids) {
      const list = this.navaidsByFreq.get(n.freqKhz) ?? [];
      list.push(n);
      this.navaidsByFreq.set(n.freqKhz, list);
    }
    for (const a of this.airports) this.cell(a.lat, a.lon).airports.push(a);
    for (const n of this.navaids) this.cell(n.lat, n.lon).navaids.push(n);
  }

  private cellKey(lat: number, lon: number) {
    return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
  }

  private cell(lat: number, lon: number) {
    const key = this.cellKey(lat, lon);
    let c = this.grid.get(key);
    if (!c) {
      c = { airports: [], navaids: [] };
      this.grid.set(key, c);
    }
    return c;
  }

  /** All waypoints with exactly this identifier: airports first, then VORs, then NDBs. */
  find(ident: string): AnyWaypoint[] {
    const key = ident.trim().toUpperCase();
    if (!key) return [];
    const out: AnyWaypoint[] = [];
    for (let i = this.lowerBound(key); i < this.byIdent.length && this.byIdent[i]!.ident === key; i++) {
      out.push(this.byIdent[i]!);
    }
    return out;
  }

  /** The first match, or the one nearest to `near` when an identifier is shared. */
  get(ident: string, near?: LatLon): AnyWaypoint | undefined {
    const all = this.find(ident);
    if (all.length <= 1 || !near) return all[0];
    return all.reduce((best, w) => (distanceNm(near, w) < distanceNm(near, best) ? w : best));
  }

  airport(ident: string): Airport | undefined {
    return this.find(ident).find((w): w is Airport => w.kind === 'airport');
  }

  /**
   * Garmin "spell-ahead": the first identifier, alphabetically, that starts
   * with what has been typed so far.
   */
  complete(prefix: string): AnyWaypoint | undefined {
    const key = prefix.trim().toUpperCase();
    if (!key) return undefined;
    const w = this.byIdent[this.lowerBound(key)];
    return w && w.ident.startsWith(key) ? w : undefined;
  }

  /** Waypoints whose identifier starts with `prefix`, in identifier order. */
  search(prefix: string, limit = 20): AnyWaypoint[] {
    const key = prefix.trim().toUpperCase();
    if (!key) return [];
    const out: AnyWaypoint[] = [];
    for (let i = this.lowerBound(key); i < this.byIdent.length && out.length < limit; i++) {
      const w = this.byIdent[i]!;
      if (!w.ident.startsWith(key)) break;
      out.push(w);
    }
    return out;
  }

  /** Identifiers whose name or city contains `text` (case-insensitive), for search boxes. */
  searchByName(text: string, limit = 20): AnyWaypoint[] {
    const key = text.trim().toLowerCase();
    if (key.length < 2) return [];
    const out: AnyWaypoint[] = [];
    for (const a of this.airports) {
      if (a.name.toLowerCase().includes(key) || a.city.toLowerCase().includes(key)) {
        out.push(a);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  private lowerBound(key: string): number {
    let lo = 0;
    let hi = this.byIdent.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.byIdent[mid]!.ident < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Airports and navaids inside a lat/lon box, for map drawing. */
  inBox(south: number, west: number, north: number, east: number): { airports: Airport[]; navaids: Navaid[] } {
    const airports: Airport[] = [];
    const navaids: Navaid[] = [];
    for (let la = Math.floor(south / CELL_DEG); la <= Math.floor(north / CELL_DEG); la++) {
      for (let lo = Math.floor(west / CELL_DEG); lo <= Math.floor(east / CELL_DEG); lo++) {
        const c = this.grid.get(`${la}:${lo}`);
        if (!c) continue;
        for (const a of c.airports) if (a.lat >= south && a.lat <= north && a.lon >= west && a.lon <= east) airports.push(a);
        for (const n of c.navaids) if (n.lat >= south && n.lat <= north && n.lon >= west && n.lon <= east) navaids.push(n);
      }
    }
    return { airports, navaids };
  }

  /** Searches outward ring by ring until `count` results are certain. */
  private nearest<T extends LatLon>(
    pos: LatLon,
    count: number,
    pick: (cell: { airports: Airport[]; navaids: Navaid[] }) => readonly T[],
    accept: (item: T) => boolean,
    maxNm: number,
  ): NearestResult<T>[] {
    const results: NearestResult<T>[] = [];
    const cy = Math.floor(pos.lat / CELL_DEG);
    const cx = Math.floor(pos.lon / CELL_DEG);
    const nmPerCellLat = 60 * CELL_DEG;
    for (let ring = 0; ring < 40; ring++) {
      for (let y = cy - ring; y <= cy + ring; y++) {
        for (let x = cx - ring; x <= cx + ring; x++) {
          if (Math.max(Math.abs(y - cy), Math.abs(x - cx)) !== ring) continue;
          const c = this.grid.get(`${y}:${x}`);
          if (!c) continue;
          for (const item of pick(c)) {
            if (!accept(item)) continue;
            const d = distanceNm(pos, item);
            if (d <= maxNm) results.push({ item, distanceNm: d, bearingTrue: bearing(pos, item) });
          }
        }
      }
      // Everything within `ring` cells has been seen; stop once that radius covers the k-th result.
      const covered = ring * nmPerCellLat * Math.cos((Math.min(Math.abs(pos.lat) + ring, 89) * Math.PI) / 180);
      if (results.length >= count) {
        results.sort((a, b) => a.distanceNm - b.distanceNm);
        if (results[count - 1]!.distanceNm <= covered) break;
      }
      if (covered > maxNm) break;
    }
    return results.sort((a, b) => a.distanceNm - b.distanceNm).slice(0, count);
  }

  nearestAirports(pos: LatLon, count = 25, filter: NearestAirportFilter = {}, maxNm = 200): NearestResult<Airport>[] {
    const min = filter.minRunwayFt ?? 0;
    const surface = filter.surface ?? 'any';
    return this.nearest(
      pos,
      count,
      (c) => c.airports,
      (a) => {
        const longest = a.runways[0];
        if (!longest || longest.lengthFt < min) return false;
        if (surface === 'hard') return a.runways.some((r) => r.surface === 'hard');
        if (surface === 'hard-soft') return a.runways.some((r) => r.surface !== 'water');
        return true;
      },
      maxNm,
    );
  }

  nearestNavaids(pos: LatLon, count = 25, kind?: 'vor' | 'ndb', maxNm = 200): NearestResult<Navaid>[] {
    return this.nearest(pos, count, (c) => c.navaids, (n) => !kind || n.kind === kind, maxNm);
  }

  /**
   * The station a receiver tuned to `khz` would hear: the closest one on that
   * frequency inside its service volume and the line of sight.
   */
  tune(khz: number, pos: LatLon, altitudeFt: number): Navaid | null {
    const candidates = this.navaidsByFreq.get(khz);
    if (!candidates) return null;
    let best: Navaid | null = null;
    let bestD = Infinity;
    for (const n of candidates) {
      const d = distanceNm(pos, n);
      const range = Math.min(SERVICE_RANGE_NM[n.power] ?? 40, radioHorizonNm(altitudeFt - n.elevationFt, 30));
      if (d <= range && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * The localizer a receiver tuned to `khz` would capture: the closest one on
   * that frequency within 25 nm (localizer service volume, simplified).
   */
  tuneLocalizer(khz: number, pos: LatLon): Localizer | null {
    const candidates = this.localizersByFreq.get(khz);
    if (!candidates) return null;
    let best: Localizer | null = null;
    let bestD = 25;
    for (const l of candidates) {
      const d = distanceNm(pos, l);
      if (d <= bestD) {
        best = l;
        bestD = d;
      }
    }
    return best;
  }

  localizer(ident: string): Localizer | undefined {
    const key = ident.trim().toUpperCase();
    return this.localizers.find((l) => l.ident === key);
  }

  airway(name: string): Airway | undefined {
    const key = name.trim().toUpperCase();
    return this.airways.find((w) => w.name === key);
  }

  /** Airways that pass through a fix or navaid. */
  airwaysAt(ident: string): readonly Airway[] {
    return this.airwaysByFix.get(ident.trim().toUpperCase()) ?? [];
  }

  /** Strips a database record down to the serialisable waypoint stored in plans. */
  static toWaypoint(w: AnyWaypoint): Waypoint {
    return { kind: w.kind, ident: w.ident, name: w.name, lat: w.lat, lon: w.lon };
  }
}
