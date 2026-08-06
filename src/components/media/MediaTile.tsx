'use client';

/**
 * One media tile: a fixed box, with the media cropped to FILL it.
 *
 * THE CONTRACT: the caller's `className` supplies the aspect ratio; this
 * component never contributes an intrinsic size. That is the fix for the
 * letterboxing bug — the old grid passed `LazyImage` a `width={200}
 * height={200}`, which becomes an inline `style="width:200px;height:200px"`,
 * and inline styles beat `w-full h-full`. The image sized the container, so a
 * single photo sat in a box twice its width with empty cells beside it.
 *
 * `fill` is what makes that impossible to reintroduce: there is no width/height
 * in this component's API, so no intrinsic size can leak out. Always pass an
 * `aspect-*` (or otherwise sized) className.
 *
 * VIDEOS RENDER AS A POSTER IMAGE, not a <video>. A grid of <video> elements
 * each preloading metadata is slow, and a .mov/HEVC clip the browser cannot
 * decode paints a black tile that reads as broken. Playback belongs in the
 * lightbox, where there is room for controls.
 */

import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { formatDuration } from '@/lib/media/duration';

interface MediaTileProps {
  src: string;
  /** Poster frame for videos. Ignored for images. */
  thumbnailUrl?: string | null;
  kind: 'image' | 'video';
  alt: string;
  /** Seconds. Renders a duration badge when present and > 0. */
  durationSeconds?: number | null;
  /** Rendered above the media (e.g. a "+5" overflow veil or a segment badge). */
  overlay?: React.ReactNode;
  onClick?: () => void;
  priority?: boolean;
  /** Responsive hint for the optimizer. Default suits a small grid tile. */
  sizes?: string;
  /** MUST carry the aspect ratio, e.g. "aspect-square" or "aspect-[4/3]". */
  className?: string;
}

export default function MediaTile({
  src,
  thumbnailUrl,
  kind,
  alt,
  durationSeconds,
  overlay,
  onClick,
  priority = false,
  sizes = '(max-width: 640px) 33vw, 200px',
  className = '',
}: MediaTileProps) {
  const isVideo = kind === 'video';
  // A video with no poster predates poster capture; show a neutral tile rather
  // than a broken/black one. Images always render their own src.
  const imageSrc = isVideo ? thumbnailUrl : src;

  const body = (
    <>
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          // Repo rule: anything the optimizer cannot fetch must opt out, or
          // /_next/image 400s and the tile renders broken.
          unoptimized={!isOptimizableImageSrc(imageSrc)}
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-stone-800">
          <i className="fas fa-video text-faint text-lg" aria-hidden="true"></i>
        </div>
      )}

      {isVideo && (
        <>
          <span
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55">
              <i className="fas fa-play text-white text-xs pl-0.5"></i>
            </span>
          </span>
          {typeof durationSeconds === 'number' && durationSeconds > 0 && (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
              {formatDuration(durationSeconds)}
            </span>
          )}
        </>
      )}

      {overlay}
    </>
  );

  const boxClass = `relative overflow-hidden bg-surface-sunken ${className}`;

  // Stable hook for verification. Browser checks have to assert on RENDERED
  // GEOMETRY (a crop bug is invisible to "is the image present?"), and matching
  // on `img[src*=...]` also catches the site logo and every avatar, which
  // produced false failures. Cheap to keep, and it documents intent.
  const marker = { 'data-media-tile': kind };

  if (!onClick) return <div className={boxClass} {...marker}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      // `block` only — NOT `w-full`. A width baked in here fights any width the
      // caller sets (the scorecard band wants a 36px tile in a table cell), and
      // Tailwind precedence comes from stylesheet order, not class order, so
      // the caller could not reliably win. Grid callers stretch by default.
      className={`${boxClass} block`}
      aria-label={alt}
      {...marker}
    >
      {body}
    </button>
  );
}
