'use client';

import type { SetMedia } from '@/lib/workouts/entries';
import { stackBadge } from '@/lib/workouts/collage';
import SetMediaThumb from './SetMediaThumb';

// ── A set's images in a posted workout (Oct 17 2026) ────────────────────────
// Tom: one image on its own; several as a stack — the first with "+N" — and
// a tap opens the app's viewer over the post at that set's first image (the
// old strip was a link that opened a bare image in a new window).
// Oct 21 2026 (Training fixes, item 3): ONE size, 64 px — the thumb fills the
// set bubble's height (WorkoutDetailItems) and a round's member bubble
// (GroupDetailCard) alike; `size` is kept for the callers, both read 64.

interface Props {
  media: SetMedia[];
  /** Opens the host's viewer at this set's first image. */
  onOpen: () => void;
  size?: 'set' | 'round';
}

export default function SetImageStack({ media, onOpen, size = 'set' }: Props) {
  if (media.length === 0) return null;
  const first = media[0];
  const badge = stackBadge(media.length);
  const box = size === 'set' ? 'w-16 h-16' : 'w-16 h-16';
  const label = media.length > 1
    ? `View ${media.length} set photos and videos`
    : first.type === 'video' ? 'Watch set video' : 'View set photo';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      data-set-image-stack={media.length}
      className={`relative ${box} shrink-0 rounded-lg overflow-hidden bg-surface-sunken ea-interactive`}
    >
      <SetMediaThumb url={first.url} type={first.type} thumbnailUrl={first.thumbnailUrl} blurHash={first.blurHash} />
      {badge && (
        <span className="absolute bottom-0.5 right-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" data-set-image-more="">
          {badge}
        </span>
      )}
    </button>
  );
}
