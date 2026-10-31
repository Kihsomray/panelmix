import type { BearingSolution, CdiSolution } from '../../sim/radionav';
import type { Derived } from '../../sim/simulator';
import type { BearingSource, CdiSource, SimState } from '../../sim/types';
import { formatDistance } from '../../ui/format';
import { Compass360, CompassArc, VsiTape } from './Compass';
import { hotkeyLegends, type AspenUi } from './controls';
import { HOTKEY_Y } from './layout';
import { MENU_PAGES, menuRows, type MenuRow } from './menuPages';
import { ASP } from './palette';

/*
 * The lower half of the Aspen (Pilot's Guide 2.3.4): the compass in 360 or
 * ARC format over the map, the heading readout with the CRS and HDG fields,
 * the CDI source information block, vertical speed, map range, bearing
 * pointer sources, the knob and button legends along the bottom, the hot
 * key legends down the right edge, and the menu when it is open.
 */

export interface NavDisplayProps {
  readonly id: string;
  readonly ui: AspenUi;
  readonly state: SimState;
  readonly derived: Derived;
  readonly cdiSources: readonly CdiSource[];
  /** The CRS shown and flown, and whether Auto Course is setting it. */
  readonly crsMag: number;
  readonly autoCrs: boolean;
  readonly rangeNm: number;
  readonly gpssAvailable: boolean;
  readonly hint: boolean;
  readonly shutdownSeconds: number | null;
}

const deg3 = (d: number) => `${String(Math.round(((d % 360) + 360) % 360) || 360).padStart(3, '0')}°`;

function hoursMinutes(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** What the source information block in the top left lists. */
function sourceInfo(cdi: CdiSolution, derived: Derived): { label: string; lines: string[] } {
  if (cdi.source === 'GPS') {
    const g = derived.gps;
    return {
      label: 'GPS1',
      lines: g.active
        ? [g.to?.ident ?? '', `${deg3(g.bearingMag ?? 0)}/${formatDistance(g.distanceNm)}`, hoursMinutes(g.eteSec) ?? '']
        : [],
    };
  }
  const v = derived.vor[cdi.source === 'NAV1' ? 0 : 1];
  const lines = v.station ? [v.station.ident, v.dmeNm !== null ? `${deg3(v.bearingToMag ?? 0)}/${formatDistance(v.dmeNm)}` : deg3(v.bearingToMag ?? 0)] : [];
  return { label: cdi.label, lines };
}

const cdiButtonLabel = (s: CdiSource) => (s === 'GPS' ? 'GPS1' : s === 'NAV1' ? 'VLOC1' : 'VLOC2');
const pointerLabel = (s: BearingSource) => (s === 'OFF' ? '' : s === 'GPS' ? 'GPS1' : s === 'NAV1' ? 'VOR1' : 'VOR2');

export function NavDisplay(p: NavDisplayProps) {
  const { ui, state, derived } = p;
  const cdi = derived.cdi;
  const hdg = derived.headingMag;
  const info = sourceInfo(cdi, derived);
  const course = { crsMag: p.crsMag, needle: cdi.needle, toFrom: cdi.toFrom, flag: cdi.flag };
  const vs = state.aircraft.verticalSpeedFpm;
  const compass = {
    headingMag: hdg,
    bugMag: state.bugs.headingMag,
    bugActive: ui.right.active && ui.right.fn === 'HDG',
    bugHollow: state.ap.gpss,
    trackMag: derived.trackMag,
    turnRateDps: state.aircraft.turnRateDps,
    course,
  };
  const crsActive = ui.left.active && ui.left.fn === 'CRS';
  const crsColor = p.autoCrs ? ASP.green : crsActive ? ASP.magenta : ASP.cyan;
  const hdgColor = compass.bugActive ? ASP.magenta : ASP.cyan;

  return (
    <g class="aspen-nav">
      {ui.compass === '360' ? (
        <>
          <Compass360 {...compass} bearing1={derived.bearing1} bearing2={derived.bearing2} />
          <VsiTape vsFpm={vs} />
        </>
      ) : (
        <CompassArc {...compass} style={ui.settings.arcMode} clipId={`${p.id}-arc`} />
      )}

      {/* Magnetic heading with the lubber pointer. */}
      <path d="M168 383 H232 V409 H206 L200 416 L194 409 H168 Z" fill={ASP.black} stroke={ASP.white} stroke-width={2} />
      <text x={200} y={404} text-anchor="middle" font-size={24} fill={ASP.white}>
        {deg3(hdg)}
      </text>

      <text x={126} y={393} text-anchor="middle" font-size={14} fill={ASP.white}>
        CRS
      </text>
      <text x={126} y={416} text-anchor="middle" font-size={23} fill={crsColor} class="aspen-halo">
        {deg3(p.crsMag)}
      </text>
      {p.autoCrs && <InverseA x={146} y={381} />}
      <text x={274} y={393} text-anchor="middle" font-size={14} fill={ASP.white}>
        HDG
      </text>
      {state.ap.gpss ? (
        <g>
          <text x={268} y={416} text-anchor="middle" font-size={21} fill={ASP.green}>
            GPSS1
          </text>
          <InverseA x={298} y={400} />
          {/* Steering signal lost (no active leg): slashed, as the PFD flags it. */}
          {!p.gpssAvailable && <line x1={238} y1={418} x2={312} y2={398} stroke={ASP.red} stroke-width={3} />}
        </g>
      ) : (
        <text x={274} y={416} text-anchor="middle" font-size={23} fill={hdgColor} class="aspen-halo">
          {deg3(state.bugs.headingMag)}
        </text>
      )}

      <InfoBlock label={info.label} lines={info.lines} invalid={cdi.flag} />

      {Math.abs(vs) >= 100 && (
        <g>
          <text x={380} y={398} text-anchor="end" font-size={20} fill={ASP.white}>
            {vs > 0 ? '+' : '-'}
            {Math.min(Math.round(Math.abs(vs) / 10) * 10, 9990)}
          </text>
          <text x={380} y={410} text-anchor="end" font-size={10} fill={ASP.white}>
            FPM
          </text>
        </g>
      )}

      {ui.compass === '360' && (
        <>
          <PointerInfo x={66} anchor="start" source={state.nav.bearing1} solution={derived.bearing1} />
          <PointerInfo x={330} anchor="end" source={state.nav.bearing2} solution={derived.bearing2} />
        </>
      )}
      <RangeBox rangeNm={p.rangeNm} auto={ui.autoRangeOn} declutter={(ui.compass === '360' ? ui.settings.map360 : ui.settings.mapArc).declutter} />

      {ui.menu ? (
        <MenuOverlay ui={ui} menu={ui.menu} volts={state.aircraft.engine.volts} />
      ) : (
        <>
          <BottomLegends p={p} crsColor={crsColor} />
          <HotkeyLegends ui={ui} minOn={state.bugs.minimumsFt !== null} gpss={state.ap.gpss} gpssAvailable={p.gpssAvailable} />
        </>
      )}

      {p.hint && (
        <g>
          <rect x={90} y={668} width={220} height={24} fill={ASP.black} stroke={ASP.white} stroke-width={1} />
          <text x={200} y={686} text-anchor="middle" font-size={15} fill={ASP.white}>
            HOLD REV TO POWER OFF
          </text>
        </g>
      )}
      {p.shutdownSeconds !== null && (
        <g>
          <rect x={56} y={520} width={288} height={70} fill={ASP.black} stroke={ASP.yellow} stroke-width={2} />
          <text x={200} y={549} text-anchor="middle" font-size={21} fill={ASP.yellow}>
            POWERING OFF IN {p.shutdownSeconds} SEC
          </text>
          <text x={200} y={575} text-anchor="middle" font-size={15} fill={ASP.white}>
            PRESS ANY CONTROL TO CANCEL
          </text>
        </g>
      )}
    </g>
  );
}

/** Green square with a dark "A": the value is being set automatically. */
function InverseA({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={13} height={15} fill={ASP.green} />
      <text x={x + 6.5} y={y + 12.5} text-anchor="middle" font-size={13} fill={ASP.legendOnText}>
        A
      </text>
    </g>
  );
}

function InfoBlock({ label, lines, invalid }: { label: string; lines: readonly string[]; invalid: boolean }) {
  return (
    <g>
      <rect x={4} y={381} width={50} height={18} rx={3} fill={ASP.black} stroke={ASP.green} stroke-width={1.5} />
      <text x={29} y={395} text-anchor="middle" font-size={14} fill={ASP.green}>
        {label}
      </text>
      {invalid && <line x1={6} y1={397} x2={52} y2={383} stroke={ASP.red} stroke-width={2.5} />}
      {!invalid &&
        lines.map((t, i) => (
          <text key={i} x={6} y={416 + i * 17} font-size={16} fill={ASP.green} class="aspen-halo">
            {t}
          </text>
        ))}
    </g>
  );
}

function PointerInfo({ x, anchor, source, solution }: { x: number; anchor: 'start' | 'end'; source: BearingSource; solution: BearingSolution }) {
  if (source === 'OFF' || solution.bearingMag === null) return null;
  return (
    <g fill={ASP.cyan} font-size={15} text-anchor={anchor} class="aspen-halo">
      {solution.distanceNm !== null && (
        <text x={x} y={707}>
          {formatDistance(solution.distanceNm)}nm
        </text>
      )}
      <text x={x} y={724}>
        {solution.ident ?? ''}
      </text>
    </g>
  );
}

function RangeBox({ rangeNm, auto, declutter }: { rangeNm: number; auto: boolean; declutter: number }) {
  return (
    <g>
      <rect x={4} y={697} width={44} height={17} rx={3} fill={ASP.black} stroke={ASP.white} stroke-width={1.4} />
      <text x={26} y={710.5} text-anchor="middle" font-size={13} fill={ASP.white}>
        {rangeNm}nm
      </text>
      {auto && (
        <g>
          <rect x={50} y={697} width={13} height={17} fill={ASP.white} />
          <text x={56.5} y={710.5} text-anchor="middle" font-size={13} fill={ASP.black}>
            A
          </text>
        </g>
      )}
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${7 + i * 11} 724 h8 l-3 5 h-8 Z`} fill={i < declutter ? ASP.green : 'none'} stroke={ASP.green} stroke-width={1} />
      ))}
    </g>
  );
}

/** Knob states, bearing pointer sources and the CDI source, each above its control. */
function BottomLegends({ p, crsColor }: { p: NavDisplayProps; crsColor: string }) {
  const { ui, state, derived } = p;
  const rightColor = ui.right.active ? ASP.magenta : ASP.cyan;
  const leftColor = ui.left.fn === 'IAS' ? (ui.left.active ? ASP.magenta : ASP.cyan) : crsColor;
  const bp = (s: BearingSource, sol: BearingSolution) => ({ text: pointerLabel(s), invalid: s !== 'OFF' && sol.bearingMag === null });
  const bp1 = bp(state.nav.bearing1, derived.bearing1);
  const bp2 = bp(state.nav.bearing2, derived.bearing2);
  return (
    <g class="aspen-legends">
      <path d="M0 731 H400 V760 H0 Z" fill="#26282d" />
      <path d="M64 731 l8 29 M152 731 l-6 29 M248 731 l6 29 M336 731 l-8 29" stroke="#55585f" stroke-width={1.5} />
      <text x={34} y={752} text-anchor="middle" font-size={18} fill={leftColor}>
        {ui.left.fn}
      </text>
      {ui.left.fn === 'CRS' && p.autoCrs && <InverseA x={54} y={737} />}
      <path d="M80 754 V738 M75 743 L80 737 L85 743" stroke={ASP.cyan} stroke-width={2} fill="none" />
      <text x={90} y={752} font-size={16} fill={ASP.cyan}>
        {bp1.text}
      </text>
      {bp1.invalid && <line x1={88} y1={754} x2={140} y2={737} stroke={ASP.red} stroke-width={2.5} />}
      <text x={200} y={753} text-anchor="middle" font-size={19} fill={ASP.green}>
        {cdiButtonLabel(state.nav.cdiSource)}
      </text>
      {derived.cdi.flag && <line x1={168} y1={755} x2={232} y2={736} stroke={ASP.red} stroke-width={2.5} />}
      <text x={308} y={752} text-anchor="end" font-size={16} fill={ASP.cyan}>
        {bp2.text}
      </text>
      <path d="M315 754 V740 M321 754 V740 M311 744 L318 736 L325 744" stroke={ASP.cyan} stroke-width={1.8} fill="none" />
      {bp2.invalid && <line x1={262} y1={754} x2={312} y2={737} stroke={ASP.red} stroke-width={2.5} />}
      <text x={366} y={752} text-anchor="middle" font-size={18} fill={rightColor}>
        {ui.right.fn}
      </text>
    </g>
  );
}

/**
 * Hot key legends: green with dark letters when on, dark blue with green
 * letters when off, gray letters when unavailable, amber when GPSS is on but
 * has lost its steering signal.
 */
function HotkeyLegends({ ui, minOn, gpss, gpssAvailable }: { ui: AspenUi; minOn: boolean; gpss: boolean; gpssAvailable: boolean }) {
  const legends = hotkeyLegends(ui);
  const state = (i: number): 'on' | 'off' | 'na' | 'fail' => {
    if (i === 0 || (i === 2 && ui.hotkeyPage === 1)) return 'on';
    if (ui.hotkeyPage === 2) return i === 4 ? (ui.right.fn === 'BARO' ? 'on' : 'off') : 'na';
    if (i === 1) return minOn ? 'on' : 'off';
    if (i === 3) return gpss ? (gpssAvailable ? 'on' : 'fail') : gpssAvailable ? 'off' : 'na';
    return ui.right.fn === 'BARO' ? 'on' : 'off';
  };
  const fill = { on: ASP.legendOn, off: ASP.legendOff, na: ASP.legendOff, fail: ASP.amber };
  const ink = { on: ASP.legendOnText, off: ASP.green, na: ASP.gray, fail: ASP.legendOnText };
  return (
    <g class="aspen-hotkeys">
      {legends.map((text, i) => {
        const y = HOTKEY_Y[i]!;
        const s = state(i);
        const letters = [...text];
        return (
          <g key={i}>
            <rect x={386} y={y - 29} width={14} height={58} fill={fill[s]} />
            {letters.map((ch, j) => (
              <text
                key={j}
                x={393}
                y={y - (letters.length - 1) * 6.5 + j * 13 + 4.5}
                text-anchor="middle"
                font-size={12.5}
                fill={ink[s]}
              >
                {ch}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function MenuOverlay({ ui, menu, volts }: { ui: AspenUi; menu: NonNullable<AspenUi['menu']>; volts: number }) {
  const rows = menuRows(menu.page, ui.settings, { volts, onBattery: ui.onBattery });
  const textColor = (row: MenuRow, i: number) =>
    menu.editing === i ? ASP.magenta : row.kind === 'status' ? ASP.green : row.kind === 'disabled' ? ASP.gray : ASP.white;
  const brt = ui.brightness;
  return (
    <g class="aspen-menu">
      <defs>
        <linearGradient id="aspen-menu-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={ASP.barTop} />
          <stop offset="1" stop-color={ASP.barBottom} />
        </linearGradient>
      </defs>
      {rows.map((row, i) => {
        const y = HOTKEY_Y[i]!;
        return (
          <g key={i}>
            <rect x={192} y={y - 14} width={208} height={28} fill="url(#aspen-menu-bar)" stroke="#5b79c4" stroke-width={1} />
            {row && (
              <>
                <text x={198} y={y + 6} font-size={15} fill={textColor(row, i)}>
                  {row.label}
                </text>
                <text x={394} y={y + 6} text-anchor="end" font-size={15} fill={textColor(row, i)}>
                  {row.value}
                </text>
              </>
            )}
          </g>
        );
      })}
      <path d="M0 708 H400 V760 H0 Z" fill="#101114" />
      <text x={6} y={722} font-size={11} fill={ASP.white}>
        {brt.auto ? 'PUSH MANUAL' : 'PUSH AUTO'}
      </text>
      <text x={6} y={738} font-size={15} fill={brt.auto ? ASP.green : ASP.magenta}>
        BRT: {brt.auto ? 70 : brt.level}
      </text>
      <text x={6} y={754} font-size={15} fill={brt.auto ? ASP.green : ASP.magenta}>
        {brt.auto ? 'AUTO' : 'ADJUST'}
      </text>
      <text x={196} y={734} text-anchor="middle" font-size={16} fill={ASP.green}>
        {MENU_PAGES[menu.page]}
      </text>
      {MENU_PAGES.map((_, i) => (
        <path key={i} d={`M${120 + i * 19.5} 752 h15 l-3 5 h-15 Z`} fill={i === menu.page ? ASP.white : '#4c5058'} />
      ))}
      <text x={396} y={734} text-anchor="end" font-size={12} fill={ASP.green}>
        PAGE {menu.page + 1} OF {MENU_PAGES.length}
      </text>
      <text x={396} y={753} text-anchor="end" font-size={15} fill={ASP.magenta}>
        {menu.editing === null ? 'SEL PAGE' : 'EDIT VALUE'}
      </text>
    </g>
  );
}
