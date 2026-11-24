import { describe, expect, it } from 'vitest';
import { DIAL_SCALES, dialAngle, dialPoint, dialReadout, dialValue } from '../dial';

describe('dialAngle — the needle follows the value, clamped to the scale', () => {
  it('the ends and the middle of each scale', () => {
    expect(dialAngle(5000, DIAL_SCALES.yards)).toBe(-135);
    expect(dialAngle(7200, DIAL_SCALES.yards)).toBe(135);
    expect(dialAngle(6100, DIAL_SCALES.yards)).toBe(0);
    expect(dialAngle(71, DIAL_SCALES.rating)).toBe(0);
    expect(dialAngle(127.5, DIAL_SCALES.slope)).toBe(0);
  });
  it('a value off the scale stops at the end, never past it', () => {
    expect(dialAngle(3150, DIAL_SCALES.yards)).toBe(-135); // a nine's yardage
    expect(dialAngle(7900, DIAL_SCALES.yards)).toBe(135);
    expect(dialAngle(155, DIAL_SCALES.slope)).toBe(135);
  });
  it('no value rests at the start; a broken scale never divides by zero', () => {
    expect(dialAngle(null, DIAL_SCALES.rating)).toBe(-135);
    expect(dialAngle(NaN, DIAL_SCALES.rating)).toBe(-135);
    expect(dialAngle(70, { min: 5, max: 5 })).toBe(-135);
  });
});

describe('dialValue — the form\'s strings in, a number or the dash out', () => {
  it('numbers and numeric strings pass; blank, junk, zero and negatives are no value', () => {
    expect(dialValue('71.2')).toBe(71.2);
    expect(dialValue(128)).toBe(128);
    for (const raw of ['', '  ', 'abc', 0, '0', -3, null, undefined, {}, NaN]) expect(dialValue(raw)).toBeNull();
  });
});

describe('dialReadout — what is written under the dial', () => {
  it('yards with a comma, rating to one decimal, slope whole, a dash for none', () => {
    expect(dialReadout('yards', 6412)).toBe('6,412');
    expect(dialReadout('rating', 71)).toBe('71.0');
    expect(dialReadout('rating', 71.24)).toBe('71.2');
    expect(dialReadout('slope', 131)).toBe('131');
    for (const kind of ['yards', 'rating', 'slope'] as const) expect(dialReadout(kind, null)).toBe('—');
  });
});

describe('dialPoint — 0° is straight up, positive is clockwise', () => {
  it('the four compass points around (54, 50)', () => {
    expect(dialPoint(54, 50, 40, 0)).toEqual({ x: 54, y: 10 });
    expect(dialPoint(54, 50, 40, 90)).toEqual({ x: 94, y: 50 });
    expect(dialPoint(54, 50, 40, -90)).toEqual({ x: 14, y: 50 });
    expect(dialPoint(54, 50, 40, 180)).toEqual({ x: 54, y: 90 });
  });
});
