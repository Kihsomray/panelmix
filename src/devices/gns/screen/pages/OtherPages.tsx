import type { ComponentChildren } from 'preact';
import { formatEte } from '../../../../ui/format';
import { distanceNm, bearing } from '../../../../core/geo';
import { AUX_ITEMS, AUX_TITLE, CRITERIA_STOP, CRITERIA_SURFACE_LABEL, TIMER_STOP, timerSeconds, type AuxPage } from '../../model/aux';
import { PROC_OPTIONS, VNAV_STOP } from '../../model/navPages';
import type { AuxSub } from '../../model/types';
import { brg, clock, DataBox, dis, hms, NotInDb, speed, T, Title, V, type PageProps } from '../kit';
import { FS } from '../parts';

/*
 * MSG, PROC and VNAV pages and the AUX group.
 */

export function MsgPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const msgs = [...p.state.messages].reverse();
  const lineH = fs.row * 1.35;
  const max = Math.floor((main.h - fs.title - 8) / lineH);
  return (
    <>
      <Title w={main.w} size={fs.title}>
        MESSAGES
      </Title>
      <DataBox x={2} y={fs.title + 4} w={main.w - 4} h={main.h - fs.title - 6}>
        {msgs.slice(0, max).map((m, i) => (
          <T key={m.id} x={4} y={3 + i * lineH} size={fs.row} color={m.level === 'caution' ? 'yellow' : 'green'}>
            {m.text}
          </T>
        ))}
      </DataBox>
    </>
  );
}

export function ProcPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const big = p.ui.model === '530';
  const rowH = fs.row * 1.38;
  const boxH = rowH * PROC_OPTIONS.length + 6;
  let stop = -1;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        PROCEDURES
      </Title>
      <DataBox x={2} y={fs.title + 4} w={main.w - 4} h={boxH}>
        {PROC_OPTIONS.map((o, i) => {
          if (o.enabled) stop++;
          return (
            <T key={o.label} x={4} y={3 + i * rowH} size={fs.row} color={o.enabled ? 'green' : 'dim'} sel={o.enabled && p.ui.cursor === stop && !p.ui.popup}>
              {o.label}
            </T>
          );
        })}
      </DataBox>
      {big && (
        <>
          <T x={0} y={fs.title + boxH + 10} w={main.w} size={fs.label} color="cyan" align="center" bold>
            LOADED PROCEDURES
          </T>
          <DataBox x={2} y={fs.title + boxH + fs.label + 13} w={main.w - 4} h={main.h - (fs.title + boxH + fs.label + 15)}>
            {['APR', 'ARVL', 'DEP'].map((k, i) => (
              <div key={k}>
                <T x={4} y={5 + i * rowH} size={fs.label} color="cyan" bold>
                  {k}
                </T>
                <T x={fs.label * 4} y={3 + i * rowH} size={fs.row}>
                  ____ -
                </T>
              </div>
            ))}
          </DataBox>
        </>
      )}
    </>
  );
}

/** Vertical speed required to reach the VNAV target, fpm, or null without a target ahead. */
function vsRequired(p: PageProps): { fpm: number | null; targetFt: number } {
  const g = p.derived.gps;
  const v = p.ui.vnav;
  const to = g.to;
  let elevation = 0;
  if (to && v.aboveWpt) {
    const rec = p.db.find(to.ident).find((w) => w.kind === to.kind);
    elevation = rec && 'elevationFt' in rec ? rec.elevationFt : 0;
  }
  const targetFt = v.altitudeFt + elevation;
  if (!g.active || g.distanceNm === null) return { fpm: null, targetFt };
  const along = g.distanceNm + (v.before ? -v.offsetNm : v.offsetNm);
  const gs = p.state.aircraft.groundSpeedKt;
  if (along <= 0.05 || gs < 30) return { fpm: null, targetFt };
  return { fpm: (targetFt - p.derived.indicatedAltitudeFt) / ((along / gs) * 60), targetFt };
}

export function VnavPage(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const v = p.ui.vnav;
  const sel = (s: number) => p.ui.cursor === s && !p.ui.popup;
  const ident = p.derived.gps.to?.ident ?? '_____';
  const { fpm } = vsRequired(p);
  const w = main.w - 4;
  const block = (main.h - fs.title - 6) / 3;
  const y0 = fs.title + 4;
  const fieldH = fs.row + 5;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        VERTICAL NAVIGATION
      </Title>
      <T x={4} y={y0} size={fs.label} color="cyan" bold>
        TARGET ALTITUDE
      </T>
      <DataBox x={2} y={y0 + fs.label + 2} w={w} h={fieldH}>
        <T x={4} y={2.5} size={fs.row} sel={sel(VNAV_STOP.altitude)}>
          <V v={String(v.altitudeFt)} u="ft" />
        </T>
        <T x={0} y={2.5} w={w - 4} size={fs.row} align="right" sel={sel(VNAV_STOP.reference)}>
          {v.aboveWpt ? 'Above Wpt' : 'MSL'}
        </T>
      </DataBox>
      <T x={4} y={y0 + block} size={fs.label} color="cyan" bold>
        TARGET POSITION
      </T>
      <DataBox x={2} y={y0 + block + fs.label + 2} w={w} h={fieldH}>
        <T x={4} y={2.5} size={fs.row} sel={sel(VNAV_STOP.offset)}>
          <V v={v.offsetNm.toFixed(1)} u="nm" />
        </T>
        <T x={w * 0.45} y={2.5} size={fs.row} sel={sel(VNAV_STOP.beforeAfter)}>
          {v.before ? 'Before' : 'After'}
        </T>
        <T x={0} y={2.5} w={w - 4} size={fs.row} align="right">
          {ident}
        </T>
      </DataBox>
      <T x={4} y={y0 + block * 2} size={fs.label} color="cyan" bold>
        VS PROFILE
      </T>
      <T x={w * 0.55} y={y0 + block * 2} size={fs.label} color="cyan" bold>
        VSR
      </T>
      <DataBox x={2} y={y0 + block * 2 + fs.label + 2} w={w * 0.45} h={fieldH}>
        <T x={0} y={2.5} w={w * 0.45 - 4} size={fs.row} align="right" sel={sel(VNAV_STOP.profile)}>
          <V v={String(v.profileFpm)} u="fpm" />
        </T>
      </DataBox>
      <DataBox x={2 + w * 0.55} y={y0 + block * 2 + fs.label + 2} w={w * 0.45} h={fieldH}>
        <T x={0} y={2.5} w={w * 0.45 - 4} size={fs.row} align="right">
          <V v={fpm === null ? '____' : String(Math.round(fpm / 10) * 10)} u="fpm" />
        </T>
      </DataBox>
    </>
  );
}

// AUX -----------------------------------------------------------------------------------

const SUB_TITLE: Record<AuxSub, string> = {
  fuel: 'FUEL PLANNING',
  trip: 'TRIP PLANNING',
  dalt: 'DENSITY ALT / TAS / WINDS',
  crossfill: 'CROSSFILL',
  scheduler: 'SCHEDULER',
  checklists: 'CHECKLISTS',
  timers: 'FLIGHT TIMERS',
  tripStats: 'TRIP STATISTICS',
  raim: 'RAIM PREDICTION',
  sun: 'SUNRISE / SUNSET',
  versions: 'SOFTWARE VERSIONS',
  airspace: 'AIRSPACE ALARMS',
  cdi: 'CDI / ALARMS',
  units: 'UNITS / MAG VAR',
  position: 'POSITION / MAP DATUM',
  datetime: 'DATE / TIME',
  display: 'DISPLAY',
  nearestApt: 'NEAREST AIRPORT CRITERIA',
  sbas: 'SBAS SELECTION',
  com: 'COM CONFIGURATION',
};

/** A label above a data box with one value. */
function Field({ p, x, y, w, label, children, sel = false }: { p: PageProps; x: number; y: number; w: number; label: string; children: ComponentChildren; sel?: boolean }) {
  const fs = FS[p.ui.model];
  return (
    <>
      <T x={x + 2} y={y} size={fs.label} color="cyan" bold>
        {label}
      </T>
      <DataBox x={x} y={y + fs.label + 2} w={w} h={fs.row + 5}>
        <T x={0} y={2.5} w={w - 4} size={fs.row} align="right" sel={sel}>
          {children}
        </T>
      </DataBox>
    </>
  );
}

function TimersSub(p: PageProps) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const t = p.ui.aux.timer;
  const sel = (s: number) => p.ui.cursor === s && !p.ui.popup;
  const w = main.w - 4;
  const y = fs.title + 5;
  const rowH = fs.label + fs.row + 11;
  return (
    <>
      <T x={4} y={y} size={fs.label} color="cyan" bold>
        GENERIC
      </T>
      <DataBox x={2} y={y + fs.label + 2} w={w} h={fs.row + 5}>
        <T x={4} y={2.5} size={fs.row} sel={sel(TIMER_STOP.direction)}>
          {t.up ? 'Up' : 'Down'}
        </T>
        <T x={w * 0.25} y={2.5} size={fs.row} sel={sel(TIMER_STOP.time)}>
          {hms(timerSeconds(t, p.state.time))}
        </T>
        <T x={0} y={2.5} w={w - 4} size={fs.row} align="right" color="white" sel={sel(TIMER_STOP.startStop)}>
          {t.running ? 'Stop?' : 'Start?'}
        </T>
      </DataBox>
      <Field p={p} x={2} y={y + rowH} w={w} label="DEPARTURE TIME">
        {clock(new Date(Date.now() - p.state.time * 1000))}
      </Field>
      <Field p={p} x={2} y={y + rowH * 2} w={w} label="TOTAL TRIP TIME  (Pwr-on)">
        {hms(p.state.time)}
      </Field>
    </>
  );
}

function CriteriaSub(p: PageProps) {
  const fs = FS[p.ui.model];
  const w = p.lcd.main.w - 4;
  const c = p.ui.aux.criteria;
  const sel = (s: number) => p.ui.cursor === s && !p.ui.popup;
  const y = fs.title + 8;
  return (
    <>
      <Field p={p} x={2} y={y} w={w} label="RUNWAY SURFACE" sel={sel(CRITERIA_STOP.surface)}>
        {CRITERIA_SURFACE_LABEL[c.surface]}
      </Field>
      <Field p={p} x={2} y={y + fs.label + fs.row + 14} w={w} label="MINIMUM LENGTH" sel={sel(CRITERIA_STOP.length)}>
        <V v={String(c.minLengthFt)} u="ft" />
      </Field>
    </>
  );
}

function TripSub(p: PageProps) {
  const fs = FS[p.ui.model];
  const w = p.lcd.main.w - 4;
  const plan = p.state.fms.plan;
  const legIndex = Math.min(p.ui.aux.tripLeg, Math.max(plan.length - 1, 0));
  const pairs = legIndex === 0 ? plan.slice(0, -1).map((w, i) => [w, plan[i + 1]!] as const) : [[plan[legIndex - 1]!, plan[legIndex]!] as const];
  const valid = plan.length >= 2;
  const total = valid ? pairs.reduce((s, [a, b]) => s + distanceNm(a, b), 0) : null;
  const first = pairs[0];
  const dtk = valid && first ? p.mag.toMagnetic(bearing(first[0], first[1]), first[0].lat, first[0].lon) : null;
  const gs = p.state.aircraft.groundSpeedKt;
  const ete = total !== null && gs > 30 ? (total / gs) * 3600 : null;
  const eta = ete !== null ? clock(new Date(Date.now() + ete * 1000)).slice(0, 5) : '__:__';
  const y = fs.title + 5;
  const half = w / 2 - 2;
  const step = fs.label + fs.row + 10;
  const legLabel = legIndex === 0 ? 'CUM' : `${plan[legIndex - 1]?.ident ?? ''}-${plan[legIndex]?.ident ?? ''}`;
  return (
    <>
      <Field p={p} x={2} y={y} w={half} label="FPL">
        00
      </Field>
      <Field p={p} x={half + 6} y={y} w={half} label="LEG" sel={p.ui.cursor === 0 && !p.ui.popup}>
        {valid ? legLabel : '_____'}
      </Field>
      <Field p={p} x={2} y={y + step} w={half} label="DTK">
        <V v={legIndex === 0 ? '___' : brg(dtk)} u="mag" />
      </Field>
      <Field p={p} x={half + 6} y={y + step} w={half} label="DIS">
        <V v={dis(total)} u="nm" />
      </Field>
      <Field p={p} x={2} y={y + step * 2} w={half} label="ETE">
        {formatEte(ete)}
      </Field>
      <Field p={p} x={half + 6} y={y + step * 2} w={half} label="ETA">
        {eta}
      </Field>
    </>
  );
}

function DaltSub(p: PageProps) {
  const fs = FS[p.ui.model];
  const w = p.lcd.main.w - 4;
  const a = p.state.aircraft;
  const env = p.state.env;
  const windMag = p.mag.toMagnetic(env.windFromTrue, a.lat, a.lon);
  const half = w / 2 - 2;
  const y = fs.title + 4;
  const step = fs.label + fs.row + 9;
  const rows: [string, ComponentChildren][] = [
    ['IND ALT', <V v={String(Math.round(p.derived.indicatedAltitudeFt))} u="ft" />],
    ['DEN ALT', <V v={String(Math.round(p.derived.densityAltitudeFt))} u="ft" />],
    ['CAS', <V v={speed(a.iasKt)} u="kt" />],
    ['TAS', <V v={speed(a.tasKt)} u="kt" />],
    ['HDG', <V v={brg(p.derived.headingMag)} u="mag" />],
    ['WIND', <>{`${brg(windMag)}°/${Math.round(env.windKt)}`}</>],
  ];
  return (
    <>
      {rows.map(([label, value], i) => (
        <Field key={label} p={p} x={i % 2 === 0 ? 2 : half + 6} y={y + Math.floor(i / 2) * step} w={half} label={label}>
          {value}
        </Field>
      ))}
    </>
  );
}

function InfoSub(p: PageProps & { lines: readonly string[] }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  return (
    <DataBox x={2} y={fs.title + 5} w={main.w - 4} h={main.h - fs.title - 7}>
      {p.lines.map((l, i) => (
        <T key={l} x={5} y={5 + i * fs.row * 1.35} size={fs.row}>
          {l}
        </T>
      ))}
    </DataBox>
  );
}

export function AuxPageView(p: PageProps & { page: AuxPage }) {
  const fs = FS[p.ui.model];
  const { main } = p.lcd;
  const sub = p.ui.aux.sub;
  if (sub) {
    let body;
    switch (sub) {
      case 'timers':
        body = <TimersSub {...p} />;
        break;
      case 'nearestApt':
        body = <CriteriaSub {...p} />;
        break;
      case 'trip':
        body = <TripSub {...p} />;
        break;
      case 'dalt':
        body = <DaltSub {...p} />;
        break;
      case 'versions':
        body = <InfoSub {...p} lines={['PanelMix trainer', `Nav database ${p.db.built.slice(0, 10)}`, `${p.db.airports.length} airports`, `${p.db.navaids.length} navaids`]} />;
        break;
      case 'cdi':
        body = <InfoSub {...p} lines={['Selected CDI  Auto', `System CDI  ${p.derived.gps.scale}  ${p.derived.gps.fullScaleNm.toFixed(1)} nm`, 'Arrival alarm  Off']} />;
        break;
      default:
        body = (
          <NotInDb x={2} y={fs.title + 5} w={main.w - 4} h={main.h - fs.title - 7} size={fs.label + 1} lines={['Not available in the trainer']} />
        );
    }
    return (
      <>
        <Title w={main.w} size={fs.title}>
          {SUB_TITLE[sub]}
        </Title>
        {body}
      </>
    );
  }
  const items = AUX_ITEMS[p.page];
  const rowH = fs.row * 1.4;
  return (
    <>
      <Title w={main.w} size={fs.title}>
        {AUX_TITLE[p.page]}
      </Title>
      <DataBox x={2} y={fs.title + 4} w={main.w - 4} h={main.h - fs.title - 6}>
        {items.map((it, i) => (
          <T key={it.label} x={5} y={3 + i * rowH} size={fs.row} sel={p.ui.cursor === i && !p.ui.popup}>
            {it.label}
          </T>
        ))}
      </DataBox>
    </>
  );
}
