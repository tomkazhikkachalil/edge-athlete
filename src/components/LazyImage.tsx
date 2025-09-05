'use client';

import { useState, useRef, useEffect } from 'react';

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
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (priority) return; // Skip lazy loading if priority is set
    
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observerRef.current.observe(imgRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [priority]);

  const handleLoad = () => {
    setIsLoaded(true);
    setHasError(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoaded(false);
    onError?.();
  };

  // If no src or error occurred, show fallback
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
    <div ref={imgRef} className="relative">
      {/* Loading placeholder */}
      {!isLoaded && (
        <div 
          className={`absolute inset-0 bg-gray-200 animate-pulse flex items-center justify-center ${className}`}
          style={{ width, height }}
          aria-hidden="true"
        >
          <i className="fas fa-spinner fa-spin text-gray-400"></i>
        </div>
      )}
      
      {/* Actual image - only load when in view */}
      {isInView && (
        <img
          src={src}
          alt={alt}
          className={`transition-opacity duration-300 ${className} ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ width, height }}
          onLoad={handleLoad}
          onError={handleError}
          loading={priority ? 'eager' : 'lazy'}
        />
      )}
    </div>
  );
}