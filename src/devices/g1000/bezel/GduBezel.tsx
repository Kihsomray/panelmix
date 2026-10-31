import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useRef } from 'preact/hooks';
import { BezelButton } from '../../../ui/controls/BezelButton';
import { Knob } from '../../../ui/controls/Knob';
import { AFCS_KEY_NAMES, AFCS_LAYOUT, type AfcsKey } from '../shared/afcs';
import { AFCS_COLS, AFCS_KEY, AFCS_ROWS, KEYS, KNOBS, PAN_ARROWS, SOFTKEY, softkeyX, type KeySpot } from './geometry';

/*
 * The GDU 1040 / 1044B bezel shared by the PFD and the MFD: every knob and
 * key in its real place. With the GFC 700 installed the bezel is a GDU
 * 1044B and carries the twelve AFCS mode keys on the left; otherwise
 * (KAP 140 or no autopilot) that area is blank.
 *
 * The bezel re-renders only when its layout or labels change: the screen
 * behind it redraws every frame, so the handlers are reached through a
 * stable object that always calls the device's latest functions.
 */

export type PanDirection = 'left' | 'right' | 'up' | 'down';

export interface GduActions {
  readonly navVolume: (steps: number) => void;
  readonly navIdent: () => void;
  readonly navSwap: () => void;
  readonly navOuter: (steps: number) => void;
  readonly navInner: (steps: number) => void;
  readonly navToggle: () => void;
  readonly heading: (steps: number) => void;
  readonly headingSync: () => void;
  readonly altOuter: (steps: number) => void;
  readonly altInner: (steps: number) => void;
  readonly comVolume: (steps: number) => void;
  readonly comSquelch: () => void;
  readonly comSwap: () => void;
  readonly comEmergency: () => void;
  readonly comOuter: (steps: number) => void;
  readonly comInner: (steps: number) => void;
  readonly comToggle: () => void;
  readonly baro: (steps: number) => void;
  readonly course: (steps: number) => void;
  readonly courseCenter: () => void;
  readonly range: (steps: number) => void;
  readonly pan: () => void;
  readonly panMove: (dir: PanDirection) => void;
  readonly directTo: () => void;
  readonly menu: () => void;
  readonly fpl: () => void;
  readonly proc: () => void;
  readonly clr: () => void;
  readonly clrHold: () => void;
  readonly ent: () => void;
  readonly fmsOuter: (steps: number) => void;
  readonly fmsInner: (steps: number) => void;
  readonly fmsPush: () => void;
  readonly softkey: (index: number) => void;
  readonly afcs: (key: AfcsKey) => void;
}

/**
 * A stable action object for the memoized bezel. Each control use builds
 * the handlers afresh from the latest simulator and screen state, so a fast
 * spin of a knob (several steps between two frames) never works from a
 * stale snapshot and loses steps.
 */
export function useLiveActions(build: () => GduActions): GduActions {
  const ref = useRef(build);
  ref.current = build;
  return useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(build()) as (keyof GduActions)[]) {
      out[name] = (...args: unknown[]) => (ref.current()[name] as (...a: unknown[]) => void)(...args);
    }
    return out as unknown as GduActions;
  }, []);
}

interface BezelProps {
  /** "g1000-pfd" or "g1000-mfd": prefixes the knob ids. */
  readonly unit: string;
  /** GDU 1044B with the GFC 700 mode keys. */
  readonly afcs: boolean;
  readonly actions: GduActions;
  /** Current softkey labels joined with "|", so screen readers hear what each key does. */
  readonly softkeyNames: string;
  /** What the FMS knob does on the screen right now, for the touch knob dock. */
  readonly fmsUse: FmsUse;
}

/** The FMS knob either pages through the MFD, moves a cursor, or does nothing on this screen. */
export type FmsUse = 'pages' | 'cursor' | 'idle';

const FMS_LABELS: Record<FmsUse, { outer: string; inner: string }> = {
  pages: { outer: 'Page group', inner: 'Page' },
  cursor: { outer: 'Move cursor', inner: 'Change entry' },
  idle: { outer: 'Large FMS', inner: 'Small FMS' },
};

const box = (k: KeySpot) => ({ x: k.cx - k.w / 2, y: k.cy - k.h / 2, w: k.w, h: k.h });

function Label({ x, y, children, size = 13, anchor = 'middle' }: { x: number; y: number; children: ComponentChildren; size?: number; anchor?: 'start' | 'middle' | 'end' }) {
  const shift = anchor === 'middle' ? '-50%' : anchor === 'end' ? '-100%' : '0';
  return (
    <div class="g1000-label" style={{ left: `${x}px`, top: `${y}px`, fontSize: `${size}px`, transform: `translate(${shift}, -50%)` }}>
      {children}
    </div>
  );
}

/** Small "PUSH" over the push function, as printed under the Garmin knobs. */
function PushLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div class="g1000-label g1000-push" style={{ left: `${x}px`, top: `${y}px` }}>
      <span>PUSH</span>
      {text}
    </div>
  );
}

function SwapGlyph() {
  return (
    <svg viewBox="0 0 24 10" width="22" height="9" aria-hidden="true">
      <path d="M1 5 L6 1 V9 Z M23 5 L18 1 V9 Z M6 5 H18" fill="#f1f1f1" stroke="#f1f1f1" stroke-width="1.6" />
    </svg>
  );
}

function DirectToGlyph() {
  return (
    <svg viewBox="0 0 30 14" width="26" height="12" aria-hidden="true">
      <path d="M8 1.5 h5 a5.5 5.5 0 0 1 0 11 h-5 Z" fill="none" stroke="#f1f1f1" stroke-width="1.8" />
      <path d="M1 7 H22 M20 3.5 L27 7 L20 10.5 Z" fill="#f1f1f1" stroke="#f1f1f1" stroke-width="1.6" />
    </svg>
  );
}

function SoftkeyGlyph() {
  return (
    <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
      <path d="M6 0 L12 8 H0 Z" fill="#f1f1f1" />
    </svg>
  );
}

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <svg class="g1000-screw" style={{ left: `${x - 9}px`, top: `${y - 9}px` }} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="#55585d" stroke="#1d1e20" stroke-width="1" />
      <path d="M4 7 L14 11" stroke="#202124" stroke-width="2" />
    </svg>
  );
}

function AfcsKeys({ actions }: { actions: GduActions }) {
  return (
    <>
      {AFCS_LAYOUT.map((row, r) =>
        row.map((key, c) => {
          const nose = key === 'NOSE_UP' || key === 'NOSE_DN';
          return (
            <BezelButton
              key={key}
              x={AFCS_COLS[c]! - AFCS_KEY.w / 2}
              y={AFCS_ROWS[r]! - AFCS_KEY.h / 2}
              w={AFCS_KEY.w}
              h={AFCS_KEY.h}
              fontSize={nose ? 11 : 13}
              label={
                nose ? (
                  <span class="g1000-nose">
                    <small>NOSE</small>
                    {key === 'NOSE_UP' ? 'UP' : 'DN'}
                  </span>
                ) : (
                  key
                )
              }
              ariaLabel={AFCS_KEY_NAMES[key]}
              onPress={() => actions.afcs(key)}
            />
          );
        }),
      )}
    </>
  );
}

function Bezel({ unit, afcs, actions: a, softkeyNames, fmsUse }: BezelProps) {
  const K = KNOBS;
  const names = softkeyNames.split('|');
  return (
    <div class="g1000-bezel" aria-hidden="false">
      <div class="g1000-recess" />
      <div class="g1000-logo">GARMIN</div>
      <Screw x={27} y={46} />
      <Screw x={27} y={720} />
      <Screw x={1150} y={46} />
      <Screw x={1150} y={720} />
      <div class="g1000-photocell" style={{ left: '120px', top: '231px' }} />
      <div class="g1000-photocell" style={{ left: '120px', top: '250px' }} />
      <div class="g1000-sensor" style={{ left: '1042px', top: '47px' }} />
      <div class="g1000-sensor is-square" style={{ left: '119px', top: '677px' }} />
      <div class="g1000-sdslot" style={{ left: '1041px', top: '159px', height: '58px' }} />
      <div class="g1000-sdslot" style={{ left: '1041px', top: '298px', height: '98px' }} />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} class="g1000-sk-tick" style={{ left: `${softkeyX(i)}px` }} />
      ))}

      {/* Left column ------------------------------------------------------- */}
      <Label x={36} y={86} size={11}>
        VOL<sup>PUSH ID</sup>
      </Label>
      <Knob
        id={`${unit}.nav-vol`}
        {...K.navVol}
        label="NAV volume knob. Push for the Morse ident"
        innerLabel="NAV volume"
        pushLabel="Ident on/off"
        onInner={a.navVolume}
        onPush={a.navIdent}
      />
      <BezelButton {...box(KEYS.navSwap)} label={<SwapGlyph />} ariaLabel="NAV frequency transfer" onPress={a.navSwap} />
      <Label x={K.nav.x} y={128} size={16}>
        NAV
      </Label>
      <Knob
        id={`${unit}.nav`}
        x={K.nav.x}
        y={K.nav.y}
        size={K.nav.size}
        innerSize={K.nav.inner}
        label="NAV frequency knob. Push to switch NAV1 and NAV2"
        outerLabel="MHz"
        innerLabel="kHz"
        pushLabel="NAV 1-2"
        onOuter={a.navOuter}
        onInner={a.navInner}
        onPush={a.navToggle}
      />
      <PushLabel x={K.nav.x} y={230} text="1-2" />
      <Label x={K.hdg.x} y={264} size={16}>
        HDG
      </Label>
      <Knob
        id={`${unit}.hdg`}
        {...K.hdg}
        label="Heading knob. Push to sync the bug to the current heading"
        innerLabel="Heading bug"
        pushLabel="HDG sync"
        onInner={a.heading}
        onPush={a.headingSync}
      />
      <PushLabel x={K.hdg.x} y={363} text="HDG SYNC" />
      {afcs && <div class="g1000-afcs-frame" />}
      {afcs && <AfcsKeys actions={a} />}
      <Label x={K.alt.x} y={657} size={16}>
        ALT
      </Label>
      <Knob
        id={`${unit}.alt`}
        x={K.alt.x}
        y={K.alt.y}
        size={K.alt.size}
        innerSize={K.alt.inner}
        label="Selected altitude knob"
        outerLabel="1000 ft"
        innerLabel="100 ft"
        onOuter={a.altOuter}
        onInner={a.altInner}
      />

      {/* Right column ------------------------------------------------------ */}
      <Label x={1143} y={86} size={11}>
        VOL<sup>PUSH SQ</sup>
      </Label>
      <Knob
        id={`${unit}.com-vol`}
        {...K.comVol}
        label="COM volume knob. Push for squelch"
        innerLabel="COM volume"
        pushLabel="Squelch"
        onInner={a.comVolume}
        onPush={a.comSquelch}
      />
      <BezelButton
        {...box(KEYS.comSwap)}
        label={<SwapGlyph />}
        ariaLabel="COM frequency transfer. Hold two seconds for 121.5"
        holdMs={2000}
        onPress={a.comSwap}
        onLongPress={a.comEmergency}
      />
      <Label x={1056} y={127} size={9}>
        <span class="g1000-emerg">
          <i>↑</i>EMERG
        </span>
      </Label>
      <Label x={K.com.x + 4} y={128} size={16}>
        COM
      </Label>
      <Knob
        id={`${unit}.com`}
        x={K.com.x}
        y={K.com.y}
        size={K.com.size}
        innerSize={K.com.inner}
        label="COM frequency knob. Push to switch COM1 and COM2"
        outerLabel="MHz"
        innerLabel="kHz"
        pushLabel="COM 1-2"
        onOuter={a.comOuter}
        onInner={a.comInner}
        onPush={a.comToggle}
      />
      <PushLabel x={K.com.x} y={230} text="1-2" />
      <Label x={K.crsBaro.x + 6} y={264} size={14}>
        CRS<span class="g1000-crs-glyph">⊕</span>BARO
      </Label>
      <Knob
        id={`${unit}.crs-baro`}
        x={K.crsBaro.x}
        y={K.crsBaro.y}
        size={K.crsBaro.size}
        innerSize={K.crsBaro.inner}
        label="CRS and BARO knob. Push to center the course"
        outerLabel="Baro"
        innerLabel="Course"
        pushLabel="CRS center"
        onOuter={a.baro}
        onInner={a.course}
        onPush={a.courseCenter}
      />
      <PushLabel x={K.crsBaro.x} y={364} text="CRS CTR" />
      <Label x={K.range.x} y={394} size={14}>
        RANGE
      </Label>
      <div class="g1000-range-marks" aria-hidden="true">
        <span style={{ left: '1066px', top: '402px' }}>−</span>
        <span style={{ left: '1131px', top: '402px' }}>+</span>
      </div>
      {(Object.keys(PAN_ARROWS) as (keyof typeof PAN_ARROWS)[]).map((dir) => {
        const p = PAN_ARROWS[dir];
        return (
          <BezelButton
            key={dir}
            x={p.cx - 9}
            y={p.cy - 9}
            w={18}
            h={18}
            class={`g1000-pan g1000-pan-${dir}`}
            label={<span class="g1000-pan-tri" />}
            ariaLabel={`Joystick ${dir}`}
            repeat
            onPress={() => a.panMove(dir)}
          />
        );
      })}
      <Knob
        id={`${unit}.range`}
        {...K.range}
        label="RANGE joystick. Turn for map range, push to pan"
        innerLabel="Map range"
        pushLabel="Pan"
        onInner={a.range}
        onPush={a.pan}
      />
      <PushLabel x={K.range.x} y={500} text="PAN" />
      <BezelButton {...box(KEYS.directTo)} label={<DirectToGlyph />} ariaLabel="Direct-to" onPress={a.directTo} />
      <BezelButton {...box(KEYS.menu)} label="MENU" fontSize={12} onPress={a.menu} />
      <BezelButton {...box(KEYS.fpl)} label="FPL" fontSize={13} ariaLabel="Flight plan" onPress={a.fpl} />
      <BezelButton {...box(KEYS.proc)} label="PROC" fontSize={12} ariaLabel="Procedures" onPress={a.proc} />
      <BezelButton {...box(KEYS.clr)} label="CLR" fontSize={13} ariaLabel="Clear. Hold for the default map" onPress={a.clr} onLongPress={a.clrHold} />
      <BezelButton {...box(KEYS.ent)} label="ENT" fontSize={13} ariaLabel="Enter" onPress={a.ent} />
      <Label x={1046} y={657} size={8}>
        <span class="g1000-emerg">
          <i>↑</i>DFLT MAP
        </span>
      </Label>
      <Label x={K.fms.x + 8} y={657} size={16}>
        FMS
      </Label>
      <Knob
        id={`${unit}.fms`}
        x={K.fms.x}
        y={K.fms.y}
        size={K.fms.size}
        innerSize={K.fms.inner}
        label="FMS knob. Push for the cursor"
        outerLabel={FMS_LABELS[fmsUse].outer}
        innerLabel={FMS_LABELS[fmsUse].inner}
        pushLabel="Cursor"
        onOuter={a.fmsOuter}
        onInner={a.fmsInner}
        onPush={a.fmsPush}
      />
      <Label x={K.fms.x} y={754} size={9}>
        PUSH CRSR
      </Label>

      {/* Softkeys ------------------------------------------------------------- */}
      {Array.from({ length: 12 }, (_, i) => (
        <BezelButton
          key={`sk${i}`}
          x={softkeyX(i) - SOFTKEY.w / 2}
          y={SOFTKEY.cy - SOFTKEY.h / 2}
          w={SOFTKEY.w}
          h={SOFTKEY.h}
          look="softkey"
          label={<SoftkeyGlyph />}
          ariaLabel={`Softkey ${i + 1}${names[i] ? `: ${names[i]}` : ''}`}
          onPress={() => a.softkey(i)}
        />
      ))}
    </div>
  );
}

/** Memoized: it changes only when the autopilot option, the softkey labels or the FMS knob's use do. */
export const GduBezel = memo(Bezel);
