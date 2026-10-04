'use client';

import type { SetMedia } from '@/lib/workouts/entries';
import SetMediaThumb from './SetMediaThumb';

/**
 * Read-only thumbnail strip for a set's media (workout history cards and
 * expanded feed-post details). Click opens the media in a new tab (v1).
 */
export default function SetMediaStrip({ media }: { media: SetMedia[] }) {
  if (media.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      {media.map((item, index) => (
        <a
          key={index}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative w-12 h-12 rounded-lg overflow-hidden bg-surface-sunken block hover:ring-2 hover:ring-violet-400 transition-shadow"
          aria-label={item.type === 'video' ? 'Watch set video' : 'View set photo'}
        >
          <SetMediaThumb url={item.url} type={item.type} />
        </a>
      ))}
    </div>
  );
}
