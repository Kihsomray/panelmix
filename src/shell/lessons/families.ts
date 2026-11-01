import { device } from '../../devices/registry';
import type { PanelInfo } from '../../devices/types';
import type { LessonStep, PanelFamilies, StepHints } from './types';

/*
 * Which family each installed unit belongs to, so a step shows the hint for
 * the units in this panel: "C key" on a GNS, "tap the active frequency" on
 * a GTN, "COM flip-flop key" on the G1000.
 */

export function familiesOf(panel: PanelInfo): PanelFamilies {
  const nav = panel.nav.startsWith('gtn') ? 'gtn' : panel.nav === 'g1000-mfd' ? 'g1000' : 'gns';
  return {
    pfd: panel.pfd === 'g5' ? 'g5' : panel.pfd === 'aspen-e1000' ? 'aspen' : panel.pfd === 'g1000-pfd' ? 'g1000' : 'steam',
    nav,
    xpdr: panel.xpdr === 'kt76a' ? 'kt76a' : panel.xpdr === 'gtx345' ? 'gtx345' : nav === 'g1000' ? 'g1000' : 'gtn',
    ap: panel.ap === 'kap140' ? 'kap140' : panel.ap === 'gfc500' ? 'gfc500' : panel.ap === 'integrated' ? 'gfc700' : 'sim',
  };
}

export interface HintLine {
  /** The unit it is for: "GNS 430W", "KAP 140", "Sim autopilot". */
  readonly unit: string;
  readonly text: string;
}

function unitName(panel: PanelInfo, role: keyof PanelFamilies, f: PanelFamilies): string {
  switch (role) {
    case 'pfd':
      return device(panel.pfd)?.name ?? 'Flight instruments';
    case 'nav':
      return device(panel.nav)?.name ?? 'Navigator';
    case 'xpdr':
      return device(panel.xpdr)?.name ?? `${device(panel.nav)?.name ?? 'Navigator'} transponder`;
    case 'ap':
      return f.ap === 'sim' ? 'Sim autopilot (Fly)' : f.ap === 'gfc700' ? 'GFC 700' : device(panel.ap)?.name ?? 'Autopilot';
  }
}

/**
 * The hint lines for this panel, in panel order. A G1000 is one unit for
 * the PFD and navigator roles, so a hint written for both shows once.
 */
export function hintsFor(hints: StepHints | undefined, panel: PanelInfo): HintLine[] {
  if (!hints) return [];
  const f = familiesOf(panel);
  const out: HintLine[] = [];
  const roles = ['nav', 'pfd', 'xpdr', 'ap'] as const;
  for (const role of roles) {
    const table = hints[role] as Partial<Record<string, string>> | undefined;
    const text = table?.[f[role]];
    if (!text || out.some((h) => h.text === text)) continue;
    out.push({ unit: unitName(panel, role, f), text });
  }
  if (hints.any) out.push({ unit: 'Technique', text: hints.any });
  return out;
}

/** The steps of a lesson that apply to this panel. */
export function stepsFor(steps: readonly LessonStep[], panel: PanelInfo): LessonStep[] {
  return steps.filter((s) => !s.when || s.when(panel));
}
