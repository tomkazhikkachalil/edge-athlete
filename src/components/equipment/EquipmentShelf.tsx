'use client';

import type { ReactNode } from 'react';

/**
 * A shelf of equipment cards: ONE list of children, one container whose
 * classes switch by breakpoint — no duplicate DOM.
 *
 *   - below lg: the familiar responsive grid (mobile flow unchanged)
 *   - lg+: a horizontal strip (the canonical LiveNowStrip pattern —
 *     overflow-x-auto + scrollbar-hide + shrink-0 cards; the partially
 *     cut-off card IS the "more here" affordance, no snap, no arrows)
 *
 * `expanded` swaps the strip back to a grid IN PLACE ("See all N ›" lives in
 * the caller's header via `overflowCount`); with few items the strip simply
 * doesn't scroll, so no special-casing.
 */

interface EquipmentShelfProps {
  children: ReactNode;
  /** lg+: render as grid instead of strip (the "See all" expanded state). */
  expanded?: boolean;
}

/** How many cards fit a ~940px shelf before "See all N ›" appears. */
export const SHELF_VISIBLE_COUNT = 4;

export default function EquipmentShelf({ children, expanded = false }: EquipmentShelfProps) {
  return (
    <div
      className={
        expanded
          ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4'
          : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 lg:flex lg:gap-3 lg:overflow-x-auto lg:pb-1 lg:scrollbar-hide'
      }
    >
      {children}
    </div>
  );
}

/**
 * Card wrapper that gives shelf mode its fixed card width. Layout classes
 * live HERE, not in shared card/shelf classes (the .ea-icon-btn lesson:
 * shared classes must never own display/width).
 */
export function ShelfCard({ children, expanded = false }: { children: ReactNode; expanded?: boolean }) {
  return (
    <div className={expanded ? '' : 'lg:min-w-[240px] lg:max-w-[260px] lg:flex-shrink-0'}>
      {children}
    </div>
  );
}
