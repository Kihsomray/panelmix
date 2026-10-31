import type { GpsSolution } from '../../../sim/fms';
import type { TransponderState } from '../../../sim/types';
import { formatBearing, formatDistance } from '../../../ui/format';
import type { AfcsAnnunciation } from '../shared/afcs';

/*
 * Status strips of the PFD: the navigation status box and the AFCS status
 * box in the top band, and the OAT and transponder boxes along the bottom.
 */

function DirectToSymbol() {
  return (
    <svg viewBox="0 0 30 14" width="24" height="11" class="g1000-inline-glyph" aria-hidden="true">
      <path d="M8 1.5 h5 a5.5 5.5 0 0 1 0 11 h-5 Z" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path d="M1 7 H22 M20 3.5 L27 7 L20 10.5 Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" />
    </svg>
  );
}

/** Active leg ("KJYO ➔ MRB", or the direct-to symbol and waypoint), distance and bearing. */
export function NavStatus({ gps }: { gps: GpsSolution }) {
  return (
    <div class="g1000-navstatus">
      <div class="g1000-ns-leg">
        {gps.active && gps.to && (
          <>
            {gps.isDirectTo ? <DirectToSymbol /> : <span>{gps.from?.ident ?? ''}</span>}
            {!gps.isDirectTo && <span class="g1000-leg-arrow">➔</span>}
            <span>{gps.to.ident}</span>
          </>
        )}
      </div>
      <div class="g1000-ns-data">
        <span class="g1000-lbl">DIS</span>
        <span class="g1000-mag">{gps.active ? formatDistance(gps.distanceNm) : '__._'}</span>
        <small class="g1000-unit g1000-mag">NM</small>
        <span class="g1000-lbl">BRG</span>
        <span class="g1000-mag">{gps.active ? formatBearing(gps.bearingMag) : '___°'}</span>
      </div>
    </div>
  );
}

export interface AfcsBoxProps {
  /** GFC 700 installed; without it the box stays empty. */
  readonly installed: boolean;
  readonly modes: AfcsAnnunciation | null;
  readonly apEngaged: boolean;
  /** Autopilot just disengaged: AP flashes yellow for five seconds. */
  readonly apDisconnect: boolean;
  /** Modes that just became active from armed: they flash for ten seconds. */
  readonly flashLateral: boolean;
  readonly flashVertical: boolean;
  /** Mode key pressed that the trainer cannot provide. */
  readonly unavailable: string | null;
  readonly blink: boolean;
}

export function AfcsBox(p: AfcsBoxProps) {
  const m = p.installed ? p.modes : null;
  const lateralUnavailable = p.unavailable === 'APR' || p.unavailable === 'BC';
  const verticalUnavailable = p.unavailable !== null && !lateralUnavailable;
  return (
    <div class="g1000-afcs">
      <div class="g1000-afcs-cell g1000-afcs-lat">
        <span class="g1000-armed">{lateralUnavailable && p.blink ? <b class="g1000-afcs-fail">{p.unavailable}</b> : m?.lateralArmed}</span>
        <span class={`g1000-active${p.flashLateral && !p.blink ? ' is-hidden' : ''}`}>{m?.lateralActive}</span>
      </div>
      <div class="g1000-afcs-cell g1000-afcs-ap">
        {p.installed && p.apEngaged && <span class="g1000-active">AP</span>}
        {p.installed && !p.apEngaged && p.apDisconnect && <span class={p.blink ? 'g1000-afcs-disc' : 'g1000-afcs-disc is-dim'}>AP</span>}
      </div>
      <div class="g1000-afcs-cell g1000-afcs-vert">
        <span class={`g1000-active${p.flashVertical && !p.blink ? ' is-hidden' : ''}`}>{m?.verticalActive}</span>
        <span class="g1000-active g1000-ref">{m?.verticalRef}</span>
        <span class="g1000-armed">{verticalUnavailable && p.blink ? <b class="g1000-afcs-fail">{p.unavailable}</b> : m?.verticalArmed}</span>
      </div>
    </div>
  );
}

export function OatBox({ oatC, isaDevC }: { oatC: number; isaDevC: number }) {
  const sign = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(Math.round(v))}`;
  return (
    <div class="g1000-oat">
      <div>
        <span class="g1000-lbl">OAT</span>
        <span>
          {Math.round(oatC)}
          <small class="g1000-unit">°C</small>
        </span>
      </div>
      <div>
        <span class="g1000-lbl">ISA</span>
        <span>
          {sign(isaDevC)}
          <small class="g1000-unit">°C</small>
        </span>
      </div>
    </div>
  );
}

export interface XpdrBoxProps {
  readonly xpdr: TransponderState;
  readonly simTime: number;
  /** Code being entered (digits and dashes), shown in cyan instead of the active code. */
  readonly entering: string | null;
  /** Reply light: on while the transponder answers an interrogation. */
  readonly reply: boolean;
  readonly clock: string;
}

export function XpdrBox({ xpdr, simTime, entering, reply, clock }: XpdrBoxProps) {
  const identing = xpdr.identUntil !== null && simTime < xpdr.identUntil;
  const replying = xpdr.mode === 'ON' || xpdr.mode === 'ALT';
  const mode = identing ? 'IDNT' : xpdr.mode;
  const green = replying || identing;
  return (
    <div class="g1000-xpdr">
      <span class="g1000-lbl">XPDR</span>
      <span class={entering ? 'g1000-cyan' : green ? 'g1000-green' : ''}>{entering ?? xpdr.code}</span>
      <span class={green ? 'g1000-green' : ''}>{mode}</span>
      <span class="g1000-xpdr-r">{replying && reply ? 'R' : ''}</span>
      <span class="g1000-lbl g1000-lcl">LCL</span>
      <span class="g1000-clock">{clock}</span>
    </div>
  );
}
