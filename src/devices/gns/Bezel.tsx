import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { BezelButton } from '../../ui/controls/BezelButton';
import { Knob } from '../../ui/controls/Knob';
import { LAYOUT, type KeyDef, type Rect } from './layout';
import type { GnsInput, GnsKey, Model } from './model/types';
import { DtoGlyph } from './screen/symbols';

/*
 * The GNS bezel: keys, knobs and lettering. It never re-renders with the
 * simulator (memo on stable props); the screen next to it does.
 */

const box = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

/** "Press and hold the COM flip-flop key for approximately two seconds" tunes 121.500. */
const EMERGENCY_HOLD_MS = 2000;

function FlipArrow() {
  return (
    <svg width="7" height="13" viewBox="0 0 7 13" aria-hidden="true">
      <path d="M3.5 1V12M1 3.5L3.5 1L6 3.5M1 9.5L3.5 12L6 9.5" stroke="currentColor" stroke-width="1.3" fill="none" />
    </svg>
  );
}

/** The COM flip-flop: a press swaps, a two-second hold selects the emergency channel instead. */
function ComFlipKey({ k, send }: { k: KeyDef; send: (i: GnsInput) => void }) {
  const timer = useRef(0);
  const held = useRef(false);
  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => cancel, []);
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    cancel();
    timer.current = window.setTimeout(() => {
      held.current = true;
      send({ kind: 'hold', key: 'COM_FLIP' });
    }, EMERGENCY_HOLD_MS);
  };
  return (
    <div style={{ display: 'contents' }} onPointerDown={down} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}>
      <BezelButton
        x={k.x}
        y={k.y}
        w={k.w}
        h={k.h}
        class="gns-key"
        label={
          <span class="gns-flip-label">
            {k.label}
            <FlipArrow />
          </span>
        }
        ariaLabel={k.aria}
        onPress={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          send({ kind: 'key', key: 'COM_FLIP' });
        }}
      />
    </div>
  );
}

function Key({ k, send }: { k: KeyDef; send: (i: GnsInput) => void }) {
  const press = (key: GnsKey) => send({ kind: 'key', key });
  const label =
    k.key === 'DTO' ? (
      <DtoGlyph w={20} />
    ) : k.key === 'VLOC_FLIP' ? (
      <span class="gns-flip-label">
        {k.label}
        <FlipArrow />
      </span>
    ) : (
      k.label
    );
  return (
    <BezelButton
      x={k.x}
      y={k.y}
      w={k.w}
      h={k.h}
      class="gns-key"
      label={label}
      ariaLabel={k.aria}
      onPress={() => press(k.key)}
      {...(k.key === 'CLR' && { onLongPress: () => send({ kind: 'hold', key: 'CLR' }) })}
    />
  );
}

/** The RNG rocker: one key body, the down arrow zooms in, the up arrow zooms out. */
function RangeRocker({ r, send }: { r: Rect & { vertical: boolean }; send: (i: GnsInput) => void }) {
  const zoomIn = { kind: 'key', key: 'RNG_IN' } as const;
  const zoomOut = { kind: 'key', key: 'RNG_OUT' } as const;
  const half = r.vertical ? { w: r.w, h: r.h * 0.38 } : { w: r.w * 0.3, h: r.h };
  return (
    <>
      <div class="gns-rng-body" style={box(r)}>
        RNG
      </div>
      <BezelButton
        x={r.x}
        y={r.vertical ? r.y + r.h - half.h : r.y}
        w={half.w}
        h={half.h}
        class="gns-rng-half"
        label="▽"
        ariaLabel="Range down (zoom in)"
        repeat
        onPress={() => send(zoomIn)}
      />
      <BezelButton
        x={r.vertical ? r.x : r.x + r.w - half.w}
        y={r.y}
        w={half.w}
        h={half.h}
        class="gns-rng-half"
        label="△"
        ariaLabel="Range up (zoom out)"
        repeat
        onPress={() => send(zoomOut)}
      />
    </>
  );
}

export const GnsBezel = memo(function GnsBezel({ model, send }: { model: Model; send: (i: GnsInput) => void }) {
  const L = LAYOUT[model];
  const { comVol, vlocVol, left, right } = L.knobs;
  const t = L.text;
  const comKey = L.keys.find((k) => k.key === 'COM_FLIP')!;
  return (
    <>
      <div class="bezel gns-bezel" />
      <div class="gns-window" style={box(L.window)} />
      <div class="gns-shelf" style={box(L.shelf)} />
      <div class="gns-logo" style={{ left: `${L.logo.x}px`, top: `${L.logo.y}px` }}>
        GARMIN
      </div>
      <div class="gns-model" style={{ left: `${L.modelLabel.x}px`, top: `${L.modelLabel.y}px` }}>
        GNS {model}W
      </div>
      <div
        class="gns-photocell"
        style={box({ x: L.photocell.x - L.photocell.r, y: L.photocell.y - L.photocell.r, w: L.photocell.r * 2, h: L.photocell.r * 2 })}
      />
      {L.slots.map((s, i) => (
        <div key={i} class={`gns-slot ${s.h > s.w ? 'gns-slot-v' : 'gns-slot-h'}`} style={box(s)} />
      ))}
      <div class="gns-hole" style={box({ x: L.lockHole.x - L.lockHole.r, y: L.lockHole.y - L.lockHole.r, w: L.lockHole.r * 2, h: L.lockHole.r * 2 })} />

      <div class="gns-print" style={box(t.comVol)}>
        <small>PWR</small>
        <span>
          VOL<sup>/PUSH</sup>
        </span>
        <span>SQ</span>
      </div>
      <div class="gns-print" style={box(t.vlocVol)}>
        <span>
          VOL<sup>/PUSH</sup>
        </span>
        <span>ID</span>
      </div>
      <div class="gns-print gns-print-big" style={box(t.comVloc)}>
        <span>
          COM<span style={{ fontSize: '15px', verticalAlign: '-4px' }}>/</span>
          <span style={{ verticalAlign: '-6px' }}>VLOC</span>
        </span>
      </div>
      <div class="gns-print" style={box(t.defaultNav)}>
        <span>DEFAULT</span>
        <span>NAV</span>
      </div>
      <div class="gns-defnav-line" style={{ ...box(L.defaultNavLine), borderWidth: L.defaultNavLine.bracket ? '1px 1px 0 0' : '0 0 0 1px' }} />
      <div class="gns-print gns-print-big" style={box(t.gps)}>
        GPS
      </div>

      <ComFlipKey k={comKey} send={send} />
      {L.keys
        .filter((k) => k.key !== 'COM_FLIP')
        .map((k) => (
          <Key key={k.key} k={k} send={send} />
        ))}
      <RangeRocker r={L.rng} send={send} />

      <Knob
        id={`gns${model}.com-vol`}
        x={comVol.x}
        y={comVol.y}
        size={comVol.size}
        label="COM power and volume knob"
        innerLabel="COM volume"
        pushLabel="Squelch"
        onInner={(n) => send({ kind: 'volume', knob: 'com', steps: n })}
        onPush={() => send({ kind: 'volumePush', knob: 'com' })}
      />
      <div class="gns-cap" style={{ left: `${comVol.x}px`, top: `${comVol.y}px`, fontSize: '10px' }}>
        C
      </div>
      <Knob
        id={`gns${model}.vloc-vol`}
        x={vlocVol.x}
        y={vlocVol.y}
        size={vlocVol.size}
        label="VLOC volume knob"
        innerLabel="VLOC volume"
        pushLabel="Ident"
        onInner={(n) => send({ kind: 'volume', knob: 'vloc', steps: n })}
        onPush={() => send({ kind: 'volumePush', knob: 'vloc' })}
      />
      <div class="gns-cap" style={{ left: `${vlocVol.x}px`, top: `${vlocVol.y}px`, fontSize: '10px' }}>
        V
      </div>
      <Knob
        id={`gns${model}.left`}
        x={left.x}
        y={left.y}
        size={left.size}
        innerSize={left.inner!}
        label="COM/VLOC tuning knobs"
        outerLabel="MHz"
        innerLabel="kHz"
        pushLabel="COM / VLOC"
        onOuter={(n) => send({ kind: 'left', ring: 'outer', steps: n })}
        onInner={(n) => send({ kind: 'left', ring: 'inner', steps: n })}
        onPush={() => send({ kind: 'leftPush' })}
      />
      <div class="gns-cap" style={{ left: `${left.x}px`, top: `${left.y}px` }}>
        PUSH
        <br />
        C/V
      </div>
      <Knob
        id={`gns${model}.right`}
        x={right.x}
        y={right.y}
        size={right.size}
        innerSize={right.inner!}
        label="Page and cursor knobs"
        outerLabel="Group / field"
        innerLabel="Page / value"
        pushLabel="CRSR"
        onOuter={(n) => send({ kind: 'right', ring: 'outer', steps: n })}
        onInner={(n) => send({ kind: 'right', ring: 'inner', steps: n })}
        onPush={() => send({ kind: 'rightPush' })}
      />
      <div class="gns-cap" style={{ left: `${right.x}px`, top: `${right.y}px` }}>
        PUSH
        <br />
        CRSR
      </div>
    </>
  );
});
