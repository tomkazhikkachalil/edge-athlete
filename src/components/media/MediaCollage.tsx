'use client';

/**
 * A capped, adaptive collage — 1 large / 2 side by side / 3 large+stacked /
 * 4+ even grid with a "+N" veil on the last tile.
 *
 * Deliberately SEPARATE from `MediaGrid`: this is a teaser that shows a few
 * items and says how many more there are; `MediaGrid` shows everything evenly.
 * Overloading one component with an "unbounded" mode makes both harder to read.
 *
 * Layout maths live in `@/lib/media/collage` so they are unit-tested; this file
 * is just the rendering.
 */

import { collageLayout } from '@/lib/media/collage';
import MediaTile from './MediaTile';

export interface CollageItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  alt?: string;
}

interface MediaCollageProps {
  items: CollageItem[];
  /** Tiles to show before collapsing the rest into "+N". */
  max?: number;
  /** Receives the index within the FULL items array. */
  onSelect?: (index: number) => void;
  className?: string;
  priorityFirst?: boolean;
  /**
   * Forwarded to every tile. Without it MediaTile falls back to its grid
   * default ('33vw / 200px'), which told the browser to fetch a 200px image
   * for the round-overview HERO in a max-w-6xl modal — visibly soft.
   */
  sizes?: string;
}

export default function MediaCollage({
  items,
  max = 4,
  onSelect,
  className = '',
  priorityFirst = false,
  sizes,
}: MediaCollageProps) {
  const layout = collageLayout(items.length, max);
  if (layout.visibleCount === 0) return null;

  return (
    <div className={`${layout.containerClass} overflow-hidden rounded-lg ${className}`}>
      {items.slice(0, layout.visibleCount).map((item, index) => {
        const isLast = index === layout.visibleCount - 1;
        const showOverflow = isLast && layout.overflow > 0;

        return (
          <MediaTile
            key={item.id}
            src={item.url}
            thumbnailUrl={item.thumbnailUrl}
            kind={item.kind}
            durationSeconds={item.durationSeconds}
            alt={item.alt || 'Round media'}
            sizes={sizes}
            priority={priorityFirst && index === 0}
            onClick={onSelect ? () => onSelect(index) : undefined}
            className={layout.itemClasses[index]}
            overlay={
              showOverflow ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                  <span className="text-xl font-bold text-white">+{layout.overflow}</span>
                </span>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
