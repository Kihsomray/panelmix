import { formatNav } from '../../../../core/frequency';
import { NavDatabase, type Airport, type AirportFrequency, type Navaid } from '../../../../core/navdb';
import { formatBearing, formatDistance } from '../../../../ui/format';
import { Field, Group, Win } from '../../screen/Frames';
import { WaypointSymbol } from '../../screen/WaypointBits';
import { FREQ_NAMES, SURFACE_NAMES } from '../../shared/nearest';
import { PANEL, SPLIT_MAP } from '../layout';
import type { NrstState } from '../mfdState';
import { PageMap, type MapBase } from './MapPages';
import { frequencyLabel } from './WptPages';

/*
 * NRST group: Nearest Airports (list, information, runways, frequencies,
 * approaches), Nearest VOR and NDB (list, information, frequency) and
 * Nearest Frequencies (center, FSS and weather frequencies of the airports
 * around). The APT/VOR, RNWY and FREQ softkeys move the cursor into a box;
 * ENT on a frequency loads it into the standby with the tuning box.
 */

export interface NearRow<T> {
  readonly item: T;
  readonly bearingMag: number;
  readonly distanceNm: number;
}

const LIST_ROWS = 5;

function listWindow(count: number, selected: number | null, rows: number): number {
  if (selected === null) return 0;
  return Math.min(Math.max(selected - rows + 1, 0), Math.max(count - rows, 0), selected);
}

function NearList<T extends Airport | Navaid>({ rows, n, visible }: { rows: readonly NearRow<T>[]; n: NrstState; visible: number }) {
  const first = listWindow(rows.length, n.item, visible);
  return (
    <>
      {rows.length === 0 && <div class="g1000-row g1000-dim">NONE WITHIN 200NM</div>}
      {rows.slice(first, first + visible).map((r, i) => {
        const index = first + i;
        const selected = n.item === index;
        const w = r.item;
        return (
          <div key={w.ident + index} class="g1000-row g1000-nearrow">
            <span class="g1000-nr-arrow">{selected ? '➔' : ''}</span>
            <Field on={selected && n.section === 'list'} class="g1000-nr-id">
              {w.ident}
            </Field>
            <WaypointSymbol kind={w.kind} towered={'towered' in w && w.towered} />
            <span class="g1000-nr-brg">{formatBearing(r.bearingMag)}</span>
            <span class="g1000-nr-dis">
              {formatDistance(r.distanceNm)}
              <small class="g1000-unit">NM</small>
            </span>
          </div>
        );
      })}
    </>
  );
}

function FreqRows({ freqs, n }: { freqs: readonly AirportFrequency[]; n: NrstState }) {
  return (
    <>
      {freqs.length === 0 && <div class="g1000-row g1000-dim">No frequencies</div>}
      {freqs.slice(0, 6).map((f, i) => (
        <div key={`${f.type}${f.khz}${i}`} class="g1000-row g1000-split">
          <span>{FREQ_NAMES[f.type]}</span>
          <Field on={n.section === 'freq' && n.freq === i} class="g1000-cyan">
            {frequencyLabel(f.khz)}
          </Field>
        </div>
      ))}
    </>
  );
}

export function NearestAirportsPage({ base, rows, n }: { base: MapBase; rows: readonly NearRow<Airport>[]; n: NrstState }) {
  const a = n.item !== null ? rows[n.item]?.item : rows[0]?.item;
  const rwy = a?.runways[n.runway] ?? a?.runways[0];
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} highlight={a ? NavDatabase.toWaypoint(a) : null} />
      <Win rect={PANEL} class="g1000-panel">
        <Group title="NEAREST AIRPORTS">
          <NearList rows={rows} n={n} visible={LIST_ROWS} />
        </Group>
        <Group title="INFORMATION">
          <div class="g1000-row g1000-wpname">{a?.name.toUpperCase() ?? ''}</div>
          <div class="g1000-row g1000-split">
            <span>{a ? `${a.city} ${a.state}`.toUpperCase() : ''}</span>
            {a && (
              <span>
                {a.elevationFt}
                <small class="g1000-unit">FT</small>
              </span>
            )}
          </div>
        </Group>
        <Group title="RUNWAYS">
          {rwy && (
            <>
              <div class="g1000-row g1000-split">
                <Field on={n.section === 'runway'}>
                  <span class="g1000-tri">◂</span>
                  {rwy.name.replace('/', '-')}
                  <span class="g1000-tri">▸</span>
                </Field>
                <span>{SURFACE_NAMES[rwy.surface]}</span>
              </div>
              <div class="g1000-row">
                {rwy.lengthFt}
                <small class="g1000-unit">FT</small> x {rwy.widthFt}
                <small class="g1000-unit">FT</small>
              </div>
            </>
          )}
        </Group>
        <Group title="FREQUENCIES" class="g1000-freqlist">
          <FreqRows freqs={a?.frequencies ?? []} n={n} />
        </Group>
        <Group title="APPROACHES">
          <div class="g1000-row g1000-dim">None in the trainer database</div>
        </Group>
      </Win>
    </>
  );
}

export function NearestNavaidsPage({ base, rows, n, kind }: { base: MapBase; rows: readonly NearRow<Navaid>[]; n: NrstState; kind: 'vor' | 'ndb' }) {
  const v = n.item !== null ? rows[n.item]?.item : rows[0]?.item;
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} highlight={v ? NavDatabase.toWaypoint(v) : null} />
      <Win rect={PANEL} class="g1000-panel">
        <Group title={kind === 'vor' ? 'NEAREST VOR' : 'NEAREST NDB'}>
          <NearList rows={rows} n={n} visible={10} />
        </Group>
        <Group title="INFORMATION">
          <div class="g1000-row g1000-wpname">{v?.name.toUpperCase() ?? ''}</div>
          <div class="g1000-row g1000-split">
            <span>{v?.type ?? ''}</span>
            <span>{v ? `${Math.abs(Math.round(v.magVar))}°${v.magVar >= 0 ? 'E' : 'W'}` : ''}</span>
          </div>
        </Group>
        <Group title="FREQUENCY">
          <div class="g1000-row">
            <Field on={n.section === 'freq'} class="g1000-cyan">
              {v ? (kind === 'vor' ? formatNav(v.freqKhz) : String(v.freqKhz)) : ''}
            </Field>
          </div>
        </Group>
      </Win>
    </>
  );
}

export interface FreqEntry {
  readonly ident: string;
  readonly label: string;
  readonly khz: number;
  readonly distanceNm: number;
}

export function NearestFrequenciesPage({ base, groups, n }: { base: MapBase; groups: readonly { title: string; items: readonly FreqEntry[] }[]; n: NrstState }) {
  let index = 0;
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} />
      <Win rect={PANEL} class="g1000-panel">
        {groups.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.items.length === 0 && <div class="g1000-row g1000-dim">NONE WITHIN 200NM</div>}
            {g.items.map((f) => {
              const i = index++;
              return (
                <div key={`${f.ident}${f.khz}${i}`} class="g1000-row g1000-split">
                  <span class="g1000-nr-id">{f.ident}</span>
                  <span>{f.label}</span>
                  <Field on={n.item === i} class="g1000-cyan">
                    {frequencyLabel(f.khz)}
                  </Field>
                </div>
              );
            })}
          </Group>
        ))}
      </Win>
    </>
  );
}
