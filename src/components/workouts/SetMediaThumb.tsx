'use client';

import Image from 'next/image';
import { Play } from 'lucide-react';
import { useOptimizedSrc } from '@/components/media/useOptimizedSrc';

/**
 * One set-media thumbnail (Oct 4 2026). The URL a set carries is either a
 * media-proxy path (`/api/media/<token>` — what the workouts GET hands
 * every reader) or, for a moment after an upload, a storage URL into the
 * PRIVATE bucket; neither may go through Next's image optimizer, which
 * fetches without the viewer's cookie and 404s — the thumbnails were broken
 * from the Aug 25 bucket flip until this. `useOptimizedSrc` applies the one
 * rule (image-src.ts); a `preview` (the upload's local object URL) wins
 * while it exists, so a photo shows the instant it is attached.
 */
export default function SetMediaThumb({
  url,
  type,
  preview,
  size = 48,
  className = 'w-full h-full object-cover',
}: {
  url: string;
  type: 'image' | 'video';
  preview?: string;
  size?: number;
  className?: string;
}) {
  const shown = preview ?? url;
  const optimized = useOptimizedSrc(shown);
  if (type === 'video') {
    return (
      <>
        <video src={shown} muted playsInline preload="metadata" className={className} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <Play className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true" />
        </span>
      </>
    );
  }
  return (
    <Image
      src={optimized.src ?? shown}
      alt="Set media"
      width={size}
      height={size}
      className={className}
      unoptimized={optimized.unoptimized}
      onError={optimized.onError}
    />
  );
}
