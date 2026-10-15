import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_MIN_SHRINK_PX,
  bannerOverlap,
  isKeyboardOpen,
  nextBaselineHeight,
  tabBarOverlap,
  threadViewportGeometry,
} from '../thread-viewport';

const base = { vvHeight: 844, vvOffsetTop: 0, layoutHeight: 844, baselineHeight: 844, bannerH: 0, tabBarH: 0 };

describe('the phone thread follows the visual viewport', () => {
  it('keyboard closed: the whole viewport, the home indicator padded', () => {
    expect(threadViewportGeometry(base)).toEqual({ top: 0, height: 844, keyboardOpen: false, bottomInset: 'safe' });
  });
  it('iOS keyboard: the strip is panned and shorter — the shell goes where the strip is', () => {
    const g = threadViewportGeometry({ ...base, vvHeight: 420, vvOffsetTop: 300 });
    expect(g).toEqual({ top: 300, height: 420, keyboardOpen: true, bottomInset: 'none' });
  });
  it('Android resizes-content: layout and visual shrink together; the baseline still says keyboard', () => {
    const g = threadViewportGeometry({ ...base, vvHeight: 500, layoutHeight: 500 });
    expect(g.keyboardOpen).toBe(true);
    expect(g.height).toBe(500);
    expect(g.bottomInset).toBe('none');
  });
  it('an iPad hardware-keyboard bar is not a keyboard', () => {
    expect(isKeyboardOpen(844, 844 - 55)).toBe(false);
    expect(isKeyboardOpen(844, 844 - KEYBOARD_MIN_SHRINK_PX)).toBe(true);
  });
  it('the sticky banner is subtracted only where it overlaps the strip', () => {
    expect(bannerOverlap(40, 0)).toBe(40);
    expect(bannerOverlap(40, 25)).toBe(15);
    expect(bannerOverlap(40, 300)).toBe(0);
    expect(threadViewportGeometry({ ...base, bannerH: 40 })).toEqual({ top: 40, height: 804, keyboardOpen: false, bottomInset: 'safe' });
    expect(threadViewportGeometry({ ...base, bannerH: 40, vvHeight: 420, vvOffsetTop: 300 }).top).toBe(300);
  });
  it('the tab bar is subtracted only where it overlaps the strip, and never with the keyboard over it', () => {
    expect(tabBarOverlap(90, 844, 0, 844)).toBe(90);
    expect(tabBarOverlap(90, 844, 0, 420)).toBe(0);
    expect(tabBarOverlap(0, 844, 0, 844)).toBe(0);
    expect(threadViewportGeometry({ ...base, tabBarH: 90 })).toEqual({ top: 0, height: 754, keyboardOpen: false, bottomInset: 'none' });
    expect(threadViewportGeometry({ ...base, tabBarH: 90, vvHeight: 420, vvOffsetTop: 300 })).toEqual({ top: 300, height: 420, keyboardOpen: true, bottomInset: 'none' });
    // Android: the bar sits above the keyboard in the shrunk layout — it does overlap.
    expect(tabBarOverlap(90, 500, 0, 500)).toBe(90);
  });
  it('the baseline is the tallest height seen, reset by a width change', () => {
    expect(nextBaselineHeight({ baseline: 844, width: 390 }, 420, 390)).toBe(844);
    expect(nextBaselineHeight({ baseline: 420, width: 390 }, 844, 390)).toBe(844);
    expect(nextBaselineHeight({ baseline: 844, width: 390 }, 390, 844)).toBe(390);
  });
  it('never a negative height or top', () => {
    const g = threadViewportGeometry({ ...base, vvHeight: 30, bannerH: 40, vvOffsetTop: -5 });
    expect(g.height).toBe(0);
    expect(g.top).toBeGreaterThanOrEqual(0);
  });
});
