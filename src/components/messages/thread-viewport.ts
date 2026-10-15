/**
 * The phone thread's geometry (Tom's fix 6, Oct 14 2026) — pure, zero imports.
 *
 * iOS never shrinks the layout viewport for the software keyboard; it shows
 * a STRIP of it (window.visualViewport: height + offsetTop) and pans that
 * strip to keep the caret visible. A shell that sits at layout top 0 and
 * merely shrinks to vv.height ends up half off the strip ("the message
 * area collapses toward the top", "the text box does not line up with the
 * keyboard"). So the thread shell FOLLOWS the strip: top = the strip's
 * offset, height = the strip's height — minus whatever fixed chrome
 * overlaps the strip (the sticky banner at the layout top, the tab bar at
 * the layout bottom; with the keyboard open both are off the strip).
 *
 * Android (`interactiveWidget: resizes-content`) shrinks innerHeight along
 * with the visual viewport, so "layout minus visual" is ~0 there — the
 * keyboard is detected against the TALLEST height seen in this
 * orientation (`nextBaselineHeight`), which both engines satisfy.
 */
export const KEYBOARD_MIN_SHRINK_PX = 120; // iPad's hardware-keyboard bar (~55 px) must not count

export interface ThreadViewportInput {
  /** visualViewport.height (innerHeight where the API is missing). */
  vvHeight: number;
  /** visualViewport.offsetTop — the strip's pan within the layout viewport. */
  vvOffsetTop: number;
  /** window.innerHeight — the layout viewport. */
  layoutHeight: number;
  /** The tallest vv height seen in this orientation. */
  baselineHeight: number;
  /** --ea-banner-h (the sticky top banner), 0 when absent. */
  bannerH: number;
  /** --ea-tabbar-h (the fixed phone tab bar), 0 when hidden. */
  tabBarH: number;
}

export interface ThreadViewportGeometry {
  /** Layout-viewport px: where the shell's top goes (`position: fixed; top`). */
  top: number;
  /** The shell's height. */
  height: number;
  keyboardOpen: boolean;
  /** 'safe' = pad the home indicator; 'none' with the keyboard open (it covers it) or a bar overlapping the bottom. */
  bottomInset: 'safe' | 'none';
}

export function isKeyboardOpen(baselineHeight: number, vvHeight: number, minShrink: number = KEYBOARD_MIN_SHRINK_PX): boolean {
  return baselineHeight - vvHeight >= minShrink;
}

/** The tallest height seen, reset when the width changes (an orientation turn). */
export function nextBaselineHeight(prev: { baseline: number; width: number }, vvHeight: number, width: number): number {
  if (prev.width !== width) return vvHeight;
  return Math.max(prev.baseline, vvHeight);
}

/** How much of the sticky top banner is inside the visible strip. */
export function bannerOverlap(bannerH: number, vvOffsetTop: number): number {
  return Math.max(0, bannerH - Math.max(0, vvOffsetTop));
}

/** How much of the fixed bottom bar is inside the visible strip. */
export function tabBarOverlap(tabBarH: number, layoutHeight: number, vvOffsetTop: number, vvHeight: number): number {
  if (tabBarH <= 0) return 0;
  const barTop = layoutHeight - tabBarH;
  const visibleBottom = vvOffsetTop + vvHeight;
  return Math.min(tabBarH, Math.max(0, visibleBottom - barTop));
}

export function threadViewportGeometry(i: ThreadViewportInput): ThreadViewportGeometry {
  const keyboardOpen = isKeyboardOpen(i.baselineHeight, i.vvHeight);
  const banner = bannerOverlap(i.bannerH, i.vvOffsetTop);
  const bar = tabBarOverlap(i.tabBarH, i.layoutHeight, i.vvOffsetTop, i.vvHeight);
  const height = Math.max(0, i.vvHeight - banner - bar);
  return {
    top: Math.max(0, i.vvOffsetTop) + banner,
    height,
    keyboardOpen,
    bottomInset: keyboardOpen || bar > 0 ? 'none' : 'safe',
  };
}
