'use client';

import Image from 'next/image';
import { Play } from 'lucide-react';
import type { SetMedia } from '@/lib/workouts/entries';

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
          className="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 block hover:ring-2 hover:ring-violet-400 transition-shadow"
          aria-label={item.type === 'video' ? 'Watch set video' : 'View set photo'}
        >
          {item.type === 'video' ? (
            <>
              <video src={item.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                <Play className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true" />
              </span>
            </>
          ) : (
            <Image src={item.url} alt="Set media" width={48} height={48} className="w-full h-full object-cover" />
          )}
        </a>
      ))}
    </div>
  );
}
