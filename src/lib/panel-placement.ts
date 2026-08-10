/**
 * Placement math for body-portaled, fixed-position panels (the @mention
 * dropdown and the portaled emoji picker), as a pure function — the
 * composer-layout pattern, and the honest way to pin iOS-keyboard scenarios
 * that only reproduce on hardware.
 *
 * Coordinate model (learned the hard way across #99–#101):
 * - `position: fixed` and `getBoundingClientRect()` share the LAYOUT
 *   viewport coordinate space on iOS. NEVER add `visualViewport.offset*`
 *   to rect coordinates — that double-counts the keyboard pan (#101's
 *   mistake; every desktop/Android probe passed because offsets are ~0
 *   there).
 * - The visual viewport (`vv.offsetTop`, `vv.height`) describes the
 *   VISIBLE STRIP of that space — use it only as bounds, exactly like
 *   MessageActionSheet's clampSheetTop, the one fixed-position surface
 *   that already worked inside keyboard-panned modals.
 */

export interface PanelPlacementArgs {
  /** Anchor rect in client (layout-viewport) coordinates. */
  anchorTop: number;
  anchorBottom: number;
  anchorLeft: number;
  anchorWidth: number;
  /** Measured panel height (callers floor pre-load placeholders). */
  panelH: number;
  /** Gap between panel and anchor. */
  gap: number;
  /** visualViewport.offsetTop ?? 0 — top of the visible strip. */
  viewportTop: number;
  /** visualViewport.height ?? innerHeight — height of the visible strip. */
  viewportHeight: number;
  /** Optional cap for scrollable panels (mention dropdown: 288). */
  maxHeightCap?: number;
}

export interface PanelPlacement {
  left: number;
  width: number;
  /** ALWAYS top-anchored: `bottom:`-anchored fixed positioning drifts on
   *  iOS against window.innerHeight when Safari's toolbar is in play —
   *  Tom measured "a few pixels of space" on the phone while desktop was
   *  exact. With the panel height known, top = anchorTop − gap − height
   *  is pixel-exact on every platform. */
  top: number;
  /** Only when maxHeightCap given: cap shrunk to the visible strip. */
  maxHeight?: number;
}

export function placePanel(args: PanelPlacementArgs): PanelPlacement {
  const {
    anchorTop,
    anchorBottom,
    anchorLeft,
    anchorWidth,
    panelH,
    gap,
    viewportTop,
    viewportHeight,
    maxHeightCap,
  } = args;

  const maxHeight =
    maxHeightCap !== undefined
      ? Math.max(96, Math.min(maxHeightCap, viewportHeight - 2 * gap - 8))
      : undefined;
  const effectiveH = maxHeight !== undefined ? Math.min(panelH, maxHeight) : panelH;

  // Room measured against the VISIBLE strip, not the layout viewport — with
  // the keyboard up a composer can sit near the bottom of a ~370px strip
  // while still reporting a large rect.top.
  const roomAbove = anchorTop - viewportTop;
  const top =
    roomAbove >= effectiveH + gap + 4
      ? anchorTop - gap - effectiveH
      : anchorBottom + gap;
  const out: PanelPlacement = { left: anchorLeft, width: anchorWidth, top };
  if (maxHeight !== undefined) out.maxHeight = maxHeight;
  return out;
}
