'use client';

/**
 * Full-screen media viewer — the repo's first. `PostDetailModal` is a POST
 * viewer (it renders a whole PostCard on white chrome); there was no way to
 * simply look at a photo. "Tap a thumbnail, open it full screen" needs this.
 *
 * TILES CROP, VIEWERS CONTAIN. The tiles deliberately `object-cover` so a grid
 * never letterboxes — but cropping an image someone opened *in order to look at
 * it* would be wrong, so this uses `object-contain`. The two rules are
 * complementary, not contradictory.
 *
 * Videos DO play here (tiles show a poster instead), which is why this exists
 * as the playback surface.
 */

import { useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import type { CollageItem } from './MediaCollage';

interface MediaLightboxProps {
  items: CollageItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  /** Caption strip, e.g. the segment label ("Hole 3"). */
  footerFor?: (item: CollageItem) => React.ReactNode;
}

export default function MediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  footerFor,
}: MediaLightboxProps) {
  useBodyScrollLock(true);

  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndexChange(next);
    },
    [index, items.length, onIndexChange]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Swipe — same threshold and shape as PostCard's carousel, so the gesture
  // feels identical across the app.
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) < 50) return;
    go(deltaX < 0 ? 1 : -1);
  };

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <div className="flex shrink-0 items-center justify-between p-3 text-white safe-top">
        <span className="text-sm font-semibold tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close media viewer"
          autoFocus
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"
        >
          <i className="fas fa-times text-lg" aria-hidden="true"></i>
        </button>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {item.kind === 'video' ? (
          <video
            key={item.id}
            src={item.url}
            poster={item.thumbnailUrl ?? undefined}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <Image
            key={item.id}
            src={item.url}
            alt={item.alt || 'Media'}
            fill
            sizes="100vw"
            unoptimized={!isOptimizableImageSrc(item.url)}
            className="object-contain"
          />
        )}

        {hasPrev && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <i className="fas fa-chevron-left" aria-hidden="true"></i>
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <i className="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
        )}
      </div>

      {footerFor && (
        <div className="shrink-0 p-4 text-center text-sm font-semibold text-white safe-bottom">
          {footerFor(item)}
        </div>
      )}
    </div>
  );
}
