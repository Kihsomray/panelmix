import { useEffect, useRef, useState } from 'preact/hooks';
import { closeDock, getDock, onDockChange, type KnobHandlers } from './knobDock';

/*
 * The touch remote for the selected knob: big turn and push buttons fixed to
 * the bottom of the screen. Holding a turn button keeps turning.
 */

export function KnobDock() {
  const [knob, setKnob] = useState<KnobHandlers | null>(getDock);
  useEffect(() => onDockChange(setKnob), []);
  useEffect(() => {
    if (!knob) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeDock();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [knob]);
  if (!knob) return null;

  // Always call the freshest handlers: devices re-create them every frame.
  const live = () => getDock() ?? knob;

  return (
    <div class="knob-dock" role="toolbar" aria-label={`${knob.label} controls`}>
      <div class="knob-dock-title">
        <span>{knob.label}</span>
        <button type="button" class="knob-dock-close" onClick={closeDock} aria-label="Close knob controls">
          ✕
        </button>
      </div>
      <div class="knob-dock-rows">
        {knob.turnOuter && (
          <DockRow
            label={knob.outerLabel ?? 'Large knob'}
            onTurn={(n) => live().turnOuter?.(n)}
          />
        )}
        {knob.turnInner && (
          <DockRow
            label={knob.innerLabel ?? (knob.turnOuter ? 'Small knob' : 'Turn')}
            onTurn={(n) => live().turnInner?.(n)}
          />
        )}
        {knob.push && (
          <button type="button" class="knob-dock-push" onClick={() => live().push?.()}>
            {knob.pushLabel ?? 'Push'}
          </button>
        )}
        {knob.longPush && (
          <button type="button" class="knob-dock-push" onClick={() => live().longPush?.()}>
            {knob.longPushLabel ?? 'Push and hold'}
          </button>
        )}
      </div>
    </div>
  );
}

function DockRow({ label, onTurn }: { label: string; onTurn: (steps: number) => void }) {
  return (
    <div class="knob-dock-row">
      <RepeatButton aria="Turn left" onStep={() => onTurn(-1)}>
        ⟲
      </RepeatButton>
      <span class="knob-dock-label">{label}</span>
      <RepeatButton aria="Turn right" onStep={() => onTurn(1)}>
        ⟳
      </RepeatButton>
    </div>
  );
}

function RepeatButton({ aria, onStep, children }: { aria: string; onStep: () => void; children: string }) {
  const timers = useRef<number[]>([]);
  const fired = useRef(false);
  const latest = useRef(onStep);
  latest.current = onStep;
  const stop = () => {
    for (const t of timers.current) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    timers.current = [];
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      class="knob-dock-turn"
      aria-label={aria}
      onPointerDown={() => {
        fired.current = false;
        timers.current.push(
          window.setTimeout(() => {
            fired.current = true;
            latest.current();
            timers.current.push(window.setInterval(() => latest.current(), 110));
          }, 380),
        );
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        latest.current();
      }}
    >
      {children}
    </button>
  );
}
