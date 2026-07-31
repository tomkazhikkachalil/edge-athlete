'use client';

import { useState } from 'react';
import Image from 'next/image';

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

  if (!src || hasError) {
    return fallback || (
      <div
        className={`bg-gray-200 flex items-center justify-center ${className}`}
        style={{ width, height }}
        role="img"
        aria-label={alt}
      >
        <i className="fas fa-image text-gray-400" aria-hidden="true"></i>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Skeleton shown on top until image is ready — fades out on load */}
      {!isLoaded && (
        <div
          className={`absolute inset-0 bg-gray-200 animate-pulse z-10 ${className}`}
          aria-hidden="true"
        />
      )}
      {/* Image always renders so onLoad fires reliably */}
      <Image
        src={src}
        alt={alt}
        width={width || 800}
        height={height || 600}
        className={className}
        style={{ width: width ? `${width}px` : '100%', height: height ? `${height}px` : 'auto', display: 'block' }}
        onLoad={() => setIsLoaded(true)}
        onError={() => { setHasError(true); onError?.(); }}
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
