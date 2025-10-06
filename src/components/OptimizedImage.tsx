/**
 * Optimized Image Component
 * Wrapper around Next.js Image with consistent defaults
 * Automatically handles external URLs from Supabase Storage
 */

import Image from 'next/image';
import { useState } from 'react';

interface OptimizedImageProps {
  src: string | null | undefined;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  fallback?: React.ReactNode;
  quality?: number;
}

export default function OptimizedImage({
  src,
  alt,
  width = 100,
  height = 100,
  className = '',
  priority = false,
  fallback,
  quality = 85,
}: OptimizedImageProps) {
  const [error, setError] = useState(false);

  // If no src or error occurred, show fallback
  if (!src || error) {
    if (fallback) {
      return <>{fallback}</>;
    }
    // Default fallback: gray placeholder
    return (
      <div
        className={`bg-gray-200 flex items-center justify-center ${className}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <span className="text-gray-400 text-xs">No image</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      quality={quality}
      onError={() => setError(true)}
      // Allow images from Supabase Storage and other common sources
      unoptimized={src.startsWith('http') && !src.includes('supabase')}
    />
  );
}

/**
 * Avatar Component - Optimized for profile pictures
 */
export function AvatarImage({
  src,
  alt,
  size = 40,
  className = '',
  fallbackInitials,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number;
  className?: string;
  fallbackInitials?: string;
}) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div
        className={`bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center ${className}`}
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <span className="text-white font-semibold" style={{ fontSize: `${size / 2.5}px` }}>
          {fallbackInitials || '?'}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
      quality={85}
      onError={() => setError(true)}
      unoptimized={src.startsWith('http') && !src.includes('supabase')}
    />
  );
}

/**
 * Media Image Component - For post media, optimized for different sizes
 */
export function MediaImage({
  src,
  alt,
  className = '',
  priority = false,
  fill = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  fill?: boolean;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className={`bg-gray-200 flex items-center justify-center ${className}`}>
        <span className="text-gray-400">Failed to load image</span>
      </div>
    );
  }

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover ${className}`}
        quality={90}
        priority={priority}
        onError={() => setError(true)}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        unoptimized={src.startsWith('http') && !src.includes('supabase')}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={800}
      height={600}
      className={className}
      quality={90}
      priority={priority}
      onError={() => setError(true)}
      style={{ width: '100%', height: 'auto' }}
      unoptimized={src.startsWith('http') && !src.includes('supabase')}
    />
  );
}
