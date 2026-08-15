import { describe, it, expect } from 'vitest';
import {
  WHEEL_ITEM_H,
  WHEEL_HEIGHT,
  WHEEL_PAD,
  WHEEL_VISIBLE,
  clampToRange,
  wheelValues,
  valueForScrollTop,
  scrollTopForValue,
  nextValueForKey,
  valueForTypedDigit,
} from '../wheel';

describe('wheel geometry constants', () => {
  it('rows are a real 44px — the touch floor, not faked with an extender', () => {
    // An `after:` extender is dead inside a scroll container (globals.css
    // CLIPPING RULE), so the height has to be genuine.
    expect(WHEEL_ITEM_H).toBe(44);
  });

  it('shows an odd number of rows so exactly one is centred', () => {
    expect(WHEEL_VISIBLE % 2).toBe(1);
  });

  it('pads each end by half the window so the extremes can centre', () => {
    expect(WHEEL_HEIGHT).toBe(WHEEL_ITEM_H * WHEEL_VISIBLE);
    expect(WHEEL_PAD).toBe(WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2));
  });
});

describe('clampToRange', () => {
  it('clamps both ends and passes through the middle', () => {
    expect(clampToRange(0, 1, 15)).toBe(1);
    expect(clampToRange(99, 1, 15)).toBe(15);
    expect(clampToRange(4, 1, 15)).toBe(4);
  });

  it('falls back to min for NaN rather than propagating it', () => {
    expect(clampToRange(Number.NaN, 1, 15)).toBe(1);
  });
});

describe('wheelValues', () => {
  it('is inclusive of both bounds', () => {
    expect(wheelValues(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(wheelValues(0, 0)).toEqual([0]);
  });

  it('degrades to a single value on an inverted range', () => {
    expect(wheelValues(5, 1)).toEqual([5]);
  });
});

describe('scroll <-> value mapping', () => {
  it('round-trips every value in the range', () => {
    for (const v of wheelValues(1, 15)) {
      expect(valueForScrollTop(scrollTopForValue(v, 1, 15), 1, 15)).toBe(v);
    }
  });

  it('puts the minimum at scrollTop 0', () => {
    expect(scrollTopForValue(1, 1, 15)).toBe(0);
    expect(valueForScrollTop(0, 1, 15)).toBe(1);
  });

  it('rounds a half-scrolled wheel to the nearest row', () => {
    // Just past halfway between 1 and 2 resolves to 2.
    expect(valueForScrollTop(WHEEL_ITEM_H * 0.6, 1, 15)).toBe(2);
    expect(valueForScrollTop(WHEEL_ITEM_H * 0.4, 1, 15)).toBe(1);
  });

  it('clamps overscroll at both ends (iOS rubber-banding goes negative)', () => {
    expect(valueForScrollTop(-200, 1, 15)).toBe(1);
    expect(valueForScrollTop(99_999, 1, 15)).toBe(15);
  });

  it('never divides by a zero item height', () => {
    expect(valueForScrollTop(100, 1, 15, 0)).toBe(1);
  });
});

describe('nextValueForKey', () => {
  it('arrows step by one, up meaning the lower number', () => {
    // Lower values sit above on the wheel, so ArrowUp decreases.
    expect(nextValueForKey(4, 'ArrowUp', 1, 15)).toBe(3);
    expect(nextValueForKey(4, 'ArrowDown', 1, 15)).toBe(5);
  });

  it('page steps by five', () => {
    expect(nextValueForKey(8, 'PageUp', 1, 15)).toBe(3);
    expect(nextValueForKey(8, 'PageDown', 1, 15)).toBe(13);
  });

  it('home and end go to the bounds', () => {
    expect(nextValueForKey(8, 'Home', 1, 15)).toBe(1);
    expect(nextValueForKey(8, 'End', 1, 15)).toBe(15);
  });

  it('clamps at the bounds instead of wrapping', () => {
    expect(nextValueForKey(1, 'ArrowUp', 1, 15)).toBe(1);
    expect(nextValueForKey(15, 'ArrowDown', 1, 15)).toBe(15);
    expect(nextValueForKey(2, 'PageUp', 1, 15)).toBe(1);
  });

  it('returns null for keys it does not own, so callers can pass them through', () => {
    for (const k of ['Enter', 'Escape', 'Tab', 'a', ' ']) {
      expect(nextValueForKey(4, k, 1, 15)).toBeNull();
    }
  });

  it('copes with a current value outside the range', () => {
    expect(nextValueForKey(99, 'ArrowUp', 1, 15)).toBe(14);
  });
});

describe('valueForTypedDigit', () => {
  it('ignores non-digits', () => {
    expect(valueForTypedDigit('a', '', 1, 15)).toBeNull();
    expect(valueForTypedDigit('-', '', 1, 15)).toBeNull();
  });

  it('takes a single digit', () => {
    expect(valueForTypedDigit('4', '', 1, 15)).toEqual({ value: 4, buffer: '4' });
  });

  it('builds a two-digit value across presses', () => {
    const first = valueForTypedDigit('1', '', 1, 15)!;
    expect(first.value).toBe(1);
    expect(valueForTypedDigit('2', first.buffer, 1, 15)).toEqual({ value: 12, buffer: '12' });
  });

  it('restarts when the combination would exceed the range', () => {
    // 0-10 putts: "1" then "5" must become 5, not clamp to 10 and stick.
    const first = valueForTypedDigit('1', '', 0, 10)!;
    expect(valueForTypedDigit('5', first.buffer, 0, 10)).toEqual({ value: 5, buffer: '5' });
  });

  it('clamps a lone digit below the minimum', () => {
    expect(valueForTypedDigit('0', '', 1, 15)).toEqual({ value: 1, buffer: '0' });
  });
});
