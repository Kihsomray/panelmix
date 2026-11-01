import type { ComponentChildren } from 'preact';
import type { AirspaceSource } from '../../../core/airspace';
import type { MagneticModel } from '../../../core/magvar';
import type { NavDatabase } from '../../../core/navdb';
import type { ProcedureSource } from '../../../core/procedures';
import type { TerrainProvider } from '../../../core/terrain';
import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import type { IdentEntry } from '../../../ui/identEntry';
import type { Lcd } from '../layout';
import type { GnsUi, NearestLists } from '../model/types';

/*
 * Drawing primitives for the GNS screen, in LCD pixels: black data boxes
 * with cyan edges on the blue page, green values with the small stacked
 * units Garmin uses ("n over m"), cyan labels and the inverse-video cursor.
 */

export interface PageProps {
  readonly ui: GnsUi;
  readonly state: SimState;
  readonly derived: Derived;
  readonly db: NavDatabase;
  readonly mag: MagneticModel;
  readonly nearest: NearestLists;
  readonly procedures: ProcedureSource | null;
  readonly terrain: TerrainProvider;
  readonly airspace: AirspaceSource;
  readonly lcd: Lcd;
  /** CSS px per LCD px, for crisp canvases. */
  readonly pixelScale: number;
}

type Style = Record<string, string | number>;

/** Absolute position in LCD px. */
export function at(x: number, y: number, w?: number, h?: number): Style {
  const s: Style = { left: `${x}px`, top: `${y}px` };
  if (w !== undefined) s.width = `${w}px`;
  if (h !== undefined) s.height = `${h}px`;
  return s;
}

export type Color = 'green' | 'cyan' | 'white' | 'magenta' | 'yellow' | 'dim' | 'blue';
export type Align = 'left' | 'center' | 'right';

/** A line of text. `size` in LCD px; `sel` shows the cursor (inverse video). */
export function T({
  x,
  y,
  w,
  size,
  color = 'green',
  align = 'left',
  bold = false,
  sel = false,
  children,
}: {
  x: number;
  y: number;
  w?: number;
  size: number;
  color?: Color;
  align?: Align;
  bold?: boolean;
  sel?: boolean;
  children: ComponentChildren;
}) {
  const style: Style = { ...at(x, y, w), fontSize: `${size}px`, textAlign: align };
  return (
    <div class={`gns-t c-${color}${bold ? ' is-bold' : ''}`} style={style}>
      {sel ? <span class={`gns-sel gns-sel-${color}`}>{children}</span> : children}
    </div>
  );
}

/** Black data box with a cyan edge. */
export function DataBox({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ComponentChildren }) {
  return (
    <div class="gns-box" style={at(x, y, w, h)}>
      {children}
    </div>
  );
}

export type UnitName = 'nm' | 'kt' | 'ft' | 'mag' | 'fpm' | 'deg';

const UNIT: Record<UnitName, [string, string]> = {
  nm: ['n', 'm'],
  kt: ['k', 't'],
  ft: ['f', 't'],
  mag: ['°', 'M'],
  fpm: ['f', 'pm'],
  deg: ['°', ''],
};

/** A magenta waypoint designator after an identifier ("IA", "FA", "MA", "MH"). */
export function Tag({ t }: { t: string | undefined }) {
  return t ? <span class="gns-tag">{t}</span> : null;
}

/** Garmin's small two-line unit glyph after a value. */
export function Unit({ u }: { u: UnitName }) {
  const [top, bottom] = UNIT[u];
  return (
    <span class="gns-u" aria-hidden="true">
      <b>{top}</b>
      <b>{bottom}</b>
    </span>
  );
}

/** A value with its unit. */
export function V({ v, u }: { v: string; u?: UnitName }) {
  return (
    <>
      {v}
      {u && <Unit u={u} />}
    </>
  );
}

/** Characters being spelled with the knobs: the one under the cursor flashes in inverse video. */
export function EntryText({ e, width = 5 }: { e: IdentEntry; width?: number }) {
  const text = e.text.padEnd(Math.max(width, e.cursor + 1), '_');
  return (
    <span class="gns-entry">
      {text.slice(0, e.cursor)}
      <span class="gns-entry-cursor">{text[e.cursor] === ' ' ? '_' : text[e.cursor]}</span>
      {text.slice(e.cursor + 1)}
    </span>
  );
}

// Formatting ------------------------------------------------------------------------

/** "005", "360"; underscores when unknown. */
export function brg(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '___';
  const d = Math.round(((deg % 360) + 360) % 360) || 360;
  return String(d).padStart(3, '0');
}

/** "35.8", "123"; data fields show hundredths under 10 nm ("8.87"), lists tenths ("4.6"). */
export function dis(nm: number | null | undefined, fine = false): string {
  if (nm === null || nm === undefined || !Number.isFinite(nm)) return fine ? '_.__' : '__._';
  if (fine && nm < 9.995) return nm.toFixed(2);
  return nm < 99.95 ? nm.toFixed(1) : String(Math.round(nm));
}

export function speed(kt: number | null | undefined): string {
  return kt === null || kt === undefined || !Number.isFinite(kt) ? '___' : String(Math.round(kt));
}

/** Clock time "hh:mm:ss" (24 h). */
export function clock(d: Date, utc = false): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return utc ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Elapsed time "hh:mm:ss". */
export function hms(seconds: number): string {
  const s = Math.max(Math.floor(seconds), 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

/** Shortens a facility name to what fits, at a word boundary when there is one. */
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).trimEnd();
}

export const freqCom = (khz: number) => (khz / 1000).toFixed(3);
export const freqNav = (khz: number) => (khz / 1000).toFixed(2);

/** Latitude and longitude lines the way the GNS prints them: "N 39°04.50'", "W077°37.20'". */
export function latLines(lat: number, lon: number): [string, string] {
  const dm = (v: number, digits: number) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.round((a - d) * 6000) / 100;
    if (m >= 60) {
      d += 1;
      m -= 60;
    }
    return `${String(d).padStart(digits, '0')}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return [`${lat >= 0 ? 'N' : 'S'} ${dm(lat, 2)}`, `${lon >= 0 ? 'E' : 'W'}${dm(lon, 3)}`];
}

/** The page title row ("NEAREST AIRPORT") centred over the page area. */
export function Title({ w, size, children }: { w: number; size: number; children: ComponentChildren }) {
  return (
    <T x={0} y={1} w={w} size={size} color="white" align="center" bold>
      {children}
    </T>
  );
}

/** "Not in the trainer database" note inside a data box. */
export function NotInDb({ x, y, w, h, size, lines }: { x: number; y: number; w: number; h: number; size: number; lines?: readonly string[] }) {
  const text = lines ?? ['Not in the trainer database'];
  return (
    <DataBox x={x} y={y} w={w} h={h}>
      {text.map((l, i) => (
        <T key={l} x={0} y={h / 2 - (text.length * size * 1.2) / 2 + i * size * 1.2} w={w} size={size} color="cyan" align="center">
          {l}
        </T>
      ))}
    </DataBox>
  );
}
