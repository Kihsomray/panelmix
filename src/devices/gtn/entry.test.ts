import { describe, expect, it } from 'vitest';
import { gtnCom, gtnFreq } from './format';
import { keyboardIdent, keyboardReducer, keyboardSplit, startKeyboard, typedPrefix } from './keyboard';
import { backspace, channelDigits, entryDisplay, entryValue, pressDigit, startFreqEntry, tuneEntry, type FreqEntry } from './keypad';
import * as sq from './squawk';

const typeAll = (band: 'com' | 'nav', keys: string, e: FreqEntry = startFreqEntry(122975)) =>
  [...keys].reduce((acc, k) => pressDigit(band, acc, k), e);

describe('frequency keypad', () => {
  it('shows COM with five digits the way a 25 kHz GTN does', () => {
    expect(gtnCom(119525)).toBe('119.52');
    expect(gtnCom(121500)).toBe('121.50');
    expect(gtnFreq('nav', 113500)).toBe('113.50');
    expect(channelDigits(136975)).toBe('13697');
  });

  it('autofills the leading 1 and the trailing zero: 2, 1, 5 is 121.50', () => {
    const e = typeAll('com', '215');
    expect(e.typed).toBe('1215');
    expect(entryDisplay('com', e)).toEqual({ typed: '121.5', fill: '0', placeholder: false });
    expect(entryValue('com', e)).toBe(121500);
  });

  it('autofills the first valid channel after each digit', () => {
    expect(entryDisplay('com', typeAll('com', '1'))).toEqual({ typed: '1', fill: '18.00', placeholder: false });
    expect(entryValue('com', typeAll('com', '13'))).toBe(130000);
    expect(entryValue('nav', typeAll('nav', '0'))).toBe(108000);
  });

  it('ignores digits no channel allows at the cursor', () => {
    expect(typeAll('com', '8').typed).toBe(''); // no COM channel starts 18x
    expect(typeAll('com', '19').typed).toBe('1'); // 119 needs a 1 first: 1-1-9
    expect(typeAll('com', '1194').typed).toBe('1194');
    expect(typeAll('com', '11941').typed).toBe('1194'); // 119.41 is not a 25 kHz channel
    expect(typeAll('nav', '11355').typed).toBe('11355');
    expect(typeAll('nav', '11352').typed).toBe('1135'); // NAV is 50 kHz
  });

  it('reads 25 kHz channels from their two displayed decimals', () => {
    expect(entryValue('com', typeAll('com', '11952'))).toBe(119525);
    expect(entryValue('com', typeAll('com', '12297'))).toBe(122975);
  });

  it('shows the current standby until typing starts, and backspace undoes digits', () => {
    const e = startFreqEntry(122975);
    expect(entryDisplay('com', e)).toEqual({ typed: '122.97', fill: '', placeholder: true });
    expect(entryValue('com', e)).toBe(122975);
    const typed = typeAll('com', '35', e);
    expect(backspace(typed).typed).toBe('13');
    expect(backspace(backspace(backspace(typed))).typed).toBe('');
  });

  it('tunes with the knob: large MHz, small channels, wrapping within the band', () => {
    let e = startFreqEntry(118000);
    e = tuneEntry('com', e, 'mhz', -1);
    expect(entryValue('com', e)).toBe(136000);
    e = tuneEntry('com', e, 'khz', -1);
    expect(entryValue('com', e)).toBe(136975);
    expect(entryValue('nav', tuneEntry('nav', typeAll('nav', '1135'), 'khz', 1))).toBe(113550);
  });
});

describe('squawk entry', () => {
  it('types from the left with underscores for missing digits and needs all four', () => {
    let e = sq.startSquawk('1200');
    expect(sq.completeCode(e)).toBeNull();
    e = sq.pressDigit(e, '7');
    expect(e.code).toBe('7___');
    e = sq.pressDigit(sq.pressDigit(e, '6'), '9'); // 9 is not octal
    expect(e.code).toBe('76__');
    expect(sq.completeCode(e)).toBeNull();
    e = sq.pressDigit(sq.pressDigit(e, '0'), '0');
    expect(sq.completeCode(e)).toBe('7600');
    expect(sq.pressDigit(e, '1').code).toBe('7600');
  });

  it('backspaces and rolls digits with the knob', () => {
    let e = sq.pressDigit(sq.pressDigit(sq.startSquawk('1200'), '4'), '5');
    e = sq.backspace(e);
    expect(e).toMatchObject({ code: '4___', cursor: 1 });
    e = sq.rollDigit(e, 1);
    expect(e.code).toBe('40__');
    e = sq.rollDigit(e, -1);
    expect(e.code).toBe('47__');
    const knob = sq.rollDigit(sq.moveCursor(sq.startSquawk('1200'), 3), 3);
    expect(knob.code).toBe('1203');
    expect(sq.completeCode(knob)).toBe('1203');
  });
});

describe('waypoint keyboard', () => {
  const idents = ['KFDK', 'KHGR', 'KJYO', 'MRB', 'MRBX'];
  const complete = (p: string) => idents.find((i) => i.startsWith(p));
  const type = (s: string) => [...s].reduce((e, ch) => keyboardReducer(e, { type: 'char', ch }, complete), startKeyboard());

  it('spells ahead from the database and splits typed from autofill', () => {
    const e = type('KJ');
    expect(keyboardSplit(e)).toEqual({ typed: 'KJ', fill: 'YO' });
    expect(keyboardIdent(e)).toBe('KJYO');
    expect(typedPrefix(e)).toBe('KJ');
  });

  it('keeps an unknown prefix as typed', () => {
    const e = type('KZ');
    expect(keyboardIdent(e)).toBe('KZ');
  });

  it('edits with the knob and backspace', () => {
    let e = keyboardReducer(startKeyboard(), { type: 'small', steps: 13 }, complete); // blank -> M
    expect(keyboardIdent(e)).toBe('MRB');
    e = keyboardReducer(e, { type: 'large', steps: 1 }, complete);
    expect(e.cursor).toBe(1);
    e = keyboardReducer(type('MRBX'), { type: 'backspace' }, complete);
    expect(keyboardIdent(e)).toBe('MRB');
    expect(keyboardIdent(keyboardReducer(e, { type: 'set', ident: 'khgr' }, complete))).toBe('KHGR');
  });
});
