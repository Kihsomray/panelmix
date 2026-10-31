import { describe, expect, it } from 'vitest';
import {
  clearAll,
  clearDigit,
  completeEntry,
  identActive,
  pressVfr,
  replyFlash,
  shownCode,
  specialCodeText,
  typeDigit,
  type SquawkEntry,
} from './squawk';

const type = (keys: number[]) => {
  let entry: SquawkEntry | null = null;
  let commit: string | null = null;
  for (const k of keys) {
    const r = typeDigit(entry, k);
    entry = r.entry;
    commit = r.commit ?? commit;
  }
  return { entry, commit };
};

describe('squawk code entry', () => {
  it('activates the code when the fourth digit is typed', () => {
    const three = type([3, 6, 7]);
    expect(three.entry?.digits).toBe('367');
    expect(three.commit).toBeNull();
    expect(shownCode(three.entry, '1200')).toBe('367_');
    expect(type([3, 6, 7, 2])).toEqual({ entry: null, commit: '3672' });
  });

  it('ignores 8 and 9, which are not octal', () => {
    expect(typeDigit({ digits: '4' }, 8)).toEqual({ entry: { digits: '4' }, commit: null });
    expect(typeDigit(null, 9)).toEqual({ entry: null, commit: null });
  });

  it('steps back with CLR and cancels from the first digit', () => {
    let entry = clearDigit({ digits: '45' });
    expect(entry?.digits).toBe('4');
    entry = clearDigit(entry);
    expect(entry?.digits).toBe('');
    expect(clearDigit(entry)).toBeNull();
  });

  it('returns to the first digit when CLR is held', () => {
    expect(clearAll({ digits: '456' })).toEqual({ digits: '' });
    expect(clearAll(null)).toBeNull();
  });

  it('accepts a partial code with ENT, filling zeros', () => {
    expect(completeEntry({ digits: '45' })).toEqual({ entry: null, commit: '4500' });
    expect(completeEntry({ digits: '' })).toEqual({ entry: null, commit: null });
  });

  it('shows the active code when not entering', () => {
    expect(shownCode(null, '7000')).toBe('7000');
  });
});

describe('VFR key', () => {
  it('toggles between the VFR code and the previous code', () => {
    const first = pressVfr('4521', null);
    expect(first).toEqual({ code: '1200', previous: '4521' });
    const second = pressVfr(first.code, first.previous);
    expect(second.code).toBe('4521');
    const third = pressVfr(second.code, second.previous);
    expect(third.code).toBe('1200');
  });

  it('does nothing at the VFR code with nothing to restore', () => {
    expect(pressVfr('1200', null)).toEqual({ code: '1200', previous: null });
  });
});

describe('annunciations', () => {
  it('names the lost-comm and emergency codes', () => {
    expect(specialCodeText('7600')).toBe('LOST COMM');
    expect(specialCodeText('7700')).toBe('EMERGENCY');
    expect(specialCodeText('1200')).toBeNull();
  });

  it('flashes replies only when the transponder answers', () => {
    expect(replyFlash('ALT', 0.1)).toBe(true);
    expect(replyFlash('ON', 0.1)).toBe(true);
    expect(replyFlash('ALT', 1)).toBe(false);
    expect(replyFlash('STBY', 0.1)).toBe(false);
    expect(replyFlash('OFF', 0.1)).toBe(false);
  });

  it('times the ident pulse from the sim', () => {
    expect(identActive(18, 10)).toBe(true);
    expect(identActive(18, 18)).toBe(false);
    expect(identActive(null, 0)).toBe(false);
  });
});
