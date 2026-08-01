'use client';

/**
 * An even grid of every item — the "show me all of it" surface.
 *
 * Deliberately a SEPARATE component from `MediaCollage`, which is a capped
 * teaser that composes 1/2/3/4+ into a deliberate shape and collapses the rest
 * behind "+N". Giving one component an "unbounded" mode would make both harder
 * to read for no gain: the two have genuinely different jobs.
 */

import MediaTile from './MediaTile';
import type { CollageItem } from './MediaCollage';

interface MediaGridProps {
  items: CollageItem[];
  /** Receives the index within THIS array. */
  onSelect?: (index: number) => void;
  className?: string;
}

export default function MediaGrid({ items, onSelect, className = '' }: MediaGridProps) {
  if (items.length === 0) return null;

  return (
    <div className={`grid grid-cols-3 sm:grid-cols-4 gap-2 ${className}`}>
      {items.map((item, index) => (
        <MediaTile
          key={item.id}
          src={item.url}
          thumbnailUrl={item.thumbnailUrl}
          kind={item.kind}
          durationSeconds={item.durationSeconds}
          alt={item.alt || 'Media'}
          onClick={onSelect ? () => onSelect(index) : undefined}
          className="aspect-square rounded-lg"
        />
      ))}
    </div>
  );
}
