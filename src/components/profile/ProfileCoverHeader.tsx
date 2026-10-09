import Image from 'next/image';
import type { ReactNode } from 'react';

interface ProfileCoverHeaderProps {
  /** The cover's public proxy URL (`coverProxyUrl`), or null for the gradient. */
  coverSrc: string | null;
  /** The avatar. */
  children: ReactNode;
  /** Alignment of the avatar inside the cover (the caller owns layout). */
  className?: string;
}

/**
 * The top of another athlete's profile card: their cover photo, ending just
 * below their profile picture, which floats on it (Tom, Oct 9 2026).
 *
 * The block's padding IS the layout: it keeps the avatar's border off the
 * card's edges and leaves a strip of photo under it, so the photo's height is
 * always the avatar plus that padding. The card above owns the border, radius
 * and `overflow-hidden` that clip the photo.
 */
export default function ProfileCoverHeader({ coverSrc, children, className = '' }: ProfileCoverHeaderProps) {
  return (
    <div className={`relative p-4 sm:p-6 ${className}`}>
      {coverSrc ? (
        <div className="absolute inset-0" data-profile-cover="photo" aria-hidden="true">
          <Image
            // Covers live in the now-private uploads bucket; served via the
            // public per-profile cover endpoint, whose ?v= the optimizer
            // cannot read — so unoptimized.
            src={coverSrc}
            alt=""
            fill
            preload
            sizes="(max-width: 1280px) 100vw, 1232px"
            className="object-cover object-center"
            unoptimized
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 bg-gradient-to-r from-violet-600 via-violet-500 to-purple-500"
          data-profile-cover="gradient"
          aria-hidden="true"
        />
      )}
      <div className="relative w-fit rounded-full shadow-xl" data-profile-avatar="">
        {children}
      </div>
    </div>
  );
}
