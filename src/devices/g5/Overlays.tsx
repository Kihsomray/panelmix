import type { CdiSource } from '../../sim/types';
import { altitudeText, headingText } from './format';
import { bearingLabel, bearingOptions, SETUP_ROWS, type EditTarget, type G5Context, type MenuItem } from './menu';
import { G5 } from './palette';

/*
 * What the G5 draws over its pages: the menu tiles along the bottom
 * (figures 1-15 and 1-16), the value pop-up while a tile is being edited
 * (figure 2-13), the HSI Setup list and bearing pointer choices (figures
 * 2-18 to 2-20), the backlight page and the power-off countdown.
 */

const TILE_W = 74;
const TILE_GAP = 4;
const VISIBLE_TILES = 4;

const TITLES: Record<MenuItem, string> = {
  back: 'Back',
  heading: 'Heading',
  altitude: 'Altitude',
  course: 'Course',
  obs: 'OBS',
  hsi: 'HSI',
  pfd: 'PFD',
  esp: 'ESP',
  gpss: 'GPSS',
  setup: 'Setup',
};

export function MenuTiles({ items, cursor, ctx }: { items: readonly MenuItem[]; cursor: number; ctx: G5Context }) {
  const c = Math.min(Math.max(cursor, 0), items.length - 1);
  const first = Math.min(Math.max(c - (VISIBLE_TILES - 1), 0), Math.max(items.length - VISIBLE_TILES, 0));
  const shown = items.slice(first, first + VISIBLE_TILES);
  const thumbW = (300 * Math.min(VISIBLE_TILES, items.length)) / items.length;
  return (
    <g class="g5-menu">
      <rect x={0} y={176} width={320} height={64} fill={G5.panel} stroke="#4a4c52" stroke-width={1} />
      {shown.map((item, i) => {
        const x = 5 + i * (TILE_W + TILE_GAP);
        const selected = first + i === c;
        return (
          <g key={item}>
            <rect x={x} y={181} width={TILE_W} height={48} rx={3} fill="url(#g5-tile)" stroke={selected ? G5.cyan : '#5d6067'} stroke-width={selected ? 2 : 1} />
            <text x={x + TILE_W / 2} y={195} text-anchor="middle" font-size={11.5} fill={G5.white}>
              {TITLES[item]}
            </text>
            <TileValue item={item} x={x + TILE_W / 2} ctx={ctx} />
          </g>
        );
      })}
      {items.length > VISIBLE_TILES && (
        <g>
          <rect x={10} y={233} width={300} height={3} rx={1.5} fill="#3a3c41" />
          <rect x={10 + (300 * first) / items.length} y={233} width={thumbW} height={3} rx={1.5} fill="#b9bcc2" />
        </g>
      )}
    </g>
  );
}

function TileValue({ item, x, ctx }: { item: MenuItem; x: number; ctx: G5Context }) {
  const value = (text: string, color: string) => (
    <text x={x} y={220} text-anchor="middle" font-size={16} fill={color}>
      {text}
    </text>
  );
  switch (item) {
    case 'back':
      return <path d={`M${x + 12} ${208} c0 -7 -8 -9 -16 -7 v-4 l-8 7 l8 7 v-4 c6 -2 11 0 12 4 Z`} fill={G5.cyan} />;
    case 'heading':
      return value(headingText(ctx.headingBugMag), G5.cyan);
    case 'altitude':
      return (
        <text x={x} y={220} text-anchor="middle" font-size={16} fill={G5.cyan}>
          {altitudeText(ctx.altitudeBugFt)}
          <tspan font-size={8}>ft</tspan>
        </text>
      );
    case 'course':
      return value(headingText(ctx.courseMag), G5.green);
    case 'obs':
      return value(headingText(ctx.courseMag), G5.magenta);
    case 'hsi':
      return (
        <g>
          <circle cx={x} cy={213} r={10} fill={G5.black} stroke={G5.white} stroke-width={1.4} />
          <path d={`M${x - 3} ${222} L${x + 4} ${204}`} stroke={G5.magenta} stroke-width={2.4} />
          <path d={`M${x} ${209} v7 M${x - 4} ${212} h8`} stroke={G5.white} stroke-width={1.3} />
        </g>
      );
    case 'pfd':
      return (
        <g>
          <rect x={x - 11} y={203} width={22} height={9} fill={G5.skyHorizon} />
          <rect x={x - 11} y={212} width={22} height={9} fill={G5.groundHorizon} />
          <path d={`M${x - 6} ${213} l6 -3 l6 3`} stroke={G5.yellow} stroke-width={1.8} fill="none" />
        </g>
      );
    case 'esp':
    case 'gpss': {
      const on = item === 'esp' ? ctx.shared.esp : ctx.gpss;
      return <rect x={x - 22} y={213} width={44} height={4} rx={1} fill={on ? G5.green : '#55585e'} />;
    }
    case 'setup':
      return (
        <g stroke={G5.white} stroke-width={2.4} stroke-linecap="round">
          <path d={`M${x - 9} ${222} L${x + 3} ${210}`} />
          <path d={`M${x + 9} ${222} L${x - 3} ${210}`} stroke={G5.cyan} />
        </g>
      );
  }
}

const EDIT_TITLES: Record<EditTarget, string> = {
  heading: 'Select Heading',
  altitude: 'Select Altitude',
  course: 'VOR Course',
  obs: 'OBS Course',
};

export function EditPopup({ target, ctx, localizer }: { target: EditTarget; ctx: G5Context; localizer: boolean }) {
  const title = target === 'course' && localizer ? 'Localizer Course' : EDIT_TITLES[target];
  const value =
    target === 'heading' ? headingText(ctx.headingBugMag) : target === 'altitude' ? altitudeText(ctx.altitudeBugFt) : headingText(ctx.courseMag);
  const color = target === 'course' ? G5.green : target === 'obs' ? G5.magenta : G5.cyan;
  return (
    <g class="g5-edit">
      <rect x={66} y={168} width={188} height={68} rx={4} fill={G5.panel} stroke="#8d9097" stroke-width={1.2} />
      <rect x={67} y={169} width={186} height={18} rx={3} fill="url(#g5-tile)" />
      <text x={160} y={182} text-anchor="middle" font-size={12} fill={G5.white}>
        {title}
      </text>
      <text x={160} y={222} text-anchor="middle" font-size={27} fill={color}>
        {value}
        {target === 'altitude' && (
          <tspan font-size={10} dx={2}>
            ft
          </tspan>
        )}
      </text>
    </g>
  );
}

export function SetupList({ cursor, ctx, cdiSources }: { cursor: number; ctx: G5Context; cdiSources: readonly CdiSource[] }) {
  return (
    <g class="g5-setup">
      <rect x={0} y={96} width={320} height={144} fill={G5.panel} />
      <rect x={0} y={96} width={320} height={18} fill="url(#g5-tile)" />
      <text x={160} y={109.5} text-anchor="middle" font-size={12} fill={G5.white}>
        Setup
      </text>
      {SETUP_ROWS.map((row, i) => {
        const y = 120 + i * 32;
        const selected = i === cursor;
        const source = row === 'bearing1' ? ctx.bearing1 : ctx.bearing2;
        return (
          <g key={row}>
            <rect x={6} y={y} width={308} height={26} rx={3} fill="#24262a" stroke={selected ? G5.cyan : '#4a4d53'} stroke-width={selected ? 2 : 1} />
            {row === 'back' ? (
              <g>
                <path d={`M34 ${y + 17} c0 -5 -6 -7 -12 -5 v-3 l-6 5 l6 5 v-3 c4 -1 8 0 9 3 Z`} fill={G5.cyan} />
                <text x={44} y={y + 17.5} font-size={12.5} fill={G5.white}>
                  Back
                </text>
              </g>
            ) : (
              <g>
                <text x={14} y={y + 17.5} font-size={12.5} fill={G5.white}>
                  Bearing Pointer {row === 'bearing1' ? 1 : 2}
                </text>
                <rect x={214} y={y + 3} width={94} height={20} rx={2} fill="#3a3d43" />
                <text x={261} y={y + 17.5} text-anchor="middle" font-size={12.5} fill={G5.white}>
                  {bearingLabel(source, cdiSources)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function PickList({ pointer, cursor, cdiSources }: { pointer: 1 | 2; cursor: number; cdiSources: readonly CdiSource[] }) {
  const options = bearingOptions(cdiSources);
  const h = 22 + options.length * 22;
  const y0 = 196 - h;
  return (
    <g class="g5-pick">
      <rect x={96} y={y0} width={128} height={h + 6} rx={3} fill={G5.panel} stroke="#8d9097" stroke-width={1.2} />
      <text x={104} y={y0 + 15} font-size={11.5} fill={G5.white}>
        Bearing Pointer {pointer}
      </text>
      {options.map((o, i) => {
        const y = y0 + 20 + i * 22;
        return (
          <g key={o}>
            <rect x={102} y={y} width={116} height={19} rx={2} fill="#26282c" stroke={i === cursor ? G5.cyan : '#4a4d53'} stroke-width={i === cursor ? 2 : 1} />
            <text x={108} y={y + 14} font-size={12} fill={G5.white}>
              {bearingLabel(o, cdiSources)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function BacklightPage({ auto, level }: { auto: boolean; level: number }) {
  return (
    <g class="g5-backlight">
      <BatteryStatus />
      <rect x={50} y={170} width={220} height={66} rx={4} fill={G5.panel} stroke="#8d9097" stroke-width={1.2} />
      <text x={160} y={186} text-anchor="middle" font-size={12} fill={G5.white}>
        Backlight
      </text>
      <rect x={64} y={196} width={150} height={10} rx={2} fill="#3a3c41" />
      <rect x={64} y={196} width={auto ? 150 * 0.8 : (150 * level) / 100} height={10} rx={2} fill={auto ? '#6b6e74' : G5.cyan} />
      <text x={258} y={206} text-anchor="end" font-size={12} fill={auto ? G5.green : G5.white}>
        {auto ? 'Auto' : `${level}%`}
      </text>
      <g font-size={9} fill="#c5c8ce" text-anchor="middle">
        <text x={95} y={228}>
          Knob: level
        </text>
        <text x={160} y={228}>
          Power: {auto ? 'Manual' : 'Auto'}
        </text>
        <text x={225} y={228}>
          Push: close
        </text>
      </g>
    </g>
  );
}

/** Shown with the backlight page: the internal battery is charged, on aircraft power. */
function BatteryStatus() {
  return (
    <g>
      <rect x={0.5} y={0.5} width={66} height={16} fill={G5.black} stroke="rgba(255,255,255,0.7)" stroke-width={1} />
      <text x={4} y={12.5} font-size={10.5} fill={G5.white}>
        100%
      </text>
      <rect x={36} y={4} width={24} height={9} rx={1} fill="none" stroke={G5.green} stroke-width={1.2} />
      <rect x={60.5} y={6.5} width={2} height={4} fill={G5.green} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={38 + i * 5.3} y={5.8} width={4.2} height={5.4} fill={G5.green} />
      ))}
    </g>
  );
}

export function PowerOffPrompt({ seconds }: { seconds: number }) {
  return (
    <g class="g5-poweroff">
      <rect x={52} y={78} width={216} height={76} rx={4} fill={G5.panel} stroke="#8d9097" stroke-width={1.2} />
      <text x={160} y={100} text-anchor="middle" font-size={13} fill={G5.white}>
        Powering off in {seconds}
      </text>
      <text x={160} y={122} text-anchor="middle" font-size={10.5} fill="#c5c8ce">
        Turn or push the knob, or press
      </text>
      <text x={160} y={137} text-anchor="middle" font-size={10.5} fill="#c5c8ce">
        the power button, to stay on.
      </text>
    </g>
  );
}

export function Splash() {
  return (
    <g>
      <rect x={0} y={0} width={320} height={240} fill={G5.black} />
      <text x={160} y={124} text-anchor="middle" font-size={30} letter-spacing={3} fill={G5.white}>
        GARMIN
      </text>
      <text x={160} y={146} text-anchor="middle" font-size={11} fill="#b6b9bf">
        G5
      </text>
    </g>
  );
}

/** Gradients both units share, defined once for the document. */
export function SharedDefs() {
  return (
    <svg class="g5-defs" width={0} height={0} aria-hidden="true">
      <defs>
        <linearGradient id="g5-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4a4d53" />
          <stop offset="1" stop-color="#25272b" />
        </linearGradient>
        <radialGradient id="g5-ball" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="1" stop-color="#b9b9b9" />
        </radialGradient>
      </defs>
    </svg>
  );
}
