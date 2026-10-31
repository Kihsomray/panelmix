import { device, devicesFor } from '../devices/registry';
import type { DeviceSpec, PanelInfo, Slot } from '../devices/types';
import type { CdiSource } from '../sim/types';

/*
 * Which units are in the panel, and the rules for combining them: integrated
 * suites (the G1000) only work with their own parts, a transponder can be
 * "integrated" only when a navigator or the G1000 controls one, and so on.
 */

export interface PanelConfig {
  readonly pfd: string;
  readonly nav: string;
  /** Transponder id, or INTEGRATED. */
  readonly xpdr: string;
  /** Autopilot id, INTEGRATED, or NONE (fly with the sim autopilot). */
  readonly ap: string;
}

export const INTEGRATED = 'integrated';
export const NONE = 'none';

export const DEFAULT_PANEL: PanelConfig = { pfd: 'g5', nav: 'gns430w', xpdr: 'gtx345', ap: 'gfc500' };

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly config: PanelConfig;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'g1000',
    name: 'Cessna 172S G1000',
    description: 'Integrated G1000 PFD and MFD with the GFC 700 autopilot.',
    config: { pfd: 'g1000-pfd', nav: 'g1000-mfd', xpdr: INTEGRATED, ap: INTEGRATED },
  },
  {
    id: 'g5-430',
    name: 'G5 + GNS 430W',
    description: 'The most common upgrade: G5 attitude and HSI with a 430W and GFC 500.',
    config: { pfd: 'g5', nav: 'gns430w', xpdr: 'gtx345', ap: 'gfc500' },
  },
  {
    id: 'g5-gtn650',
    name: 'G5 + GTN 650Xi',
    description: 'G5 pair with a touchscreen GTN 650Xi controlling the transponder.',
    config: { pfd: 'g5', nav: 'gtn650xi', xpdr: INTEGRATED, ap: 'gfc500' },
  },
  {
    id: 'aspen-gtn750',
    name: 'Aspen + GTN 750Xi',
    description: 'Aspen Evolution PFD with a GTN 750Xi.',
    config: { pfd: 'aspen-e1000', nav: 'gtn750xi', xpdr: INTEGRATED, ap: 'kap140' },
  },
  {
    id: 'steam-430',
    name: 'Steam gauges + GNS 430W',
    description: 'Six-pack, a GNS 430W, a KT 76A and a KAP 140: the classic IFR trainer.',
    config: { pfd: 'steam', nav: 'gns430w', xpdr: 'kt76a', ap: 'kap140' },
  },
  {
    id: 'steam-530',
    name: 'Steam gauges + GNS 530W',
    description: 'Six-pack with the big-screen 530W and a GTX 345.',
    config: { pfd: 'steam', nav: 'gns530w', xpdr: 'gtx345', ap: NONE },
  },
];

const SLOT_NAMES: Record<Slot, string> = { pfd: 'flight instruments', nav: 'navigator', xpdr: 'transponder', ap: 'autopilot' };

function provides(c: PanelConfig, key: keyof DeviceSpec['provides']): boolean {
  return [c.pfd, c.nav].some((id) => !!device(id)?.provides[key]);
}

/** Options for the transponder slot given the rest of the panel. */
export function xpdrChoices(c: PanelConfig): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  if (provides(c, 'xpdrControl')) {
    const host = [device(c.pfd), device(c.nav)].find((d) => d?.provides.xpdrControl);
    out.push({ id: INTEGRATED, label: `Controlled by the ${host?.name ?? 'navigator'}` });
  }
  const locked = [device(c.pfd), device(c.nav)].some((d) => d?.requires?.xpdr?.includes(INTEGRATED));
  if (!locked) for (const d of devicesFor('xpdr')) out.push({ id: d.id, label: `${d.maker} ${d.name}` });
  return out;
}

export function apChoices(c: PanelConfig): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [{ id: NONE, label: 'None (use the sim autopilot)' }];
  if (provides(c, 'autopilot')) out.push({ id: INTEGRATED, label: 'Garmin GFC 700 (built into the G1000)' });
  for (const d of devicesFor('ap')) out.push({ id: d.id, label: `${d.maker} ${d.name}` });
  return out;
}

const firstCompatible = (slot: Slot, other: (d: DeviceSpec) => boolean): string =>
  devicesFor(slot).find((d) => other(d))?.id ?? devicesFor(slot)[0]!.id;

/**
 * Makes a configuration valid. `changed` is the slot the pilot just picked;
 * its choice wins and the other slots adapt. Returns notes explaining any
 * automatic changes.
 */
export function normalize(input: PanelConfig, changed?: Slot): { config: PanelConfig; notes: string[] } {
  const notes: string[] = [];
  let c: PanelConfig = {
    pfd: device(input.pfd)?.slot === 'pfd' ? input.pfd : DEFAULT_PANEL.pfd,
    nav: device(input.nav)?.slot === 'nav' ? input.nav : DEFAULT_PANEL.nav,
    xpdr: input.xpdr,
    ap: input.ap,
  };

  const fits = (slot: 'pfd' | 'nav', id: string, against: string) => {
    const req = device(id)?.requires?.[slot === 'pfd' ? 'nav' : 'pfd'];
    return !req || req.includes(against);
  };

  // Integrated suites: the slot just changed wins.
  const order: ('pfd' | 'nav')[] = changed === 'nav' ? ['nav', 'pfd'] : ['pfd', 'nav'];
  for (const slot of order) {
    const other = slot === 'pfd' ? 'nav' : 'pfd';
    const mine = c[slot];
    const theirs = c[other];
    const myReq = device(mine)?.requires?.[other];
    if (myReq && !myReq.includes(theirs)) {
      c = { ...c, [other]: myReq[0]! };
      notes.push(`${device(mine)!.name} works only with the ${device(myReq[0]!)!.name}, so that was selected too.`);
    } else if (!fits(other, theirs, mine)) {
      const replacement = firstCompatible(other, (d) => !d.requires);
      c = { ...c, [other]: replacement };
      notes.push(`${device(theirs)!.name} only works in its own suite, so the ${SLOT_NAMES[other]} changed to ${device(replacement)!.maker} ${device(replacement)!.name}.`);
    }
  }

  const xpdrIds = xpdrChoices(c).map((o) => o.id);
  if (!xpdrIds.includes(c.xpdr)) {
    const next = xpdrIds.includes(INTEGRATED) ? INTEGRATED : xpdrIds[0]!;
    if (changed && input.xpdr !== next && input.xpdr) notes.push(`Transponder set to ${xpdrChoices(c).find((o) => o.id === next)!.label}.`);
    c = { ...c, xpdr: next };
  }
  const apIds = apChoices(c).map((o) => o.id);
  if (!apIds.includes(c.ap)) {
    const next = apIds.includes(INTEGRATED) ? INTEGRATED : NONE;
    c = { ...c, ap: next };
  }
  return { config: c, notes };
}

/** CDI sources this panel can select, in CDI-key order. */
export function cdiSources(c: PanelConfig): CdiSource[] {
  const navs = Math.max(device(c.nav)?.provides.nav ?? 0, device(c.pfd)?.provides.nav ?? 0);
  return navs >= 2 ? ['GPS', 'NAV1', 'NAV2'] : navs === 1 ? ['GPS', 'NAV1'] : ['GPS'];
}

export function panelInfo(c: PanelConfig): PanelInfo {
  return { ...c, cdiSources: cdiSources(c) };
}

// Persistence and share links ------------------------------------------------

const KEY = 'panelmix:panel:v1';

export function loadPanel(): PanelConfig {
  try {
    const fromHash = decodePanel(location.hash);
    if (fromHash) return normalize(fromHash).config;
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw) as PanelConfig).config;
  } catch {
    // fall through
  }
  return DEFAULT_PANEL;
}

export function savePanel(c: PanelConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

export function encodePanel(c: PanelConfig): string {
  return `#pfd=${c.pfd}&nav=${c.nav}&xpdr=${c.xpdr}&ap=${c.ap}`;
}

export function decodePanel(hash: string): PanelConfig | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const pfd = p.get('pfd');
  const nav = p.get('nav');
  if (!pfd || !nav) return null;
  return { pfd, nav, xpdr: p.get('xpdr') ?? INTEGRATED, ap: p.get('ap') ?? NONE };
}
