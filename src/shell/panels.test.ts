import { describe, expect, it } from 'vitest';
import { cdiSources, decodePanel, encodePanel, INTEGRATED, NONE, normalize, PRESETS, xpdrChoices } from './panels';

describe('panel rules', () => {
  it('accepts every preset as is', () => {
    for (const p of PRESETS) expect(normalize(p.config).config).toEqual(p.config);
  });

  it('pulls in the G1000 MFD when the G1000 PFD is chosen', () => {
    const { config, notes } = normalize({ pfd: 'g1000-pfd', nav: 'gns430w', xpdr: 'gtx345', ap: 'kap140' }, 'pfd');
    expect(config).toMatchObject({ pfd: 'g1000-pfd', nav: 'g1000-mfd', xpdr: INTEGRATED, ap: 'kap140' });
    expect(notes.length).toBeGreaterThan(0);
  });

  it('replaces the G1000 PFD when another navigator is chosen', () => {
    const { config } = normalize({ pfd: 'g1000-pfd', nav: 'gtn750xi', xpdr: INTEGRATED, ap: INTEGRATED }, 'nav');
    expect(config.pfd).not.toBe('g1000-pfd');
    expect(config.nav).toBe('gtn750xi');
    // The GTN controls a remote transponder; the GFC 700 is gone with the G1000.
    expect(config.xpdr).toBe(INTEGRATED);
    expect(config.ap).toBe(NONE);
  });

  it('only offers an integrated transponder when something controls one', () => {
    expect(xpdrChoices({ pfd: 'steam', nav: 'gns430w', xpdr: 'gtx345', ap: NONE }).map((o) => o.id)).not.toContain(INTEGRATED);
    expect(xpdrChoices({ pfd: 'steam', nav: 'gtn650xi', xpdr: INTEGRATED, ap: NONE }).map((o) => o.id)).toContain(INTEGRATED);
    expect(normalize({ pfd: 'steam', nav: 'gns430w', xpdr: INTEGRATED, ap: NONE }).config.xpdr).toBe('gtx345');
  });

  it('knows which CDI sources each panel has', () => {
    expect(cdiSources({ pfd: 'g1000-pfd', nav: 'g1000-mfd', xpdr: INTEGRATED, ap: NONE })).toEqual(['GPS', 'NAV1', 'NAV2']);
    expect(cdiSources({ pfd: 'g5', nav: 'gns430w', xpdr: 'gtx345', ap: NONE })).toEqual(['GPS', 'NAV1']);
  });

  it('round-trips share links and repairs unknown ids', () => {
    const c = PRESETS[1]!.config;
    expect(decodePanel(encodePanel(c))).toEqual(c);
    expect(normalize({ pfd: 'nope', nav: 'gns430w', xpdr: 'x', ap: 'y' }).config.pfd).toBe('g5');
  });
});
