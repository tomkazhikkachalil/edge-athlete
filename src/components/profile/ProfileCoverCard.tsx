'use client';

import { useCallback, useState, type ReactNode } from 'react';

interface ProfileCoverCardProps {
  /** The full cover (`coverProxyUrl`), or null for the theme gradient. */
  coverSrc: string | null;
  /** The 32px placeholder (`coverPlaceholderUrl`), painted blurred. */
  placeholderSrc: string | null;
  /** The card's own frame: border, radius, shadow, spacing. Never a fill. */
  className?: string;
  /** The profile details, rendered on the translucent panel. */
  children: ReactNode;
}

/**
 * Another user's profile card with their cover photo filling it edge to edge.
 *
 * The photo layer is `absolute inset-0` inside the card, so the card's
 * `overflow-hidden` + radius clip it and nothing reaches the page around it.
 * The details sit on a theme-following panel (`.profile-glass` behind them,
 * `.profile-panel` around them — globals.css). The glass is a SIBLING of the
 * details, never their ancestor: backdrop-filter on an ancestor would become
 * the containing block of every position:fixed child (FollowButton's confirm,
 * popovers) and trap it inside the card.
 *
 * The full image is lazy; the 32px placeholder paints blurred underneath until
 * it arrives. No theme is read here — the panel is CSS variables only, so a
 * theme toggle repaints it with no flash.
 */
export default function ProfileCoverCard({ coverSrc, placeholderSrc, className = '', children }: ProfileCoverCardProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = coverSrc !== null && loadedSrc === coverSrc;

  // A cached image can finish before hydration attaches onLoad.
  const fullRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && coverSrc && img.complete && img.naturalWidth > 0) setLoadedSrc(coverSrc);
    },
    [coverSrc],
  );

  return (
    <div className={`relative isolate overflow-hidden ${className}`} data-profile-cover-card="">
      <div
        className={`absolute inset-0 -z-10 ${coverSrc ? 'bg-surface-muted' : 'profile-cover-fallback'}`}
        data-profile-cover={coverSrc ? 'photo' : 'gradient'}
        aria-hidden="true"
      >
        {coverSrc && placeholderSrc && !loaded && (
          // eslint-disable-next-line @next/next/no-img-element -- a 32px proxy JPEG painted blurred; the optimizer cannot read a ?v= proxy URL (image-src.ts)
          <img
            src={placeholderSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center scale-110 blur-xl"
          />
        )}
        {coverSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- the cover proxy URL carries ?v=, which the optimizer cannot read (image-src.ts)
          <img
            ref={fullRef}
            src={coverSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedSrc(coverSrc)}
            className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </div>

      {/* The photo shows on its own here, where the banner used to be. */}
      <div className="h-24 sm:h-32" aria-hidden="true" />

      <div className="relative mx-3 mb-3 sm:mx-4 sm:mb-4 rounded-lg" data-profile-panel="">
        <div className="profile-glass absolute inset-0 rounded-lg" aria-hidden="true" />
        <div className="profile-panel relative">{children}</div>
      </div>
    </div>
  );
}
