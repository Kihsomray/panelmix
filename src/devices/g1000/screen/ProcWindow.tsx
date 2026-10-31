import type { Waypoint } from '../../../core/navdb';
import { PROC_NONE, PROC_TITLES, type ProcState } from '../shared/procedures';
import { Group, Win, type Rect } from './Frames';

/*
 * The PROC key's window, shared by both displays (Pilot's Guide Figures
 * 5-129 and 5-130): the OPTIONS list with the activate items gray while
 * nothing is loaded, the LOADED box, and for a SELECT option the loading
 * frame for the destination airport with the trainer's honest answer.
 */

export function ProcWindow({ proc, airport, rect }: { proc: ProcState; airport: Waypoint | null; rect: Rect }) {
  if (!proc.loading) {
    return (
      <Win rect={rect} title="PROCEDURES" class="g1000-proc">
        <Group title="OPTIONS">
          {proc.menu.items.map((item, i) => (
            <div key={item.id} class={`g1000-menu-item${item.enabled ? '' : ' is-disabled'}${i === proc.menu.cursor ? ' is-cursor' : ''}`}>
              {item.label}
            </div>
          ))}
        </Group>
        <Group title="LOADED">
          <div class="g1000-row g1000-proc-loaded">APPROACH:</div>
          <div class="g1000-row g1000-cyan">_____</div>
          <div class="g1000-row g1000-proc-loaded">ARRIVAL:</div>
          <div class="g1000-row g1000-cyan">_____</div>
          <div class="g1000-row g1000-proc-loaded">DEPARTURE:</div>
          <div class="g1000-row g1000-cyan">_____</div>
        </Group>
        <div class="g1000-hint">Press the "PROC" key to view the previous page</div>
      </Win>
    );
  }
  return (
    <Win rect={rect} title={PROC_TITLES[proc.loading]} class="g1000-proc">
      <Group title="AIRPORT">
        <div class="g1000-row g1000-cyan">{airport?.ident ?? '____'}</div>
        <div class="g1000-row g1000-wpname">{airport?.name.toUpperCase() ?? ''}</div>
      </Group>
      <Group title={proc.loading.toUpperCase()}>
        <div class="g1000-honest">{PROC_NONE[proc.loading]}</div>
      </Group>
      <div class="g1000-row g1000-dto-cmds">
        <span class="g1000-cmd is-disabled">LOAD?</span>
        <span class="g1000-or">OR</span>
        <span class="g1000-cmd is-disabled">ACTIVATE?</span>
      </div>
      <div class="g1000-hint">Press CLR to return to the procedures options</div>
    </Win>
  );
}
