import type { Derived } from '../../../sim/simulator';
import type { SimState } from '../../../sim/types';
import type { Lcd } from '../layout';
import type { Annunciations, BoxAnnun } from '../model/annunciations';
import { tuningTarget, volumeReadout } from '../model/radios';
import type { GnsUi, Model } from '../model/types';
import { at, brg, DataBox, dis, T, Unit } from './kit';

/*
 * The left column of the screen: COM and VLOC windows (active white above
 * standby cyan, the tuning cursor in inverse cyan), the 530W's VOR/LOC
 * readout, and the three annunciator boxes (terrain, CDI scale or approach
 * service level, integrity).
 */

interface FreqMetrics {
  readonly comH: number;
  readonly vlocY: number;
  readonly vlocH: number;
  readonly label: number;
  readonly big: number;
  readonly activeDy: number;
  readonly standbyDy: number;
  /** The 530W's VOR/LOC box. */
  readonly vor: { readonly y: number; readonly h: number } | null;
  readonly annunY: number;
  readonly annunH: number;
}

const METRICS: Record<Model, FreqMetrics> = {
  '430': { comH: 44, vlocY: 45, vlocH: 42, label: 8.5, big: 16.5, activeDy: 9.5, standbyDy: 26, vor: null, annunY: 88, annunH: 11 },
  '530': { comH: 53, vlocY: 55, vlocH: 53, label: 10, big: 20, activeDy: 11.5, standbyDy: 31.5, vor: { y: 110, h: 60 }, annunY: 172, annunH: 16 },
};

/** "127.650" with the digits after the point a little smaller, as on the unit. */
function Freq({ khz, nav }: { khz: number; nav: boolean }) {
  const text = (khz / 1000).toFixed(nav ? 2 : 3);
  const [mhz, frac] = text.split('.');
  return (
    <>
      {mhz}
      <small>.{frac}</small>
    </>
  );
}

function Window({
  y,
  h,
  w,
  m,
  label,
  flag,
  active,
  standby,
  nav,
  cursor,
  volume,
}: {
  y: number;
  h: number;
  w: number;
  m: FreqMetrics;
  label: string;
  flag: string | null;
  active: number;
  standby: number;
  nav: boolean;
  cursor: boolean;
  volume: number | null;
}) {
  return (
    <div class="gns-panel" style={at(0, y, w, h)}>
      {volume === null ? (
        <>
          <div class="gns-t is-bold" style={{ ...at(3, 2), fontSize: `${m.label}px`, color: 'var(--gns-freq-label)' }}>
            {label}
          </div>
          {flag && <T x={w - 3 - m.label * 1.3} y={2} size={m.label * 0.9} color="white" bold>{flag}</T>}
        </>
      ) : (
        <>
          <T x={3} y={2} size={m.label} color="white" bold>
            VOL
          </T>
          <div class="gns-vol-bar" style={at(m.label * 2.2, m.label * 0.45, w - m.label * 2.2 - 4)}>
            <i style={{ width: `${volume}%` }} />
          </div>
        </>
      )}
      <div class="gns-freq-active" style={{ top: `${m.activeDy}px`, fontSize: `${m.big}px` }}>
        <Freq khz={active} nav={nav} />
      </div>
      <div class={`gns-freq-standby${cursor ? ' is-cursor' : ''}`} style={{ top: `${m.standbyDy}px`, fontSize: `${m.big}px` }}>
        <Freq khz={standby} nav={nav} />
      </div>
    </div>
  );
}

/** The 530W's readout of the tuned VOR: identifier, radial and DME distance. */
function VorBox({ w, m, derived }: { w: number; m: FreqMetrics; derived: Derived }) {
  const v = derived.vor[0];
  const box = m.vor!;
  const s = m.label;
  return (
    <div class="gns-panel" style={at(0, box.y, w, box.h)}>
      <T x={3} y={4} size={s} color="cyan" bold>
        {v.isLocalizer ? 'LOC' : 'VOR'}
      </T>
      <T x={0} y={2} w={w - 4} size={s * 1.45} color="white" align="right">
        {v.station?.ident ?? '___'}
      </T>
      <T x={3} y={23} size={s * 0.9} color="cyan">
        RAD
      </T>
      <T x={0} y={20} w={w - 4} size={s * 1.45} color="white" align="right">
        {brg(v.radialMag)}°
      </T>
      <div class="gns-line" style={at(3, 37, w - 6, 1)} />
      <T x={3} y={45} size={s * 0.9} color="cyan">
        DIS
      </T>
      <T x={0} y={40} w={w - 4} size={s * 1.45} color="white" align="right">
        {dis(v.dmeNm)}
        <Unit u="nm" />
      </T>
    </div>
  );
}

/** One of the three annunciator boxes under the frequency windows. */
function AnnunBox({ y, w, h, size, a }: { y: number; w: number; h: number; size: number; a: BoxAnnun | null }) {
  return (
    <DataBox x={0} y={y} w={w} h={h}>
      {a && (
        <div class={`gns-annun-box is-${a.style}`} style={{ fontSize: `${size}px`, lineHeight: `${h - 2}px` }}>
          {a.text}
        </div>
      )}
    </DataBox>
  );
}

export function FreqColumn({ ui, state, derived, lcd, now, annun }: { ui: GnsUi; state: SimState; derived: Derived; lcd: Lcd; now: number; annun: Annunciations }) {
  const m = METRICS[ui.model];
  const w = lcd.freqW;
  const target = tuningTarget(ui.radio, now);
  const vol = volumeReadout(ui.radio, now);
  const com = state.radios.com[0];
  const nav = state.radios.nav[0];
  const boxH = m.annunH;
  const size = m.label * 1.12;
  return (
    <>
      <Window
        y={0}
        h={m.comH}
        w={w}
        m={m}
        label="COM"
        flag={ui.radio.squelchOff ? 'RX' : null}
        active={com.activeKhz}
        standby={com.standbyKhz}
        nav={false}
        cursor={target === 'COM'}
        volume={vol?.knob === 'com' ? vol.percent : null}
      />
      <Window
        y={m.vlocY}
        h={m.vlocH}
        w={w}
        m={m}
        label="VLOC"
        flag={state.radios.navIdent[0] ? 'ID' : null}
        active={nav.activeKhz}
        standby={nav.standbyKhz}
        nav
        cursor={target === 'VLOC'}
        volume={vol?.knob === 'vloc' ? vol.percent : null}
      />
      {m.vor && <VorBox w={w} m={m} derived={derived} />}
      <AnnunBox y={m.annunY} w={w} h={boxH} size={size} a={annun.terrain} />
      <AnnunBox y={m.annunY + boxH} w={w} h={boxH} size={size} a={annun.mode} />
      <AnnunBox y={m.annunY + boxH * 2} w={w} h={boxH} size={size} a={annun.integ} />
    </>
  );
}
