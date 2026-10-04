'use client';

/**
 * Render a media URL through Next's optimizer when it may be, and fall back
 * to the bare proxy path when the optimizer could not fetch it (speed round
 * 2, Oct 4 2026). The one case that produces a failure: a post went PRIVATE
 * after its public, optimizable URL (`/api/media/o/…`) was minted — the
 * optimizer, which fetches without the viewer's cookie, is refused, while
 * the viewer themself (an approved follower, the owner) may still see the
 * bytes directly. One retry, unoptimized, on the bare path; anything else
 * stays an ordinary broken image.
 */

import { useState } from 'react';
import { bareProxyPath, isOptimizableImageSrc } from '@/lib/media/image-src';

export function useOptimizedSrc(src: string | null | undefined): {
  src: string | null | undefined;
  unoptimized: boolean;
  onError: () => void;
} {
  // The source the fallback was taken for — a new source starts optimistic
  // again by comparison, with no effect needed.
  const [fellBackFor, setFellBackFor] = useState<string | null>(null);
  if (!src) return { src, unoptimized: true, onError: () => {} };
  const optimizable = isOptimizableImageSrc(src);
  if (fellBackFor === src && src.startsWith('/api/media/o/')) {
    return { src: bareProxyPath(src), unoptimized: true, onError: () => {} };
  }
  return {
    src,
    unoptimized: !optimizable,
    onError: () => {
      if (optimizable && src.startsWith('/api/media/o/')) setFellBackFor(src);
    },
  };
}
