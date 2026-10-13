'use client';

import Image from 'next/image';
import { useOptimizedSrc } from '@/components/media/useOptimizedSrc';
import VideoFrame from '@/components/media/VideoFrame';

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
  thumbnailUrl,
  blurHash,
  size = 48,
  className = 'w-full h-full object-cover',
}: {
  url: string;
  type: 'image' | 'video';
  preview?: string;
  /** The clip's poster (Oct 13 2026) — the stored one; a local preview previews itself while it uploads. */
  thumbnailUrl?: string | null;
  /** The stored ThumbHash (PR 6) under the thumb. */
  blurHash?: string | null;
  size?: number;
  className?: string;
}) {
  const shown = preview ?? url;
  const optimized = useOptimizedSrc(shown);
  if (type === 'video') {
    // VideoFrame: the poster, else a local preview's own first frame, else
    // the branded placeholder — never a stored <video> in a 48 px thumb.
    return <VideoFrame src={shown} poster={preview ? null : thumbnailUrl} blurHash={preview ? null : blurHash} compact alt="Set video" className="absolute inset-0 h-full w-full" />;
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
