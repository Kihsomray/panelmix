import { planLegs } from '../../../sim/fms';
import { formatBearing, formatDistance } from '../../../ui/format';
import type { Gtn, PageView } from '../context';
import { DirectToGlyph } from '../icons';
import { recordOf } from '../lookups';
import type { Page } from '../model';
import { startKeyboard } from '../keyboard';
import { IdentKey, InertKey, Key } from '../ui';

/*
 * Active Flight Plan: one line per waypoint with the leg's desired track and
 * distance, the active leg in magenta with the bracket from its FROM to its
 * TO waypoint, and Add Waypoint at the end. Tapping an identifier opens the
 * waypoint options; Menu holds Delete and Invert.
 */

type FplPage = Extract<Page, { kind: 'flightPlan' }>;

const ROW_H: Record<Gtn['model'], number> = { '750': 46, '650': 38 };

export function addWaypoint(g: Gtn, index: number) {
  g.go({ type: 'open', page: { kind: 'keyboard', purpose: { kind: 'fplInsert', index }, entry: startKeyboard(), keyset: 0 } });
}

function FlightPlanBody({ g, page }: { g: Gtn; page: FplPage }) {
  const fms = g.state.fms;
  const pos = g.state.aircraft;
  const legs = planLegs(fms, pos, g.mag);
  const leg = fms.activeLeg;
  const gps = g.derived.gps;
  const rowH = ROW_H[g.model];
  const active = leg?.planIndex ?? null;
  const fromIndex = leg && !leg.isDirectTo && active !== null ? active - 1 : null;
  const plan = fms.plan;
  const route = plan.length > 0 ? `${plan[0]!.ident} / ${plan[plan.length - 1]!.ident}` : '';
  const showAlt = g.model === '750';
  return (
    <div class={`gtn-fpl gtn-fpl-${g.model}`}>
      <div class="gtn-fpl-head">
        <span class="gtn-fpl-route">{route}</span>
        {showAlt && <span class="gtn-fpl-col">ALT</span>}
        <span class="gtn-fpl-col">DTK</span>
        <span class="gtn-fpl-col">DIS</span>
      </div>
      <div class="gtn-list gtn-fpl-list">
        <div class="gtn-fpl-rows" style={{ position: 'relative' }}>
          {fromIndex !== null && active !== null && (
            <svg
              class="gtn-fpl-bracket"
              style={{ top: `${fromIndex * rowH + rowH / 2}px`, height: `${(active - fromIndex) * rowH}px` }}
              viewBox={`0 0 12 ${(active - fromIndex) * rowH}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={`M11 1 H4 V${(active - fromIndex) * rowH - 1} H8`} fill="none" stroke="#ff3cf0" stroke-width="2.5" />
              <path d={`M7 ${(active - fromIndex) * rowH - 5} L12 ${(active - fromIndex) * rowH - 1} L7 ${(active - fromIndex) * rowH + 3} Z`} fill="#ff3cf0" />
            </svg>
          )}
          {legs.map((l) => {
            const isActive = l.isActive;
            const rec = recordOf(g.db, l.waypoint);
            const dtk = isActive ? gps.dtkMag : l.dtkMag;
            const dis = isActive ? gps.distanceNm : l.legNm;
            return (
              <div
                key={`${l.index}-${l.waypoint.ident}`}
                class={`gtn-fpl-row${isActive ? ' is-active' : ''}${page.cursor === l.index ? ' is-cursor' : ''}`}
                style={{ height: `${rowH}px` }}
              >
                <span class="gtn-fpl-gutter">{isActive && leg?.isDirectTo && <DirectToGlyph color="#ff3cf0" />}</span>
                <IdentKey
                  waypoint={rec ?? l.waypoint}
                  tone={isActive ? 'magenta' : 'cyan'}
                  selected={page.cursor === l.index}
                  onPress={() => {
                    g.go({ type: 'update', page: { ...page, cursor: l.index } });
                    g.go({ type: 'modal', modal: { kind: 'wptOptions', index: l.index } });
                  }}
                  class="gtn-fpl-ident"
                />
                {showAlt && (
                  // Altitude constraints need VNAV, which the trainer does not simulate.
                  <InertKey class="gtn-fpl-alt" note="Altitude constraints (VNAV) are not simulated">
                    _____<small>FT</small>
                  </InertKey>
                )}
                <span class={`gtn-fpl-val${isActive ? ' gtn-magenta' : ''}`}>{l.index === 0 && !isActive ? '' : formatBearing(dtk)}</span>
                <span class={`gtn-fpl-val${isActive ? ' gtn-magenta' : ''}`}>
                  {l.index === 0 && !isActive ? '' : formatDistance(dis)}
                  {(l.index > 0 || isActive) && <small>NM</small>}
                </span>
              </div>
            );
          })}
        </div>
        <Key class="gtn-fpl-add" onPress={() => addWaypoint(g, plan.length)}>
          Add Waypoint
        </Key>
      </div>
    </div>
  );
}

export function flightPlanView(g: Gtn, page: FplPage): PageView {
  const n = g.state.fms.plan.length;
  return {
    title: 'Active Flight Plan',
    body: <FlightPlanBody g={g} page={page} />,
    controls: {
      menu: () => g.go({ type: 'modal', modal: { kind: 'fplMenu' } }),
      cdiObs: true,
    },
    knob: {
      // Small knob scrolls the cursor through the waypoints.
      inner: (s) => {
        if (n === 0) return;
        const from = page.cursor ?? (s > 0 ? -1 : n);
        g.go({ type: 'update', page: { ...page, cursor: Math.min(Math.max(from + s, 0), n - 1) } });
      },
      innerIcon: 'scroll',
    },
  };
}

