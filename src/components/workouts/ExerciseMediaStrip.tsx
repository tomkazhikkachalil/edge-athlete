'use client';

import type { SetMedia } from '@/lib/workouts/entries';
import { moreBadge } from '@/lib/workouts/collage';
import SetMediaThumb from './SetMediaThumb';

// ── An exercise's clips in a posted workout (Training: three changes, Oct 22 2026)
// Tom: a photo or video taken during any set belongs to the EXERCISE as a
// whole, shown together in its bubble at the right of the sets, previews one
// consistent size in every workout, and a bubble only grows because it has
// more sets — never because of its media. So: ONE strip per exercise (or per
// round of a group), 64 px tiles, never taller than one tile. A phone shows
// the first tile with "+N" for the rest; from sm: up to three tiles in a
// row, the last carrying "+N". A tap opens the host's viewer at that clip.
// Replaces SetImageStack (a stack per set, Oct 17–21).

const SHOWN_WIDE = 3;
const TILE = 'relative w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-sunken ea-interactive';
const BADGE = 'absolute bottom-0.5 right-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white';

interface Props {
  media: SetMedia[];
  /** The exercise (or "Circuit round 2") the clips belong to — for the labels. */
  name: string;
  /** Opens the host's viewer at the clip at `index` (in `media` order). */
  onOpen: (index: number) => void;
}

export default function ExerciseMediaStrip({ media, name, onOpen }: Props) {
  if (media.length === 0) return null;
  const tiles = media.slice(0, SHOWN_WIDE);
  const phoneBadge = moreBadge(media.length, 1);
  const wideBadge = moreBadge(media.length, tiles.length);
  const label = (m: SetMedia, i: number) => {
    const verb = m.type === 'video' ? 'Watch' : 'View';
    const noun = m.type === 'video' ? 'video' : 'photo';
    return media.length > 1 ? `${verb} ${name} ${noun} ${i + 1} of ${media.length}` : `${verb} ${name} ${noun}`;
  };
  return (
    <div className="flex shrink-0 self-start gap-1" data-post-exercise-media={media.length}>
      {tiles.map((m, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpen(i)}
          aria-label={label(m, i)}
          data-exercise-media-tile={i + 1}
          className={`${TILE} ${i === 0 ? '' : 'hidden sm:block'}`}
        >
          <SetMediaThumb url={m.url} type={m.type} thumbnailUrl={m.thumbnailUrl} blurHash={m.blurHash} />
          {i === 0 && phoneBadge && (
            <span className={`${BADGE} sm:hidden`} data-set-image-more="">{phoneBadge}</span>
          )}
          {i === tiles.length - 1 && wideBadge && (
            <span className={`${BADGE} hidden sm:block`} data-set-image-more="">{wideBadge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
