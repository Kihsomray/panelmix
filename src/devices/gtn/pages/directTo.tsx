import { bearing, distanceNm, formatLat, formatLon } from '../../../core/geo';
import { NavDatabase } from '../../../core/navdb';
import { formatBearing, formatDistance } from '../../../ui/format';
import { activateDirectTo, targetFor } from '../actions';
import type { Gtn, PageView } from '../context';
import { keyboardIdent, keyboardReducer, startKeyboard } from '../keyboard';
import { isAirport, ranged, recordOf } from '../lookups';
import type { DirectTab, DirectTarget, Page } from '../model';
import { BearingArrow, BrgDis, IdentKey, InertKey, Tabs } from '../ui';

/*
 * Direct To: the Waypoint, FPL and NRST APT tabs, Activate, and Remove for
 * an active direct course. The knob edits the identifier in place (spell
 * ahead) and its push activates, as on the real unit.
 */

type DirectPage = Extract<Page, { kind: 'directTo' }>;

const TABS: readonly { id: DirectTab; label: string }[] = [
  { id: 'waypoint', label: 'Waypoint' },
  { id: 'fpl', label: 'FPL' },
  { id: 'nrst', label: 'NRST APT' },
];

function WaypointTab({ g, page }: { g: Gtn; page: DirectPage }) {
  const target = page.target;
  const rec = target ? recordOf(g.db, target.waypoint) : undefined;
  const a = g.state.aircraft;
  const brg = target ? g.mag.toMagnetic(bearing(a, target.waypoint), a.lat, a.lon) : null;
  const dis = target ? distanceNm(a, target.waypoint) : null;
  // City and state for airports; the database has no location for navaids.
  const place = isAirport(rec) ? [rec.city, rec.state].filter(Boolean).join(', ') : '';
  return (
    <div class="gtn-dto-wpt">
      {page.knobEntry ? (
        <div class="gtn-dto-knobentry" aria-live="polite">
          {page.knobEntry.text.split('').map((ch, i) => (
            <span key={i} class={i === page.knobEntry!.cursor ? 'is-cursor' : i < page.knobEntry!.entered ? '' : 'gtn-cyan'}>
              {ch === ' ' ? '_' : ch}
            </span>
          ))}
          <span class="gtn-ident-name">{rec?.name ?? 'No matches found'}</span>
        </div>
      ) : (
        <IdentKey
          waypoint={rec ?? target?.waypoint ?? null}
          class="gtn-dto-identkey"
          onPress={() =>
            g.go({
              type: 'open',
              page: { kind: 'keyboard', purpose: { kind: 'directTo' }, entry: startKeyboard(target?.waypoint.ident ?? ''), keyset: 0 },
            })
          }
        />
      )}
      <div class="gtn-dto-place">{place}</div>
      <div class="gtn-dto-data">
        <span class="gtn-data-label">Bearing:</span>
        <span class="gtn-data-value">
          {brg !== null && <BearingArrow bearingMag={brg} trackMag={g.derived.trackMag} />}
          {formatBearing(brg)}
        </span>
        <span class="gtn-data-label">Distance:</span>
        <span class="gtn-data-value">
          {formatDistance(dis)}
          <small>NM</small>
        </span>
        <span class="gtn-data-label">Position:</span>
        <span class="gtn-data-value gtn-dto-pos">
          {target ? (
            <>
              <span>{formatLat(target.waypoint.lat)}</span>
              <span>{formatLon(target.waypoint.lon)}</span>
            </>
          ) : (
            '_ __°__.__\''
          )}
        </span>
      </div>
      <div class="gtn-dto-options">
        {/* Course-to, holds and search patterns need leg types the trainer's FMS does not have. */}
        <InertKey class="gtn-dto-opt" note="Course To is not simulated">
          <span class="gtn-opt-label">Course To</span>
          <span class="gtn-opt-value">___°</span>
        </InertKey>
        <InertKey class="gtn-dto-opt" note="Holds are not simulated">
          <span class="gtn-opt-label">Hold</span>
          <span class="gtn-opt-value">___°</span>
        </InertKey>
        <InertKey class="gtn-dto-opt" note="Search and rescue patterns are not simulated">
          <span class="gtn-opt-label">SAR</span>
          <span class="gtn-opt-value">___</span>
        </InertKey>
      </div>
    </div>
  );
}

function FplTab({ g, page }: { g: Gtn; page: DirectPage }) {
  const plan = g.state.fms.plan;
  return (
    <div class="gtn-list">
      {plan.length === 0 && <div class="gtn-empty">No active flight plan</div>}
      {plan.map((w, i) => (
        <IdentKey
          key={`${i}-${w.ident}`}
          waypoint={recordOf(g.db, w) ?? w}
          class="gtn-list-ident"
          selected={page.target?.planIndex === i}
          onPress={() => g.go({ type: 'update', page: { ...page, tab: 'waypoint', target: { waypoint: w, planIndex: i }, knobEntry: null } })}
        />
      ))}
    </div>
  );
}

function NearestTab({ g, page }: { g: Gtn; page: DirectPage }) {
  const a = g.state.aircraft;
  const list = ranged(g.lists.airports, a);
  return (
    <div class="gtn-list">
      {list.map((r) => (
        <div class="gtn-row" key={r.item.ident}>
          <IdentKey
            waypoint={r.item}
            class="gtn-list-ident"
            onPress={() => g.go({ type: 'update', page: { ...page, tab: 'waypoint', target: targetFor(g, r.item), knobEntry: null } })}
          />
          <BrgDis bearingMag={g.mag.toMagnetic(r.bearingTrue, a.lat, a.lon)} trackMag={g.derived.trackMag} distanceNm={r.distanceNm} />
        </div>
      ))}
    </div>
  );
}

function DirectToBody({ g, page }: { g: Gtn; page: DirectPage }) {
  return (
    <div class={`gtn-dto gtn-dto-${g.model}`}>
      <Tabs tabs={TABS} active={page.tab} vertical={g.model === '650'} onSelect={(tab) => g.go({ type: 'update', page: { ...page, tab } })} />
      <div class="gtn-dto-pane">
        {page.tab === 'waypoint' && <WaypointTab g={g} page={page} />}
        {page.tab === 'fpl' && <FplTab g={g} page={page} />}
        {page.tab === 'nrst' && <NearestTab g={g} page={page} />}
      </div>
    </div>
  );
}

/** Knob editing of the identifier: spell ahead, and the target follows the match. */
function knobEdit(g: Gtn, page: DirectPage, action: { type: 'small' | 'large'; steps: number }) {
  const complete = (p: string) => g.db.complete(p)?.ident;
  const entry = keyboardReducer(page.knobEntry ?? startKeyboard(page.target?.waypoint.ident ?? ''), action, complete);
  const found = g.db.get(keyboardIdent(entry), g.state.aircraft);
  const target: DirectTarget | null = found ? targetFor(g, NavDatabase.toWaypoint(found)) : page.target;
  g.go({ type: 'update', page: { ...page, tab: 'waypoint', knobEntry: entry, target } });
}

export function directToView(g: Gtn, page: DirectPage): PageView {
  const target = page.target;
  const leg = g.state.fms.activeLeg;
  const activate = () => target && activateDirectTo(g, target);
  return {
    title: 'Direct To',
    body: <DirectToBody g={g} page={page} />,
    controls: {
      primary: { label: 'Activate', glyph: 'direct', onPress: activate, disabled: !target },
      ...(leg?.isDirectTo && {
        secondary: {
          label: 'Remove',
          glyph: 'remove' as const,
          onPress: () => {
            g.dispatch({ type: 'fms.cancelDirectTo' });
            g.go({ type: 'back' });
          },
        },
      }),
    },
    knob: {
      inner: (steps) => knobEdit(g, page, { type: 'small', steps }),
      outer: (steps) => knobEdit(g, page, { type: 'large', steps }),
      push: activate,
      hint: 'Edit Wpt / Psh Activate',
      labels: { outer: 'Cursor', inner: 'Character', push: 'Activate' },
    },
  };
}

/** Puts a waypoint chosen on the keyboard into the Direct-To page under it. */
export function directToWith(page: DirectPage, target: DirectTarget): DirectPage {
  return { ...page, tab: 'waypoint', target, knobEntry: null };
}

