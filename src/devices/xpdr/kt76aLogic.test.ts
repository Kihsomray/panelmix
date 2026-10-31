import { describe, expect, it } from 'vitest';
import { lampLit, selectorFor, selectorMode, turnCodeDigit, turnSelector, type LampInput } from './kt76aLogic';

describe('KT 76A function selector', () => {
  it('turns between the stops at OFF and TST', () => {
    expect(turnSelector('OFF', -1)).toBe('OFF');
    expect(turnSelector('OFF', 2)).toBe('ON');
    expect(turnSelector('ALT', 5)).toBe('TST');
    expect(turnSelector('TST', -1)).toBe('ALT');
  });

  it('selects the sim modes and follows a mode set elsewhere', () => {
    expect(selectorMode('SBY')).toBe('STBY');
    expect(selectorMode('TST')).toBe('ALT');
    expect(selectorFor('STBY')).toBe('SBY');
    expect(selectorFor('GND')).toBe('SBY');
    expect(selectorFor('ALT')).toBe('ALT');
  });
});

describe('KT 76A code drums', () => {
  it('turns one octal digit and wraps', () => {
    expect(turnCodeDigit('1200', 0, 1)).toBe('2200');
    expect(turnCodeDigit('1270', 2, 1)).toBe('1200');
    expect(turnCodeDigit('1200', 3, -1)).toBe('1207');
    expect(turnCodeDigit('7777', 1, 9)).toBe('7077');
  });
});

describe('KT 76A reply lamp', () => {
  const base: LampInput = { position: 'ALT', mode: 'ALT', simTime: 1, identUntil: null, warmUntil: 0 };

  it('flashes with replies in ON and ALT, stays dark in SBY and OFF', () => {
    expect(lampLit({ ...base, simTime: 0.1 })).toBe(true);
    expect(lampLit(base)).toBe(false);
    expect(lampLit({ ...base, position: 'SBY', mode: 'STBY', simTime: 0.1 })).toBe(false);
    expect(lampLit({ ...base, position: 'OFF', mode: 'OFF', simTime: 0.1 })).toBe(false);
  });

  it('stays lit during ident and the self test', () => {
    expect(lampLit({ ...base, identUntil: 10 })).toBe(true);
    expect(lampLit({ ...base, position: 'TST' })).toBe(true);
  });

  it('stays dark while warming up', () => {
    expect(lampLit({ ...base, simTime: 0.1, warmUntil: 45 })).toBe(false);
    expect(lampLit({ ...base, position: 'TST', warmUntil: 45 })).toBe(false);
  });
});
