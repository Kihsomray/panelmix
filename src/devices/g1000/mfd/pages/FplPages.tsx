import type { PlanLegInfo } from '../../../../sim/fms';
import type { ActiveLeg } from '../../../../sim/types';
import { Group, Win } from '../../screen/Frames';
import { FplList } from '../../screen/FplList';
import type { FplCursor } from '../../shared/flightPlan';
import { checklistsOf, isChecked } from '../checklists';
import { MFD_FPL_ROWS, PANEL, SPLIT_MAP } from '../layout';
import type { ChecklistState } from '../mfdState';
import { PageMap, type MapBase } from './MapPages';

/*
 * FPL group (Active Flight Plan, Flight Plan Catalog) and the checklist
 * page on the MFD.
 */

export function ActiveFplPage({
  base,
  legs,
  activeLeg,
  cursor,
  scroll,
  comment,
  wide,
}: {
  base: MapBase;
  legs: readonly PlanLegInfo[];
  activeLeg: ActiveLeg | null;
  cursor: FplCursor;
  scroll: number;
  comment: string;
  wide: boolean;
}) {
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} />
      <Win rect={PANEL} class="g1000-panel">
        <Group title="ACTIVE FLIGHT PLAN">
          <div class="g1000-row g1000-fpl-comment">{comment}</div>
          <div class={`g1000-row g1000-fpl-head${wide ? ' is-wide' : ''}`}>
            <span>DTK</span>
            <span>DIS</span>
            {wide && <span>ALT</span>}
          </div>
          <FplList legs={legs} activeLeg={activeLeg} cursor={cursor} scroll={scroll} rows={MFD_FPL_ROWS} rowH={30} wide={wide} />
        </Group>
      </Win>
    </>
  );
}

export function NoStoredPlansPage({ base }: { base: MapBase }) {
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} />
      <Win rect={PANEL} class="g1000-panel">
        <Group title="FLIGHT PLAN CATALOG">
          <div class="g1000-row g1000-split">
            <span>USED</span>
            <span class="g1000-cyan">0</span>
          </div>
          <div class="g1000-honest">The trainer keeps only the active flight plan; stored flight plans are not available.</div>
        </Group>
      </Win>
    </>
  );
}

export function ChecklistPage({ c }: { c: ChecklistState }) {
  const lists = checklistsOf(c);
  const list = lists[c.list];
  return (
    <Win rect={{ x: 156, y: 56, w: 864, h: 650 }} class="g1000-panel g1000-chk">
      <div class="g1000-row g1000-split">
        <span>
          GROUP <b class="g1000-cyan">{c.emergency ? 'EMERGENCY' : 'NORMAL'}</b>
        </span>
        <span>
          CHECKLIST <b class="g1000-cyan">{list?.name ?? ''}</b>
        </span>
      </div>
      <Group title={list?.name ?? ''}>
        {list?.items.map(([item, action], i) => {
          const done = isChecked(c, c.list, i);
          return (
            <div key={item + i} class={`g1000-row g1000-chk-item${c.active && i === c.item ? ' is-cursor' : ''}${done ? ' is-done' : ''}`}>
              <span class="g1000-chk-box">{done ? '✓' : ''}</span>
              <span>{item}</span>
              <span class="g1000-chk-dots" />
              <span>{action}</span>
            </div>
          );
        })}
      </Group>
      <div class="g1000-hint g1000-chk-hint">
        Sample checklist for practice. Push the FMS knob for the cursor: large knob picks the checklist, small knob the item, ENT or CHECK checks it.
      </div>
    </Win>
  );
}
