/**
 * Layout policy for the long-press message action sheet, as pure decisions
 * (the composer-layout.ts pattern: numbers and math here, DOM measurement at
 * the call site, so the policy is node-testable).
 *
 * The sheet is portaled to document.body and positioned `fixed` against the
 * VISUAL viewport — callers must read `window.visualViewport` (height and
 * offsetTop) at open time, falling back to `innerHeight`/0. The `--vvh` CSS
 * variable is NOT equivalent: it exists only on /messages, not in the chat
 * dock, and CSS vars can't clamp a measured panel anyway.
 */

/** Gap between the pressed bubble's top edge and the emoji row above it. */
export const SHEET_GAP_PX = 8;

/** Minimum clearance the sheet keeps from the visual-viewport edges. */
export const SHEET_VIEWPORT_MARGIN_PX = 8;

export interface SheetTopArgs {
  /** Viewport-space top of the pressed bubble (getBoundingClientRect). */
  anchorTop: number;
  /** Measured height of the emoji row that renders above the replica. */
  emojiRowHeight: number;
  /** Measured offsetHeight of the whole sheet panel. */
  panelHeight: number;
  /** visualViewport.offsetTop ?? 0 (non-zero when the keyboard is up). */
  viewportTop: number;
  /** visualViewport.height ?? window.innerHeight. */
  viewportHeight: number;
}

/**
 * Fixed-position top for the sheet panel: ideally the replica lines up with
 * the pressed bubble (emoji row directly above it), clamped so the whole
 * panel stays inside the visual viewport. A panel taller than the viewport
 * pins to the top margin — the top of the sheet (emoji row, replica start)
 * is the part that must stay reachable.
 */
export function clampSheetTop(args: SheetTopArgs): number {
  const { anchorTop, emojiRowHeight, panelHeight, viewportTop, viewportHeight } = args;
  const desired = anchorTop - emojiRowHeight - SHEET_GAP_PX;
  const min = viewportTop + SHEET_VIEWPORT_MARGIN_PX;
  const max = viewportTop + viewportHeight - panelHeight - SHEET_VIEWPORT_MARGIN_PX;
  if (max < min) return min;
  return Math.min(Math.max(desired, min), max);
}
