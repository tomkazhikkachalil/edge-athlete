'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useOptimizedSrc } from '@/components/media/useOptimizedSrc';

interface LazyImageProps {
  src?: string | null;
  alt: string;
  fallback?: React.ReactNode;
  className?: string;
  width?: number;
  height?: number;
  onError?: () => void;
  priority?: boolean;
}

export default function LazyImage({
  src,
  alt,
  fallback,
  className = '',
  width,
  height,
  onError,
  priority = false
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Optimized when the URL is the proxy's public form; the bare path on a failed optimized load.
  const optimized = useOptimizedSrc(src ?? undefined);

  if (!src || hasError) {
    return fallback || (
      <div
        className={`bg-gray-200 dark:bg-stone-800 flex items-center justify-center ${className}`}
        style={{ width, height }}
        // A decorative image (empty alt) is hidden from assistive tech; a named one keeps its name.
        {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      >
        <i className="fas fa-image text-faint" aria-hidden="true"></i>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Skeleton shown on top until image is ready — fades out on load */}
      {!isLoaded && (
        <div
          className={`absolute inset-0 bg-gray-200 dark:bg-stone-800 animate-pulse z-10 ${className}`}
          aria-hidden="true"
        />
      )}
      {/* Image always renders so onLoad fires reliably */}
      <Image
        src={optimized.src ?? src}
        alt={alt}
        width={width || 800}
        height={height || 600}
        className={className}
        style={{ width: width ? `${width}px` : '100%', height: height ? `${height}px` : 'auto', display: 'block' }}
        // The optimizer fetches server-side without the viewer's cookie, so it
        // can't fetch proxied private media (and external avatars); render
        // those as-is. The proxy's PUBLIC form (/api/media/o/) is optimized,
        // and a failed optimized load retries the bare path (speed round 2).
        unoptimized={optimized.unoptimized}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (optimized.src?.startsWith('/api/media/o/')) {
            optimized.onError(); // one retry on the bare path, not an error yet
            return;
          }
          setHasError(true);
          onError?.();
        }}
        // NOT renamed to `preload`. This component already expresses its
        // intent through `loading`, and Next 16's own guidance is to prefer
        // loading="eager" / fetchPriority="high" over preload in most cases.
        // Setting both was contradictory — a preload <link> alongside
        // loading="lazy" is exactly the conflict the rename exists to expose.
        // `priority` stays on LazyImageProps as this component's public API.
        loading={priority ? 'eager' : 'lazy'}
      />
    </div>
  );
}
