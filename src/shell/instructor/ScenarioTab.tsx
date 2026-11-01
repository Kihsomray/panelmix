import { useEffect, useMemo, useState } from 'preact/hooks';
import { NavDatabase, type Airport } from '../../core/navdb';
import { shortApproachName } from '../../core/procedures';
import { useSim, useSimulator } from '../../sim/hooks';
import { formatAltitude, formatBearing } from '../../ui/format';
import { useSessionState } from '../context';
import { Segmented } from '../controls';
import {
  approachHolds,
  DEFAULT_DISTANCE_NM,
  holdLegText,
  planScenario,
  usesLocalizer,
  type ApproachLoad,
  type HoldEntry,
  type StartChoice,
} from './scenario';
import { scenarioEnv } from './scenarioEnv';

/*
 * Scenario starts: pick an airport, one of its approaches and a transition,
 * and where to start; the airplane is placed, the approach loaded, the
 * localizer tuned for ILS and LOC approaches and, if wanted, the autopilot
 * engaged.
 */

type StartKind = StartChoice['kind'];
const FIRST = '__first';

const ENTRIES: readonly { readonly id: HoldEntry; readonly name: string }[] = [
  { id: 'direct', name: 'Direct' },
  { id: 'teardrop', name: 'Teardrop' },
  { id: 'parallel', name: 'Parallel' },
];

export function ScenarioTab() {
  const sim = useSimulator();
  const { state, db, mag, procedures } = useSim();
  const [airportId, setAirportId] = useSessionState('scn.airport', 'KJYO');
  const [query, setQuery] = useState('');
  const [approachId, setApproachId] = useSessionState('scn.approach', '');
  const [transition, setTransition] = useSessionState('scn.transition', FIRST);
  const [kind, setKind] = useSessionState<StartKind>('scn.kind', 'transition');
  const [holdIndex, setHoldIndex] = useSessionState('scn.hold', 0);
  const [entry, setEntry] = useSessionState<HoldEntry>('scn.entry', 'direct');
  const [autopilot, setAutopilot] = useSessionState('scn.ap', true);
  const [load, setLoad] = useSessionState<ApproachLoad>('scn.load', 'activate');
  const [started, setStarted] = useState<{ readonly summary: string; readonly notes: readonly string[] } | null>(null);

  // Procedure files load on demand: show them when they arrive.
  const [, setLoaded] = useState(0);
  useEffect(() => procedures?.subscribe(() => setLoaded((n) => n + 1)), [procedures]);

  const airport = db.airport(airportId);
  const procs = procedures?.get(airportId);
  const approaches = procs?.approaches ?? [];
  const approach = approaches.find((a) => a.id === approachId) ?? approaches[0];
  const transitions = approach?.transitions ?? [];
  const trans = transition === '' ? null : transitions.some((t) => t.name === transition) ? transition : transitions[0]?.name ?? null;
  const holds = useMemo(() => (approach ? approachHolds(approach) : []), [approach]);
  const firstFix = transitions.find((t) => t.name === trans)?.legs.find((l) => l.fix)?.fix?.ident ?? trans;

  const starts: { kind: StartKind; label: string; detail: string }[] = [];
  if (trans) {
    starts.push({
      kind: 'transition',
      label: `${DEFAULT_DISTANCE_NM.transition} nm before ${firstFix}`,
      detail: 'On the first leg of the transition, at its altitude, heading for the fix.',
    });
  }
  starts.push(
    { kind: 'final', label: `${DEFAULT_DISTANCE_NM.final} nm final`, detail: 'Lined up with the final approach course, below the glidepath.' },
    { kind: 'intercept', label: 'Vectors to final', detail: `${DEFAULT_DISTANCE_NM.intercept} nm out, 2 nm to the side, on a 30 degree intercept heading.` },
  );
  if (holds.length > 0) starts.push({ kind: 'hold', label: 'At a holding fix', detail: `${holds[0]!.label}${holds.length > 1 ? ' and others' : ''}.` });
  const startKind = starts.some((s) => s.kind === kind) ? kind : starts[0]!.kind;
  const holdAt = Math.min(holdIndex, Math.max(holds.length - 1, 0));
  const hold = holds[holdAt];

  const plan = useMemo(() => {
    if (!approach || !airport) return null;
    const choice: StartChoice = startKind === 'hold' ? { kind: 'hold', holdIndex: holdAt, entry } : { kind: startKind };
    return planScenario(
      {
        airport: NavDatabase.toWaypoint(airport),
        fieldElevationFt: airport.elevationFt,
        procedures: procs ?? null,
        approach,
        transition: trans,
        start: choice,
        load,
        autopilot,
        setAltimeter: true,
      },
      scenarioEnv(db, mag, approach, state.env.qnhInHg),
    );
  }, [approach, airport, procs, trans, startKind, holdAt, entry, load, autopilot, state.env.qnhInHg, db, mag]);

  const results = query.trim().length >= 2 ? airportResults(db, query, (id) => procedures?.has(id) ?? false) : [];
  const ready = !!procedures && procedures.has(airportId) && procs !== undefined && !!approach;
  const pick = (ident: string) => {
    setAirportId(ident);
    setApproachId('');
    setTransition(FIRST);
    setQuery('');
    setStarted(null);
  };

  return (
    <div class="ins-section ins-scenario">
      <div class="ins-col ins-area-where">
        <div class="ins-airport-name">
          <strong>{airport?.ident ?? airportId}</strong> {airport?.name ?? 'Not in the database'}
        </div>
        <label class="field">
          <span>Change airport</span>
          <input
            value={query}
            placeholder="Identifier or name, e.g. KHGR or Frederick"
            autoComplete="off"
            autoCapitalize="characters"
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        {results.length > 0 && (
          <ul class="results">
            {results.map((a) => (
              <li key={a.ident}>
                <button type="button" onClick={() => pick(a.ident)}>
                  <strong>{a.ident}</strong> {a.name}
                  {procedures?.has(a.ident) && <span class="ins-tag">Approaches</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {ready && (
          <div class="field-row ins-proc">
            <label class="field">
              <span>Approach</span>
              <select
                value={approach.id}
                onChange={(e) => {
                  setApproachId((e.currentTarget as HTMLSelectElement).value);
                  setTransition(FIRST);
                }}
              >
                {approaches.map((a) => (
                  <option key={a.id} value={a.id}>
                    {shortApproachName(a)}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Transition</span>
              <select value={trans ?? ''} onChange={(e) => setTransition((e.currentTarget as HTMLSelectElement).value)}>
                {transitions.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
                <option value="">Vectors to final</option>
              </select>
            </label>
          </div>
        )}
        {ready && <p class="sim-ap-note">{approach.name}{approach.minima.length > 0 && `: ${approach.minima.join(', ')}`}.</p>}
      </div>

      <div class="ins-col ins-area-start">
        {!procedures ? (
          <p class="ins-empty">This build has no instrument procedure database yet, so there are no approaches to start from.</p>
        ) : !procedures.has(airportId) ? (
          <p class="ins-empty">{airportId} has no instrument approaches in the database. Try another airport.</p>
        ) : procs === undefined ? (
          <p class="ins-empty">Loading the procedures for {airportId}…</p>
        ) : !approach ? (
          <p class="ins-empty">{airportId} has no instrument approaches in the database.</p>
        ) : (
          <>
            <fieldset class="ins-starts">
              <legend>Start</legend>
              {starts.map((s) => (
                <label key={s.kind} class={`ins-radio${startKind === s.kind ? ' is-checked' : ''}`}>
                  <input type="radio" name="scn-start" checked={startKind === s.kind} onChange={() => setKind(s.kind)} />
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {startKind === 'hold' && hold && (
              <div class="ins-hold">
                {holds.length > 1 && (
                  <label class="ins-inline">
                    <span>Hold</span>
                    <select value={holdAt} onChange={(e) => setHoldIndex(Number((e.currentTarget as HTMLSelectElement).value))}>
                      {holds.map((h, i) => (
                        <option key={h.label} value={i}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p class="sim-ap-note">
                  {hold.label}: inbound {formatBearing(hold.inboundCourseMag)}, {hold.turn === 'R' ? 'right' : 'left'} turns, {holdLegText(hold)}
                  {hold.altitudeFt !== null && `, ${formatAltitude(hold.altitudeFt)} ft`}. Entered as a hold at the fix.
                </p>
                <div class="ins-field">
                  <span>Arrive for a</span>
                  <Segmented small label="Hold entry" options={ENTRIES} value={entry} onChange={setEntry} />
                  <span>entry</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {ready && (
        <div class="ins-col ins-area-go">
          <div class="ins-options">
            <label class="ins-check">
              <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot((e.currentTarget as HTMLInputElement).checked)} />
              <span>Engage the autopilot</span>
            </label>
            <label class="ins-inline">
              <span>Approach</span>
              <select value={load} disabled={startKind === 'hold'} onChange={(e) => setLoad((e.currentTarget as HTMLSelectElement).value as ApproachLoad)}>
                <option value="activate">Load and activate</option>
                <option value="load">Load only</option>
                <option value="none">The pilot loads it</option>
              </select>
            </label>
          </div>

          {plan && 'error' in plan ? (
            <p class="ins-empty">{plan.error}</p>
          ) : (
            plan && (
              <p class="ins-preview">
                {plan.summary}
                {usesLocalizer(approach) && plan.notes.length === 0 && startKind !== 'hold' && ` NAV1 tuned to ${approach.localizer}.`}
              </p>
            )
          )}
          <div class="form-actions">
            <button
              type="button"
              class="pill-btn pill-primary"
              disabled={!plan || 'error' in plan}
              onClick={() => {
                if (!plan || 'error' in plan) return;
                for (const cmd of plan.commands) sim.dispatch(cmd);
                setStarted({ summary: plan.summary, notes: plan.notes });
              }}
            >
              Start scenario
            </button>
          </div>
          {started && (
            <div class="ins-started" role="status">
              <strong>Started.</strong> {started.summary}
              {started.notes.map((n) => (
                <p key={n} class="sim-ap-note">
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Airports matching the search, the ones with approaches first. */
function airportResults(db: NavDatabase, query: string, hasProcs: (ident: string) => boolean): Airport[] {
  const seen = new Set<string>();
  const out: Airport[] = [];
  for (const w of [...db.search(query, 12), ...db.searchByName(query, 12)]) {
    if (w.kind !== 'airport' || seen.has(w.ident)) continue;
    const a = db.airport(w.ident);
    if (!a) continue;
    seen.add(a.ident);
    out.push(a);
  }
  return out.sort((a, b) => Number(hasProcs(b.ident)) - Number(hasProcs(a.ident))).slice(0, 8);
}
