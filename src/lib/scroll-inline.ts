/**
 * `scrollIntoView({ inline: 'nearest' })` for ONE horizontal scroller — the
 * scrollLeft that brings an item into the scroller's visible box by the
 * smallest move. Pure; zero imports.
 *
 * Why not scrollIntoView: it scrolls EVERY scrollable ancestor, the page
 * included, and `block: 'nearest'` is not "don't move vertically" — when the
 * item is below the fold, nearest IS a vertical scroll. The profile's tab
 * strip did exactly that on mount and opened the owner's /athlete ~90–200 px
 * down (Oct 9 2026).
 */
export function nearestScrollLeft(
  current: number,
  view: { left: number; right: number },
  item: { left: number; right: number },
): number {
  if (item.left < view.left) return current + (item.left - view.left);
  if (item.right > view.right) return current + (item.right - view.right);
  return current;
}
