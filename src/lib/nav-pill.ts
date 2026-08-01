/**
 * Geometry for the sliding nav pill.
 *
 * Pure and separated from the component for one reason: this repo has no jsdom,
 * so a component's rendering cannot be unit-tested at all — but the arithmetic
 * that decides where the pill lands can be, and it is the part that will break
 * silently when someone adds a nav item.
 *
 * No animation library is involved. The pill is one absolutely-positioned
 * element whose `transform` and `width` come from the measured box of the
 * active item, with a CSS transition doing the sliding. The global
 * `prefers-reduced-motion` rule in globals.css zeroes that transition, so
 * motion-sensitive users get an instant, correctly-placed pill for free.
 */

export interface ItemBox {
  /** Offset from the nav container's left edge, in px. */
  left: number;
  width: number;
}

export interface PillGeometry {
  /** `translateX` for the pill, in px. */
  x: number;
  width: number;
  /** False when no item is active — the caller should hide the pill. */
  visible: boolean;
}

const HIDDEN: PillGeometry = { x: 0, width: 0, visible: false };

/**
 * Where the pill should sit for the given active index.
 *
 * Returns `visible: false` rather than a zero-width pill at x=0 when there is
 * no active item — a route the nav doesn't cover (`/settings`, a guardian
 * page) must show no pill at all, not a sliver parked at the left edge.
 */
export function pillGeometry(
  boxes: ReadonlyArray<ItemBox | null | undefined>,
  activeIndex: number
): PillGeometry {
  if (activeIndex < 0 || activeIndex >= boxes.length) return HIDDEN;

  const box = boxes[activeIndex];
  // A ref that has not attached yet measures as nothing. Hiding is right:
  // showing a zero-width pill would flash a dot on first paint.
  if (!box || box.width <= 0) return HIDDEN;

  return { x: box.left, width: box.width, visible: true };
}

/**
 * Index of the active nav item, or -1.
 *
 * Longest-match wins so a more specific entry beats a broader one regardless of
 * array order — otherwise `/app/followers` could match an earlier `/app` entry.
 */
export function activeNavIndex(
  paths: ReadonlyArray<string>,
  pathname: string | null | undefined,
  isActive: (path: string, pathname: string) => boolean
): number {
  if (!pathname) return -1;

  let bestIndex = -1;
  let bestLength = -1;
  paths.forEach((path, index) => {
    if (isActive(path, pathname) && path.length > bestLength) {
      bestIndex = index;
      bestLength = path.length;
    }
  });
  return bestIndex;
}
