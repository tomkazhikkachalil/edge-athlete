import Image from 'next/image';
import type { ReactNode } from 'react';

/** Half of each avatar size, per breakpoint — the overlap onto the photo. */
const HALF_OVERLAP = {
  /** w-32 · sm:w-40 · lg:w-48 (the /athlete pages) */
  lg: '-mt-16 sm:-mt-20 lg:-mt-24',
  /** w-24 · sm:w-32 (/u/) */
  md: '-mt-12 sm:-mt-16',
} as const;

interface ProfileCoverHeaderProps {
  /** The cover's public proxy URL (`coverProxyUrl`), or null for the gradient. */
  coverSrc: string | null;
  /** Which avatar size sits in the slot — decides the half overlap. */
  size: keyof typeof HALF_OVERLAP;
  /** The avatar (and anything pinned to it, e.g. the owner's upload button). */
  children: ReactNode;
  /** Controls drawn ON the photo (the owner's change-cover button). */
  overlay?: ReactNode;
  /** The avatar row's padding + alignment — match the card body below. */
  rowClassName?: string;
}

/**
 * The top of a profile card (Tom, Oct 9 2026): the cover photo as a 3:1
 * banner, and the profile picture straddling its bottom edge — half on the
 * photo, half on the card — floating with a shadow. One header for the
 * owner's /athlete and both viewer routes (/athlete/[id], /u/[username]).
 *
 * The card around it owns the border, radius and `overflow-hidden` that clip
 * the photo; the avatar row sits above the photo (z-10) so the picture and
 * anything pinned to it stay on top.
 */
export default function ProfileCoverHeader({ coverSrc, size, children, overlay, rowClassName = '' }: ProfileCoverHeaderProps) {
  return (
    <>
      <div className="relative w-full aspect-[3/1] max-h-64" data-profile-cover={coverSrc ? 'photo' : 'gradient'}>
        {coverSrc ? (
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
        ) : (
          <div
            className="w-full h-full bg-gradient-to-r from-violet-600 via-violet-500 to-purple-500"
            aria-hidden="true"
          />
        )}
        {overlay}
      </div>
      <div className={`relative z-10 ${HALF_OVERLAP[size]} ${rowClassName}`}>
        <div className="relative w-fit rounded-full shadow-xl" data-profile-avatar="">
          {children}
        </div>
      </div>
    </>
  );
}
