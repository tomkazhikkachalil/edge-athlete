'use client';

import { averageColor, blurHashToDataUrl } from '@/lib/media/blur';

/**
 * The blurred placeholder under a picture (video posters PR 6): the hash's
 * average colour at once, its 32 px blurred picture over it. Absolute,
 * filling the host's box — the image or poster paints on top and the box
 * stays beneath (a slow or failed load is never a blank or broken box).
 */
export default function BlurBox({ hash }: { hash: string }) {
  const url = blurHashToDataUrl(hash);
  return (
    <div
      aria-hidden="true"
      data-blur-box=""
      className="absolute inset-0"
      style={{ backgroundColor: averageColor(hash), ...(url ? { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}) }}
    />
  );
}
