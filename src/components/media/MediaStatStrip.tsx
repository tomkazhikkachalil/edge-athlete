'use client';

/**
 * A compact stat strip over the bottom of a post's lead media — the moment,
 * one number, and the context, like a broadcast lower-third.
 *
 * Contrast NEVER relies on the photo: the scrim is always painted, because the
 * media underneath is whatever the athlete shot. A gradient rather than a solid
 * bar so the image still reads through the top of it.
 */

import type { PostHeadline } from '@/lib/sports/post-headline';

interface MediaStatStripProps {
  headline: PostHeadline;
  className?: string;
}

export default function MediaStatStrip({ headline, className = '' }: MediaStatStripProps) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pb-3 pt-10 ${className}`}
    >
      <div className="flex items-end justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-white/90 drop-shadow">
          {headline.moment}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-2xl font-black leading-none text-white drop-shadow tabular-nums">
            {headline.value}
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-white/80 drop-shadow">
            {headline.label}
          </span>
        </span>
      </div>
    </div>
  );
}
