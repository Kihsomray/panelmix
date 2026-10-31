import type { JSX } from 'preact';
import type { WaypointKind } from '../../core/navdb';

/*
 * GTN artwork as small inline SVGs: the Home screen app icons, waypoint type
 * symbols and the glyphs on the touch keys. Drawn after the real icons'
 * shapes and colours, simplified.
 */

export type AppIconName =
  | 'map'
  | 'traffic'
  | 'terrain'
  | 'weather'
  | 'charts'
  | 'flightPlan'
  | 'proc'
  | 'nearest'
  | 'waypointInfo'
  | 'services'
  | 'utilities'
  | 'system'
  | 'defaultNav'
  | 'airport'
  | 'intersection'
  | 'vor'
  | 'vrp'
  | 'ndb'
  | 'user'
  | 'airspace'
  | 'artcc'
  | 'fss'
  | 'wxfreq';

const MAGENTA = '#ff3cf0';
const CYAN = '#2fd7ff';

function Plane({ x, y, s = 1, r = 0 }: { x: number; y: number; s?: number; r?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}
      d="M0 -11 L2 -4 L11 1 L11 4 L2 2 L1.5 8 L5 11 L5 13 L0 12 L-5 13 L-5 11 L-1.5 8 L-2 2 L-11 4 L-11 1 L-2 -4 Z"
      fill="#f4f6f8"
      stroke="#20252b"
      stroke-width="0.8"
    />
  );
}

function AirportSymbol({ x, y, r = 8, color = MAGENTA }: { x: number; y: number; r?: number; color?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={color} />
      <rect x={x - r * 0.18} y={y - r * 0.85} width={r * 0.36} height={r * 1.7} fill="#fff" transform={`rotate(45 ${x} ${y})`} />
    </g>
  );
}

function VorSymbol({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * Math.PI * 2;
    return `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <g>
      <polygon points={pts} fill="none" stroke={CYAN} stroke-width={r * 0.35} />
      <circle cx={x} cy={y} r={r * 0.25} fill={CYAN} />
    </g>
  );
}

function NdbSymbol({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  return (
    <g fill={MAGENTA}>
      {Array.from({ length: 12 }, (_, k) => {
        const a = (k / 12) * Math.PI * 2;
        return <circle key={k} cx={x + Math.cos(a) * r} cy={y + Math.sin(a) * r} r={r * 0.13} />;
      })}
      <circle cx={x} cy={y} r={r * 0.32} />
    </g>
  );
}

const ICONS: Record<AppIconName, () => JSX.Element> = {
  map: () => (
    <g>
      <ellipse cx="32" cy="32" rx="24" ry="19" fill="#1d6fd6" stroke="#7fd4ff" stroke-width="1.5" />
      <path d="M14 26 Q20 16 28 20 L30 30 Q24 36 20 32 Z M34 16 Q46 14 50 24 L44 28 Q38 24 34 26 Z M38 34 Q48 32 52 38 Q46 48 40 46 Z M18 40 Q24 40 28 46 Q22 48 18 44 Z" fill="#5cd13a" />
    </g>
  ),
  traffic: () => (
    <g fill="#fff">
      <path d="M20 10 L28 18 L20 26 L12 18 Z" />
      <path d="M33 26 L33 12 M28 16 L33 10 L38 16" stroke="#fff" stroke-width="3" fill="none" />
      <text x="10" y="40" font-size="13" font-weight="700" fill="#fff">-08</text>
      <path d="M44 30 L54 40 L44 50 L34 40 Z" fill="none" stroke="#fff" stroke-width="3" />
    </g>
  ),
  terrain: () => (
    <g>
      <path d="M6 48 L24 16 L34 32 L42 22 L58 48 Z" fill="#c8502c" />
      <path d="M6 48 L14 34 L50 34 L58 48 Z" fill="#e8c23a" />
      <path d="M6 48 L10 42 L54 42 L58 48 Z" fill="#7a6a48" />
      <path d="M24 16 L28 23 L21 22 Z M42 22 L45 27 L39 27 Z" fill="#fff" />
    </g>
  ),
  weather: () => (
    <g>
      <path d="M16 36 Q8 36 10 28 Q12 20 20 22 Q22 12 32 12 Q42 12 44 22 Q54 20 54 30 Q54 36 46 36 Z" fill="#b8c0c8" />
      <path d="M34 34 L28 46 L34 46 L30 56 L42 42 L36 42 L40 34 Z" fill="#ffd21a" />
      <path d="M16 42 l-3 7 M22 44 l-3 7" stroke="#38a8ff" stroke-width="3" stroke-linecap="round" />
    </g>
  ),
  charts: () => (
    <g>
      <path d="M10 30 L34 18 L56 30 L32 44 Z" fill="#2c9a4a" />
      <path d="M12 26 L36 14 L56 26 L32 40 Z" fill="#f2f4f2" stroke="#8a9aa0" stroke-width="1" />
      <path d="M22 26 L36 19 M26 30 L44 21 M30 34 L46 26" stroke="#8a9aa0" stroke-width="1.5" />
    </g>
  ),
  flightPlan: () => (
    <g>
      <path d="M12 52 L40 34 L52 50" stroke={MAGENTA} stroke-width="3" fill="none" />
      <path d="M40 34 L52 50" stroke="#c8d0d8" stroke-width="3" />
      <circle cx="12" cy="52" r="4" fill={MAGENTA} />
      <circle cx="52" cy="50" r="4" fill={CYAN} />
      <path d="M40 30 L44 36 L36 36 Z" fill={CYAN} />
      <Plane x={22} y={24} s={1.1} r={-55} />
    </g>
  ),
  proc: () => (
    <g>
      <path d="M30 26 L48 26 A8 8 0 0 1 48 42 L30 42 A8 8 0 0 1 30 26" fill="none" stroke="#c8d0d8" stroke-width="3" />
      <path d="M8 56 L30 42" stroke={MAGENTA} stroke-width="3" />
      <path d="M30 38 L34 44 L26 44 Z" fill={CYAN} />
      <Plane x={22} y={20} s={1} r={-55} />
    </g>
  ),
  nearest: () => (
    <g>
      <path d="M18 38 L42 26" stroke={MAGENTA} stroke-width="2.5" stroke-dasharray="4 3" />
      <AirportSymbol x={16} y={40} r={9} />
      <Plane x={46} y={24} s={1.1} r={-90} />
    </g>
  ),
  waypointInfo: () => (
    <g>
      <AirportSymbol x={36} y={18} r={9} />
      <NdbSymbol x={16} y={38} r={8} />
      <VorSymbol x={46} y={40} r={8} />
    </g>
  ),
  services: () => (
    <g>
      <path d="M10 22 Q8 32 14 42 L20 38 L16 30 L20 26 L16 18 Z" fill="#e8eef4" />
      <ellipse cx="34" cy="30" rx="14" ry="11" fill="#2a8cff" stroke="#bfe2ff" stroke-width="1.5" />
      <path d="M26 26 L42 26 M26 30 L42 30 M26 34 L38 34" stroke="#fff" stroke-width="2" />
      <path d="M52 16 L52 38 A4 4 0 1 1 48 34" stroke={CYAN} stroke-width="3" fill="none" />
    </g>
  ),
  utilities: () => (
    <g>
      <rect x="10" y="24" width="44" height="26" rx="3" fill="#a0562a" stroke="#5a2e12" stroke-width="1.5" />
      <rect x="10" y="24" width="44" height="8" fill="#c06a34" />
      <path d="M24 24 L24 16 L40 16 L40 24" fill="none" stroke="#8a8a8a" stroke-width="3" />
      <rect x="29" y="30" width="6" height="5" fill="#d9b25a" />
    </g>
  ),
  system: () => (
    <g>
      <circle cx="22" cy="30" r="10" fill="none" stroke="#e8eef4" stroke-width="5" stroke-dasharray="4 3" />
      <circle cx="22" cy="30" r="5" fill="#e8eef4" />
      <rect x="38" y="24" width="18" height="16" rx="2" fill="#5aa8e0" stroke="#e8eef4" stroke-width="1.5" />
      <path d="M41 32 L45 32 M49 32 L53 32 M51 30 L51 34" stroke="#fff" stroke-width="2" />
    </g>
  ),
  defaultNav: () => (
    <g>
      <circle cx="32" cy="30" r="20" fill="#2a3240" stroke="#c8d0d8" stroke-width="2" />
      <text x="32" y="18" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">N</text>
      <text x="14" y="34" font-size="8" fill="#fff">W</text>
      <text x="45" y="34" font-size="8" fill="#fff">E</text>
      <path d="M32 14 L32 46" stroke={MAGENTA} stroke-width="3" />
      <path d="M27 22 L32 14 L37 22 Z" fill={MAGENTA} />
    </g>
  ),
  airport: () => <AirportSymbol x={32} y={30} r={14} />,
  intersection: () => <path d="M32 14 L48 44 L16 44 Z" fill={CYAN} />,
  vor: () => <VorSymbol x={32} y={30} r={14} />,
  vrp: () => (
    <g>
      <circle cx="32" cy="30" r="15" fill="none" stroke="#ff9a1a" stroke-width="3" stroke-dasharray="5 3" />
      <path d="M32 21 L41 37 L23 37 Z" fill="#ff9a1a" />
    </g>
  ),
  ndb: () => <NdbSymbol x={32} y={30} r={14} />,
  user: () => <rect x="20" y="18" width="24" height="24" fill="#ff9a1a" />,
  airspace: () => (
    <g fill="none" stroke-width="3">
      <circle cx="32" cy="30" r="16" stroke="#2a8cff" />
      <circle cx="32" cy="30" r="9" stroke={MAGENTA} />
    </g>
  ),
  artcc: () => (
    <g>
      <path d="M14 44 L24 16 L28 16 L38 44" fill="none" stroke="#e8eef4" stroke-width="3" />
      <path d="M40 18 Q50 26 40 34 M44 14 Q58 26 44 38" fill="none" stroke={CYAN} stroke-width="2.5" />
    </g>
  ),
  fss: () => (
    <g>
      <rect x="14" y="24" width="24" height="20" fill="#e8eef4" />
      <path d="M40 18 Q50 26 40 34 M44 14 Q58 26 44 38" fill="none" stroke={CYAN} stroke-width="2.5" />
    </g>
  ),
  wxfreq: () => (
    <g>
      <path d="M12 36 Q6 36 8 30 Q10 24 16 26 Q18 18 26 18 Q34 18 36 26 Q44 24 44 32 Q44 36 38 36 Z" fill="#b8c0c8" />
      <path d="M44 18 Q54 26 44 34 M48 14 Q62 26 48 38" fill="none" stroke={CYAN} stroke-width="2.5" />
    </g>
  ),
};

export function AppIcon({ name }: { name: AppIconName }) {
  const Art = ICONS[name];
  return (
    <svg class="gtn-app-art" viewBox="0 0 64 60" aria-hidden="true">
      <Art />
    </svg>
  );
}

/** Small waypoint type symbol for list lines and identifier keys. */
export function WaypointSymbol({ kind, towered = false }: { kind: WaypointKind; towered?: boolean | undefined }) {
  return (
    <svg class="gtn-wpt-symbol" viewBox="0 0 20 20" aria-hidden="true">
      {kind === 'airport' ? (
        <AirportSymbol x={10} y={10} r={7.5} color={towered ? '#3aa0ff' : MAGENTA} />
      ) : kind === 'vor' ? (
        <VorSymbol x={10} y={10} r={7} />
      ) : kind === 'ndb' ? (
        <NdbSymbol x={10} y={10} r={7} />
      ) : (
        <path d="M10 3 L17 16 L3 16 Z" fill={CYAN} />
      )}
    </svg>
  );
}

/** The Direct-To glyph printed on the bezel key and the Activate key. */
export function DirectToGlyph({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg class="gtn-dto-glyph" viewBox="0 0 34 16" aria-hidden="true">
      <path d="M1 8 H8 M26 8 H31" stroke={color} stroke-width="2.2" />
      <path d="M10 2 H16 Q23 2 23 8 Q23 14 16 14 H10 Z" fill="none" stroke={color} stroke-width="2.4" />
      <path d="M28 4 L33 8 L28 12 Z" fill={color} />
    </svg>
  );
}

export type GlyphName = 'back' | 'menu' | 'msg' | 'cancel' | 'enter' | 'backspace' | 'find' | 'zoomIn' | 'zoomOut' | 'xfer' | 'cdi' | 'obs' | 'remove';

/** Pictures on the control-bar and keypad keys. */
export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg class={`gtn-glyph gtn-glyph-${name}`} viewBox="0 0 32 24" aria-hidden="true">
      {name === 'back' && (
        <g fill="none" stroke="#38b6ff" stroke-width="3.5" stroke-linecap="round">
          <path d="M8 9 Q16 2 24 8 Q28 14 22 18 L12 18" />
          <path d="M8 4 L8 10 L14 10" />
        </g>
      )}
      {name === 'menu' && (
        <g fill="#5ad0ff">
          <rect x="5" y="3" width="22" height="4" rx="1" />
          <rect x="5" y="10" width="22" height="4" rx="1" />
          <rect x="5" y="17" width="22" height="4" rx="1" />
        </g>
      )}
      {name === 'msg' && (
        <g>
          <rect x="7" y="1" width="18" height="22" rx="3" fill="#2fb8e8" />
          <path d="M11 19 L11 6 L16 13 L21 6 L21 19" fill="none" stroke="#0b2230" stroke-width="2.8" />
        </g>
      )}
      {name === 'cancel' && (
        <g stroke="#e0e6ee" stroke-width="3.5" stroke-linecap="round">
          <path d="M10 6 L22 18 M22 6 L10 18" />
        </g>
      )}
      {name === 'enter' && (
        <g fill="none" stroke="#e8eef4" stroke-width="2.6">
          <path d="M26 4 L26 15 L8 15" />
          <path d="M12 10 L7 15 L12 20" />
        </g>
      )}
      {name === 'backspace' && (
        <g fill="none" stroke="#e8eef4" stroke-width="2.6">
          <path d="M28 12 L6 12" />
          <path d="M11 7 L6 12 L11 17" />
        </g>
      )}
      {name === 'find' && (
        <g fill="none" stroke="#e8eef4" stroke-width="2.6">
          <circle cx="19" cy="9" r="6.5" />
          <path d="M14 14 L6 22" />
        </g>
      )}
      {(name === 'zoomIn' || name === 'zoomOut') && (
        <g fill="none" stroke="#5ad0ff" stroke-width="2.4">
          <circle cx="19" cy="9" r="7" />
          <path d="M14 14 L6 22" />
          <path d="M15 9 L23 9" />
          {name === 'zoomIn' && <path d="M19 5 L19 13" />}
        </g>
      )}
      {name === 'xfer' && (
        <g fill="#e8eef4">
          <path d="M16 1 L21 7 L11 7 Z M16 23 L21 17 L11 17 Z" />
          <rect x="15" y="6" width="2" height="12" />
        </g>
      )}
      {name === 'cdi' && (
        <g>
          <circle cx="16" cy="12" r="10" fill="#14202c" stroke="#9fb0c2" stroke-width="1.5" />
          <path d="M16 3 L16 21" stroke={MAGENTA} stroke-width="2.4" />
          <text x="6" y="10" font-size="5.5" fill="#ff3cf0" font-weight="700">GPS</text>
          <text x="19" y="10" font-size="5.5" fill="#3ee24a" font-weight="700">VLOC</text>
        </g>
      )}
      {name === 'obs' && (
        <g fill="none" stroke="#9fb0c2" stroke-width="1.6">
          <circle cx="16" cy="12" r="10" />
          <path d="M16 2 L16 6 M16 18 L16 22 M6 12 L10 12 M22 12 L26 12" />
          <circle cx="16" cy="12" r="2.5" fill="#9fb0c2" />
        </g>
      )}
      {name === 'remove' && (
        <g fill="none" stroke="#e8eef4" stroke-width="2.4">
          <circle cx="16" cy="12" r="9" />
          <path d="M9 19 L23 5" />
        </g>
      )}
    </svg>
  );
}
