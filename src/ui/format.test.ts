import { describe, expect, it } from 'vitest';
import { formatBearing, formatDistance, formatEte } from './format';
import { startEntry, turnLarge, turnSmall, typeChar } from './identEntry';

describe('format', () => {
  it('formats bearings, distances and times the avionics way', () => {
    expect(formatBearing(4.6)).toBe('005°');
    expect(formatBearing(0)).toBe('360°');
    expect(formatBearing(null)).toBe('___°');
    expect(formatDistance(7.04)).toBe('7.0');
    expect(formatDistance(123.4)).toBe('123');
    expect(formatEte(75)).toBe('01:15');
    expect(formatEte(3 * 3600 + 25 * 60)).toBe('03:25');
  });
});

describe('ident entry', () => {
  const idents = ['KFDK', 'KFME', 'KJYG', 'KJYO', 'MRB'];
  const complete = (p: string) => idents.find((i) => i.startsWith(p));

  it('spells ahead as characters are picked with the small knob', () => {
    let e = startEntry();
    e = turnSmall(e, 11, complete); // blank -> A -> ... -> K
    expect(e.text).toBe('KFDK');
    e = turnLarge(e, 2);
    expect(e.cursor).toBe(2);
    e = turnSmall(e, 4, complete); // D -> H? (no match keeps the prefix)
    expect(e.text.startsWith('KFH')).toBe(true);
  });

  it('accepts typed characters', () => {
    let e = startEntry();
    for (const c of 'KJYO') e = typeChar(e, c, complete);
    expect(e.text).toBe('KJYO');
  });
});
