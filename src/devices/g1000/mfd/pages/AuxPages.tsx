import { formatLat, formatLon } from '../../../../core/geo';
import { formatBearing, formatDistance, formatEte, formatUtc } from '../../../../ui/format';
import { AV } from '../../../../ui/instruments/palette';
import { Group, Win } from '../../screen/Frames';
import { localClock } from '../../shared/hooks';

/*
 * AUX group at modest depth: Trip Planning in automatic mode (cumulative
 * over the active flight plan, from sensor data), GPS Status (a simulated
 * constellation around the real position solution) and System Status.
 */

const FULL = { x: 156, y: 56, w: 864, h: 650 } as const;

export interface TripData {
  readonly from: string;
  readonly to: string;
  readonly dtkMag: number | null;
  readonly distanceNm: number | null;
  readonly eteSec: number | null;
  readonly groundSpeedKt: number;
  readonly fuelFlowGph: number;
  readonly fuelOnboardGal: number;
  readonly iasKt: number;
  readonly tasKt: number;
  readonly indicatedAltFt: number;
  readonly baroInHg: number;
  readonly oatC: number;
  readonly densityAltFt: number;
  readonly now: Date;
}

function Item({ label, value, unit = '' }: { label: string; value: string; unit?: string }) {
  return (
    <div class="g1000-row g1000-split">
      <span>{label}</span>
      <span class="g1000-cyan">
        {value}
        {unit && <small class="g1000-unit">{unit}</small>}
      </span>
    </div>
  );
}

const hhmm = (sec: number | null) => (sec === null || !Number.isFinite(sec) ? '__:__' : formatEte(sec));

export function TripPlanningPage({ t }: { t: TripData }) {
  const ff = t.fuelFlowGph;
  const endurSec = ff > 0.1 ? (t.fuelOnboardGal / ff) * 3600 : null;
  const reqGal = t.eteSec !== null && ff > 0 ? (t.eteSec / 3600) * ff : null;
  const remGal = reqGal !== null ? t.fuelOnboardGal - reqGal : null;
  const eta = t.eteSec !== null ? new Date(t.now.getTime() + t.eteSec * 1000) : null;
  return (
    <Win rect={FULL} class="g1000-panel g1000-trip">
      <div class="g1000-row g1000-split">
        <span>
          FPL <b class="g1000-cyan">00</b> LEG <b class="g1000-cyan">CUM</b>
        </span>
        <span>
          PAGE MODE - <b class="g1000-cyan">AUTOMATIC</b>
        </span>
      </div>
      <div class="g1000-trip-grid">
        <Group title="INPUT DATA">
          <div class="g1000-row g1000-cyan">
            {t.from} ➔ {t.to}
          </div>
          <Item label="DEP TIME" value={localClock(t.now).slice(0, 5)} unit="LCL" />
          <Item label="GS" value={String(Math.round(t.groundSpeedKt))} unit="KT" />
          <Item label="FUEL FLOW" value={ff.toFixed(1)} unit="GL/HR" />
          <Item label="FUEL ONBOARD" value={t.fuelOnboardGal.toFixed(1)} unit="GL" />
        </Group>
        <Group title="SENSOR DATA">
          <Item label="CALIBRATED AS" value={String(Math.round(t.iasKt))} unit="KT" />
          <Item label="IND ALTITUDE" value={String(Math.round(t.indicatedAltFt))} unit="FT" />
          <Item label="PRESSURE" value={t.baroInHg.toFixed(2)} unit="IN" />
          <Item label="TOTAL AIR TEMP" value={String(Math.round(t.oatC))} unit="°C" />
        </Group>
        <Group title="TRIP STATS">
          <Item label="DTK" value={formatBearing(t.dtkMag)} />
          <Item label="DIS" value={formatDistance(t.distanceNm)} unit="NM" />
          <Item label="ETE" value={hhmm(t.eteSec)} />
          <Item label="ETA" value={eta ? localClock(eta).slice(0, 5) : '__:__'} unit="LCL" />
          <Item label="ESA" value="_____" unit="FT" />
        </Group>
        <Group title="FUEL STATS">
          <Item label="EFFICIENCY" value={ff > 0.1 ? (t.groundSpeedKt / ff).toFixed(1) : '__._'} unit="NM/GL" />
          <Item label="TOTAL ENDUR" value={hhmm(endurSec)} />
          <Item label="REM FUEL" value={remGal !== null ? remGal.toFixed(1) : '__._'} unit="GL" />
          <Item label="REM ENDUR" value={remGal !== null && ff > 0.1 ? hhmm((remGal / ff) * 3600) : '__:__'} />
          <Item label="FUEL REQ" value={reqGal !== null ? reqGal.toFixed(1) : '__._'} unit="GL" />
          <Item label="TOTAL RANGE" value={endurSec !== null ? String(Math.round((endurSec / 3600) * t.groundSpeedKt)) : '___'} unit="NM" />
        </Group>
        <Group title="OTHER STATS">
          <Item label="DENSITY ALT" value={String(Math.round(t.densityAltFt))} unit="FT" />
          <Item label="TRUE AIRSPEED" value={String(Math.round(t.tasKt))} unit="KT" />
        </Group>
      </div>
    </Win>
  );
}

export interface GpsData {
  readonly lat: number;
  readonly lon: number;
  readonly altitudeFt: number;
  readonly groundSpeedKt: number;
  readonly trackMag: number;
  /** Sim time, s: the simulated satellites drift slowly across the sky. */
  readonly time: number;
}

/** A plausible fixed constellation (PRN, azimuth, elevation); the trainer has no ephemeris. */
const SATS: readonly [number, number, number][] = [
  [2, 40, 62],
  [5, 118, 35],
  [10, 205, 48],
  [12, 290, 22],
  [15, 330, 70],
  [18, 75, 15],
  [24, 160, 12],
  [25, 250, 58],
  [29, 20, 30],
  [31, 300, 44],
  [133, 225, 38],
  [138, 140, 30],
];

export function GpsStatusPage({ g }: { g: GpsData }) {
  const cx = 150;
  const cy = 150;
  const R = 120;
  const drift = (g.time / 240) % 360;
  return (
    <Win rect={FULL} class="g1000-panel g1000-gps">
      <div class="g1000-gps-top">
        <Group title="CONSTELLATION">
          <svg width={300} height={300} aria-hidden="true">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#8a949e" />
            <circle cx={cx} cy={cy} r={R / 2} fill="none" stroke="#5a6168" />
            {SATS.map(([prn, az, el]) => {
              const a = ((az + drift - 90) * Math.PI) / 180;
              const r = ((90 - el) / 90) * R;
              const sbas = prn > 100;
              return (
                <g key={prn}>
                  <ellipse cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} rx={15} ry={9} fill={sbas ? '#2a5a2a' : AV.green} stroke="#000" />
                  <text x={cx + Math.cos(a) * r} y={cy + Math.sin(a) * r + 4} text-anchor="middle" font-size={11} fill="#000">
                    {String(prn).padStart(3, '0')}
                  </text>
                </g>
              );
            })}
            <text x={cx} y={20} text-anchor="middle" font-size={13} fill={AV.white}>
              N
            </text>
          </svg>
        </Group>
        <Group title="SATELLITE STATUS">
          <Item label="EPU" value="0.03" unit="NM" />
          <Item label="HDOP" value="0.8" />
          <Item label="HFOM" value="17" unit="FT" />
          <Item label="VFOM" value="24" unit="FT" />
          <Item label="POSITION" value={formatLat(g.lat)} />
          <Item label="" value={formatLon(g.lon)} />
          <Item label="TIME" value={formatUtc(new Date())} unit="UTC" />
          <Item label="ALT GSL" value={String(Math.round(g.altitudeFt))} unit="FT" />
          <Item label="GROUND SPEED" value={String(Math.round(g.groundSpeedKt))} unit="KT" />
          <Item label="TRACK" value={formatBearing(g.trackMag)} />
        </Group>
        <Group title="GPS STATUS">
          <Item label="ACTIVE GPS" value="GPS1" />
          <Item label="GPS SOLUTION" value="3D DIFF NAV" />
          <Item label="SBAS" value="ACTIVE" />
          <div class="g1000-honest">Simulated satellites: the trainer computes position directly.</div>
        </Group>
      </div>
      <Group title="GPS SIGNAL STRENGTH">
        <svg width={840} height={170} aria-hidden="true">
          {SATS.map(([prn, , el], i) => {
            const h = 40 + el * 1.4;
            return (
              <g key={prn}>
                <rect x={20 + i * 68} y={140 - h} width={40} height={h} fill={prn > 100 ? '#7fd3ff' : AV.green} />
                <text x={40 + i * 68} y={160} text-anchor="middle" font-size={13} fill={AV.white}>
                  {String(prn).padStart(3, '0')}
                </text>
                <text x={40 + i * 68} y={134} text-anchor="middle" font-size={12} fill="#000">
                  D
                </text>
              </g>
            );
          })}
        </svg>
      </Group>
    </Win>
  );
}

const LRUS = [
  'GDU 1040 PFD1',
  'GDU 1040 MFD1',
  'GIA 63W 1',
  'GIA 63W 2',
  'GDC 74A',
  'GRS 77',
  'GMU 44',
  'GEA 71',
  'GTX 33',
  'GMA 1347',
] as const;

export function SystemStatusPage({ afcs, databaseBuilt }: { afcs: boolean; databaseBuilt: string }) {
  const lrus = afcs ? [...LRUS, 'GFC 700'] : [...LRUS];
  return (
    <Win rect={FULL} class="g1000-panel g1000-status">
      <div class="g1000-status-grid">
        <Group title="LRU INFO">
          {lrus.map((l) => (
            <div key={l} class="g1000-row g1000-split">
              <span>{l}</span>
              <span class="g1000-green">✓</span>
            </div>
          ))}
        </Group>
        <Group title="AIRFRAME">
          <div class="g1000-row">CESSNA 172S NAV III</div>
          <div class="g1000-row">{afcs ? 'GFC 700 AUTOPILOT' : 'NO AFCS'}</div>
        </Group>
        <Group title="MFD1 DATABASE">
          <div class="g1000-row g1000-split">
            <span>NAVIGATION</span>
            <span class="g1000-cyan">{databaseBuilt.slice(0, 10)}</span>
          </div>
          <div class="g1000-honest">Trainer data (airports and navaids only). Not for navigation.</div>
        </Group>
      </div>
    </Win>
  );
}
