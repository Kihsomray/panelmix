import { describe, expect, it } from 'vitest';
import { backspace, courseText, courseValue, pressDigit, startCourse, stepCourse } from './course';

const type = (keys: string, base = 334) => [...keys].reduce((e, k) => pressDigit(e, k), startCourse(base));

describe('OBS course entry', () => {
  it('shows the current course, then what is typed', () => {
    expect(courseText(startCourse(25))).toBe('025°');
    expect(courseText(startCourse(0))).toBe('360°');
    expect(courseText(type('02'))).toBe('02_°');
    expect(courseValue(type('025'))).toBe(25);
  });

  it('refuses courses above 360', () => {
    expect(type('4').typed).toBe('');
    expect(type('37').typed).toBe('3');
    expect(type('361').typed).toBe('36');
    expect(courseValue(type('360'))).toBe(360);
    expect(courseValue(type('000'))).toBe(360);
  });

  it('steps with the knob and wraps through north', () => {
    expect(courseValue(stepCourse(startCourse(355), 10))).toBe(5);
    expect(courseValue(stepCourse(type('01'), -2))).toBe(359);
    expect(backspace(type('12')).typed).toBe('1');
  });
});
