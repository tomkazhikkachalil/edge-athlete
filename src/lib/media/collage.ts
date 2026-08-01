/**
 * Adaptive collage layout — pure, so the part most likely to regress is the
 * part that is unit-tested.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the CONTAINER defines the box, the
 * image fills it. Never the other way round. The round-media grid used to hand
 * `LazyImage` a `width={200} height={200}`, which that component turns into an
 * INLINE `style="width:200px;height:200px"` — and inline styles beat the
 * `w-full h-full` classes. The grid's auto row track then sized to the image's
 * 200px while the column was only ~90-150px wide, producing a box twice its
 * width with empty cells beside it. Every layout below therefore pins its own
 * aspect ratio, and `MediaTile` renders with `fill` so no intrinsic size can
 * leak back out.
 *
 * Shapes (matching the product spec):
 *   1  → one large tile
 *   2  → side by side
 *   3  → one large + two stacked
 *   4+ → even grid, "+N" on the last visible tile
 */

export interface CollageLayout {
  /** Classes for the grid container, INCLUDING its aspect ratio. */
  containerClass: string;
  /** Per-visible-item classes, index-aligned. */
  itemClasses: string[];
  /** How many items to render (never more than `items.length`). */
  visibleCount: number;
  /** How many are hidden behind the "+N" badge. 0 when nothing is hidden. */
  overflow: number;
}

const EMPTY: CollageLayout = {
  containerClass: '',
  itemClasses: [],
  visibleCount: 0,
  overflow: 0,
};

/**
 * @param count total number of media items available
 * @param max   how many tiles to show before collapsing into "+N" (default 4)
 */
export function collageLayout(count: number, max = 4): CollageLayout {
  if (!Number.isFinite(count) || count <= 0) return EMPTY;

  // A max below 1 would render nothing while claiming overflow; clamp it.
  const cap = Math.max(1, Math.floor(max));
  const visibleCount = Math.min(count, cap);
  const overflow = count - visibleCount;

  // Only the "even grid" shape can show a +N badge; the 1/2/3 shapes are
  // deliberate compositions, so a cap that lands inside them still renders
  // that shape and hides the remainder on its last tile.
  if (visibleCount === 1) {
    return {
      containerClass: 'grid grid-cols-1 gap-1',
      itemClasses: ['aspect-[4/3]'],
      visibleCount,
      overflow,
    };
  }

  if (visibleCount === 2) {
    return {
      containerClass: 'grid grid-cols-2 gap-1',
      itemClasses: ['aspect-square', 'aspect-square'],
      visibleCount,
      overflow,
    };
  }

  if (visibleCount === 3) {
    // The container aspect is load-bearing: it defines both row tracks, so a
    // tall image in the large cell cannot stretch the whole collage.
    return {
      containerClass: 'grid grid-cols-3 grid-rows-2 gap-1 aspect-[3/2]',
      itemClasses: ['col-span-2 row-span-2', 'col-span-1', 'col-span-1'],
      visibleCount,
      overflow,
    };
  }

  // 4 or more: even 2x2. Same reason for the container aspect.
  return {
    containerClass: 'grid grid-cols-2 grid-rows-2 gap-1 aspect-square',
    itemClasses: Array.from({ length: visibleCount }, () => ''),
    visibleCount,
    overflow,
  };
}
