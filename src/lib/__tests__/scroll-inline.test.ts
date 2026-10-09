import { describe, it, expect } from 'vitest';
import { nearestScrollLeft } from '../scroll-inline';

const view = { left: 0, right: 300 };

describe('nearestScrollLeft', () => {
  it('leaves a fully visible item alone', () => {
    expect(nearestScrollLeft(40, view, { left: 100, right: 180 })).toBe(40);
  });

  it('scrolls right just enough to show an item past the right edge', () => {
    expect(nearestScrollLeft(0, view, { left: 260, right: 340 })).toBe(40);
  });

  it('scrolls left just enough to show an item past the left edge', () => {
    expect(nearestScrollLeft(120, view, { left: -30, right: 50 })).toBe(90);
  });

  it('aligns the start of an item wider than the view', () => {
    expect(nearestScrollLeft(10, view, { left: -20, right: 400 })).toBe(-10);
  });
});
