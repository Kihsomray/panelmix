import { describe, expect, it } from 'vitest';
import { computeLayout, focusWidth, GAP, SLOT_BAR_H } from './layout';

const G1000 = { width: 1180, height: 770 };
const G5 = { width: 340, height: 736 };
const GNS430 = { width: 625, height: 265 };
const GTX345 = { width: 625, height: 165 };
const GFC500 = { width: 625, height: 206 };

describe('panel layout', () => {
  it('stacks everything on a phone held upright', () => {
    const l = computeLayout({ width: 362, height: 700, pfd: G5, stack: [GNS430] });
    expect(l.columns).toBe(1);
  });

  it('fits a tall narrow PFD by height and gives the navigator the rest', () => {
    const l = computeLayout({ width: 1400, height: 740, pfd: G5, stack: [GNS430, GTX345, GFC500] });
    expect(l.columns).toBe(2);
    expect(G5.height * l.pfdScale + SLOT_BAR_H).toBeLessThanOrEqual(740 + 0.01);
    // The stack fits in the height too, and both fit side by side.
    const stackHeight = (GNS430.height + GTX345.height + GFC500.height) * l.stackScale + 3 * SLOT_BAR_H + 2 * GAP;
    expect(stackHeight).toBeLessThanOrEqual(740 + 0.01);
    expect(G5.width * l.pfdScale + GNS430.width * l.stackScale).toBeLessThanOrEqual(1400 - GAP + 0.01);
  });

  it('shrinks two wide displays together to fit side by side', () => {
    const l = computeLayout({ width: 1400, height: 740, pfd: G1000, stack: [G1000] });
    expect(l.pfdScale).toBeCloseTo(l.stackScale, 6);
    expect(G1000.width * (l.pfdScale + l.stackScale)).toBeCloseTo(1400 - GAP, 4);
  });

  it('drops the height limit on a short landscape phone instead of shrinking to nothing', () => {
    const l = computeLayout({ width: 820, height: 250, pfd: G1000, stack: [G1000] });
    expect(l.pfdScale).toBeGreaterThan(0.3);
    expect(G1000.width * (l.pfdScale + l.stackScale)).toBeLessThanOrEqual(820 - GAP + 0.01);
  });

  it('focuses by height on a big screen and by width on a short one', () => {
    expect(focusWidth(G1000, { width: 1400, height: 760 })).toBeCloseTo((760 / 770) * 1180, 4);
    expect(focusWidth(G1000, { width: 820, height: 250 })).toBe(820);
  });
});
