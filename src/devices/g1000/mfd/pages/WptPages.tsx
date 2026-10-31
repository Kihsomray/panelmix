import { formatCom, formatNav } from '../../../../core/frequency';
import { formatLat, formatLon } from '../../../../core/geo';
import { NavDatabase, type Airport, type Navaid } from '../../../../core/navdb';
import { formatBearing, formatDistance } from '../../../../ui/format';
import type { IdentEntry } from '../../../../ui/identEntry';
import { Field, Group, Win } from '../../screen/Frames';
import { IdentField, WaypointSymbol } from '../../screen/WaypointBits';
import { FREQ_NAMES, SURFACE_NAMES } from '../../shared/nearest';
import { PANEL, SPLIT_MAP } from '../layout';
import type { WptState } from '../mfdState';
import { PageMap, type MapBase } from './MapPages';

/*
 * WPT group: Airport Information (identifier, runways, frequencies; ENT on a
 * frequency loads it), VOR and NDB Information, and the Intersection and
 * User Waypoint pages, which have nothing to show in the trainer database.
 */

const NAV_FREQ = (khz: number) => khz >= 108000 && khz < 118000;

/** COM frequencies load into the COM standby, VOR and localizer ones into the NAV standby. */
export function frequencyLabel(khz: number): string {
  return NAV_FREQ(khz) ? formatNav(khz) : formatCom(khz);
}

function IdentRow({ entry, ident, cursor, kind, towered, extra }: { entry: IdentEntry | null; ident: string; cursor: boolean; kind: 'airport' | 'vor' | 'ndb'; towered: boolean; extra?: string }) {
  return (
    <div class="g1000-row">
      {entry ? <IdentField entry={entry} editing cursor /> : <Field on={cursor} class="g1000-ident">{ident || '____'}</Field>}
      <WaypointSymbol kind={kind} towered={towered} />
      {extra && <span>{extra}</span>}
    </div>
  );
}

export function AirportInfoPage({
  base,
  airport,
  wpt,
  directory,
}: {
  base: MapBase;
  airport: Airport | undefined;
  wpt: WptState;
  directory: boolean;
}) {
  const rwy = airport?.runways[wpt.runway] ?? airport?.runways[0];
  const procTitle = wpt.proc === 'dp' ? 'DEPARTURE INFORMATION' : wpt.proc === 'star' ? 'ARRIVAL INFORMATION' : wpt.proc === 'apr' ? 'APPROACH INFORMATION' : null;
  return (
    <>
      {airport && <PageMap base={{ ...base, orientation: 'north' }} rect={SPLIT_MAP} center={airport} highlight={NavDatabase.toWaypoint(airport)} />}
      <Win rect={PANEL} class="g1000-panel">
        <Group title="AIRPORT">
          <IdentRow entry={wpt.entry} ident={airport?.ident ?? ''} cursor={wpt.cursor === 'ident'} kind="airport" towered={airport?.towered ?? false} />
          <div class="g1000-row g1000-wpname">{airport?.name.toUpperCase() ?? ''}</div>
          <div class="g1000-row">{airport ? `${airport.city} ${airport.state}`.toUpperCase() : ''}</div>
          {airport && (
            <div class="g1000-row g1000-split">
              <span>
                {formatLat(airport.lat)} {formatLon(airport.lon)}
              </span>
              <span>
                {airport.elevationFt}
                <small class="g1000-unit">FT</small>
              </span>
            </div>
          )}
        </Group>
        {procTitle ? (
          <Group title={procTitle}>
            <div class="g1000-honest">No {wpt.proc === 'dp' ? 'departures' : wpt.proc === 'star' ? 'arrivals' : 'approaches'} for this airport in the trainer database.</div>
          </Group>
        ) : directory ? (
          <Group title="AIRPORT DIRECTORY">
            <div class="g1000-honest">Airport directory data is not in the trainer database.</div>
          </Group>
        ) : (
          <>
            <Group title="RUNWAYS">
              {rwy ? (
                <>
                  <div class="g1000-row g1000-split">
                    <Field on={wpt.cursor === 'runway'}>
                      <span class="g1000-tri">◂</span>
                      {rwy.name.replace('/', '-')}
                      <span class="g1000-tri">▸</span>
                    </Field>
                    <span>{SURFACE_NAMES[rwy.surface]}</span>
                  </div>
                  <div class="g1000-row g1000-split">
                    <span>
                      {rwy.lengthFt}
                      <small class="g1000-unit">FT</small> x {rwy.widthFt}
                      <small class="g1000-unit">FT</small>
                    </span>
                    <span>{rwy.lighted ? 'LIGHTED' : 'NO LIGHTS'}</span>
                  </div>
                </>
              ) : (
                <div class="g1000-row g1000-dim">No runway data</div>
              )}
            </Group>
            <Group title="FREQUENCIES" class="g1000-freqlist">
              {(airport?.frequencies ?? []).slice(0, 9).map((f, i) => (
                <div key={`${f.type}${f.khz}${i}`} class="g1000-row g1000-split">
                  <span>{FREQ_NAMES[f.type]}</span>
                  <Field on={wpt.cursor === 'freq' && wpt.freq === i} class="g1000-cyan">
                    {frequencyLabel(f.khz)}
                  </Field>
                </div>
              ))}
              {airport && airport.frequencies.length === 0 && <div class="g1000-row g1000-dim">No frequencies</div>}
            </Group>
          </>
        )}
      </Win>
    </>
  );
}

export function NavaidInfoPage({
  base,
  navaid,
  wpt,
  nearestAirport,
}: {
  base: MapBase;
  navaid: Navaid | undefined;
  wpt: WptState;
  nearestAirport: { ident: string; bearingMag: number; distanceNm: number } | null;
}) {
  const isVor = navaid?.kind !== 'ndb';
  const classText = navaid ? ({ HIGH: 'HIGH ALTITUDE', MEDIUM: 'LOW ALTITUDE', LOW: 'TERMINAL' } as Record<string, string>)[navaid.power] ?? navaid.power : '';
  const varText = navaid ? `${Math.abs(Math.round(navaid.magVar))}°${navaid.magVar >= 0 ? 'E' : 'W'}` : '';
  return (
    <>
      {navaid && <PageMap base={{ ...base, orientation: 'north' }} rect={SPLIT_MAP} center={navaid} highlight={NavDatabase.toWaypoint(navaid)} />}
      <Win rect={PANEL} class="g1000-panel">
        <Group title={isVor ? 'VOR' : 'NDB'}>
          <IdentRow entry={wpt.entry} ident={navaid?.ident ?? ''} cursor={wpt.cursor === 'ident'} kind={isVor ? 'vor' : 'ndb'} towered={false} extra={navaid?.type ?? ''} />
          <div class="g1000-row g1000-wpname">{navaid?.name.toUpperCase() ?? ''}</div>
          <div class="g1000-row g1000-split">
            <span>{classText}</span>
            <span>{varText}</span>
          </div>
          {navaid && (
            <div class="g1000-row">
              {formatLat(navaid.lat)} {formatLon(navaid.lon)}
            </div>
          )}
        </Group>
        <Group title="FREQUENCY">
          <div class="g1000-row">
            <Field on={wpt.cursor === 'freq'} class="g1000-cyan">
              {navaid ? (isVor ? formatNav(navaid.freqKhz) : String(navaid.freqKhz)) : '___.__'}
            </Field>
            {navaid?.hasDme && <span>DME</span>}
          </div>
        </Group>
        <Group title="NEAREST AIRPORT">
          {nearestAirport ? (
            <div class="g1000-row g1000-split">
              <span class="g1000-cyan">{nearestAirport.ident}</span>
              <span>{formatBearing(nearestAirport.bearingMag)}</span>
              <span>
                {formatDistance(nearestAirport.distanceNm)}
                <small class="g1000-unit">NM</small>
              </span>
            </div>
          ) : (
            <div class="g1000-row g1000-dim">NONE WITHIN 200NM</div>
          )}
        </Group>
      </Win>
    </>
  );
}

/** A page whose data the trainer database does not have: the frame plus an honest note. */
export function NoDataPage({ base, title, message }: { base: MapBase; title: string; message: string }) {
  return (
    <>
      <PageMap base={base} rect={SPLIT_MAP} />
      <Win rect={PANEL} class="g1000-panel">
        <Group title={title}>
          <div class="g1000-honest">{message}</div>
        </Group>
      </Win>
    </>
  );
}
