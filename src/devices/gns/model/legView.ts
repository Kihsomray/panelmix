import type { GpsSolution } from '../../../sim/fms';
import type { FmsState, RouteLeg, SimState } from '../../../sim/types';
import { legName, ROLE_TAG } from './fpl';

/*
 * The active leg as the default NAV page (and the 530W map page) shows it,
 * from the guide's screen captures: "KJYO -> MRB", the direct-to glyph and
 * the waypoint, "LYH FA -> RW04 MA" with magenta designators, a hold as its
 * timer, the racetrack and the fix ("00:05 [hold] SWARM"), a procedure turn
 * ("SHUTR IA -> [PT]", then "[PT] -> CF21"), a DME arc
 * ("LEBVY IA [arc] DMARY"), vectors to final ("VTF -> DANMO FA") and legs
 * without a fix by their label ("RW02 -> man seq", "RW17 -> 1100ft").
 */

export interface LegEnd {
  readonly ident: string;
  /** Waypoint designator: IA, FA, MA, MH. */
  readonly tag?: string;
}

export type LegView =
  | { readonly kind: 'none' }
  | { readonly kind: 'direct'; readonly to: LegEnd }
  | { readonly kind: 'obs'; readonly to: LegEnd }
  | { readonly kind: 'leg'; readonly from: LegEnd; readonly to: LegEnd; readonly arc: boolean }
  | { readonly kind: 'hold'; readonly to: LegEnd; readonly timer: string }
  /** Procedure turn: outbound from the fix, or the turn back toward the next fix. */
  | { readonly kind: 'pt'; readonly from: LegEnd | null; readonly to: LegEnd | null };

const HOLDS = new Set(['HM', 'HA', 'HF']);

/** The designator of an approach fix: the role of the leg that arrives at it. */
function tagged(fms: FmsState, ident: string): LegEnd {
  const leg = fms.approach?.legs.find((l) => l.to?.ident === ident && l.role !== undefined && ROLE_TAG[l.role]);
  const tag = leg?.role ? ROLE_TAG[leg.role] : undefined;
  return tag ? { ident, tag } : { ident };
}

const mmss = (seconds: number) => {
  const s = Math.max(Math.floor(seconds), 0);
  return `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function legView(state: SimState, gps: GpsSolution): LegView {
  const fms = state.fms;
  const leg = fms.activeLeg;
  if (!gps.active || !gps.to || !leg) return { kind: 'none' };
  const a = fms.approach;
  const index = leg.approachIndex;
  const r: RouteLeg | undefined = a && index !== null && index !== undefined ? a.legs[index] : undefined;
  const h = fms.hold;

  // In the hold: the timer restarts abeam the fix outbound and again turning inbound.
  if (h && h.entryStep !== 'toFix' && h.fix.ident === leg.to.ident) {
    const timing = h.phase === 'outbound' || h.phase === 'inbound' || h.phase === 'turnInbound';
    return { kind: 'hold', to: tagged(fms, h.fix.ident), timer: mmss(timing ? state.time - h.phaseStartedAt : 0) };
  }
  if (gps.obsMode) return { kind: 'obs', to: tagged(fms, leg.to.ident) };
  if (r?.path === 'PI') {
    const outbound = leg.stage === undefined || leg.stage === 'outbound';
    const next = a!.legs[index! + 1]?.to;
    return outbound ? { kind: 'pt', from: tagged(fms, leg.from.ident), to: null } : { kind: 'pt', from: null, to: next ? tagged(fms, next.ident) : null };
  }
  if (leg.isDirectTo) return { kind: 'direct', to: tagged(fms, leg.to.ident) };
  const to: LegEnd = r && (!r.to || r.label.endsWith('ft') || HOLDS.has(r.path) || r.label === 'MANSEQ' || r.label === 'INTRCPT') ? { ident: legName(r) } : tagged(fms, leg.to.ident);
  return { kind: 'leg', from: tagged(fms, leg.from.ident), to, arc: r?.path === 'AF' || r?.path === 'RF' };
}
