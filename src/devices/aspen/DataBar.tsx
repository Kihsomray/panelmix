import { ASP, ATT_BOTTOM, NAV_TOP } from './palette';
import { INHG_PER_MB } from './settings';

/*
 * The data bar between the attitude and navigation displays (Pilot's Guide
 * 2.3.3): true airspeed and the barometric setting on the first line,
 * ground speed, outside air temperature and the wind on the second.
 */

export interface DataBarProps {
  readonly tasKt: number;
  readonly groundSpeedKt: number;
  readonly oatC: number;
  readonly oatUnits: 'C' | 'F';
  readonly baroInHg: number;
  readonly baroUnits: 'IN' | 'MB';
  readonly baroActive: boolean;
  /** Wind from, degrees magnetic, and its speed. */
  readonly windFromMag: number;
  readonly windKt: number;
  /** Wind direction relative to the nose, for the arrow. */
  readonly windRelativeDeg: number;
  readonly onBattery: boolean;
}

export function DataBar(p: DataBarProps) {
  const baro = p.baroUnits === 'IN' ? p.baroInHg.toFixed(2) : String(Math.round(p.baroInHg / INHG_PER_MB));
  const oat = p.oatUnits === 'C' ? Math.round(p.oatC) : Math.round((p.oatC * 9) / 5 + 32);
  const wind = Math.round(((p.windFromMag % 360) + 360) % 360) || 360;
  return (
    <g class="aspen-databar">
      <path d={`M0 ${ATT_BOTTOM - 4} H100 L112 338 H288 L300 ${ATT_BOTTOM - 4} H400 V${NAV_TOP} H0 Z`} fill={ASP.black} />
      <line x1={0} x2={400} y1={NAV_TOP - 0.5} y2={NAV_TOP - 0.5} stroke="#3b3d42" stroke-width={1} />
      <text x={4} y={350} font-size={13} fill={ASP.white}>
        TAS
        <tspan font-size={19} dx={4}>
          {Math.round(p.tasKt)}
        </tspan>
        <tspan font-size={13} dx={3}>
          kt
        </tspan>
      </text>
      <text x={396} y={351} text-anchor="end" font-size={21} fill={p.baroActive ? ASP.magenta : ASP.cyan}>
        {baro}
        <tspan font-size={14} dx={3}>
          {p.baroUnits === 'IN' ? 'in' : 'mb'}
        </tspan>
      </text>
      <text x={4} y={371} font-size={13} fill={ASP.white}>
        GS
        <tspan font-size={19} dx={9}>
          {Math.round(p.groundSpeedKt)}
        </tspan>
        <tspan font-size={13} dx={3}>
          kt
        </tspan>
      </text>
      <text x={118} y={371} font-size={13} fill={ASP.white}>
        OAT
        <tspan font-size={19} dx={6}>
          {oat}
        </tspan>
        <tspan font-size={13}>°{p.oatUnits}</tspan>
      </text>
      {/* Winds under 10 kt are not shown. */}
      {p.windKt >= 10 && (
        <g>
          <g transform={`rotate(${p.windRelativeDeg + 180} 258 365)`}>
            <path d="M258 356 V374 M252 368 L258 374 L264 368" stroke={ASP.white} stroke-width={2.2} fill="none" />
          </g>
          <text x={396} y={371} text-anchor="end" font-size={19} fill={ASP.white}>
            {String(wind).padStart(3, '0')}°/{Math.round(p.windKt)}
            <tspan font-size={13} dx={3}>
              kt
            </tspan>
          </text>
        </g>
      )}
      {p.onBattery && (
        <g>
          <rect x={118} y={334} width={120} height={20} fill={ASP.black} stroke={ASP.amber} stroke-width={1.4} />
          <text x={178} y={349} text-anchor="middle" font-size={15} fill={ASP.amber}>
            ON BAT 99%
          </text>
        </g>
      )}
    </g>
  );
}
