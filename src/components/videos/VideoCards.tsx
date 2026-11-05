'use client';

import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import type { VideoView } from '@/lib/videos/types';

/**
 * The cards (Videos program, 296): the YouTube poster, the title, the
 * marker count, where it was played, and the hidden chip a manager sees.
 * One card for every surface — the profile tab, the org bubble, the event
 * tab, the contest section — so a video reads the same everywhere.
 */
export function VideoCard({ video, priority = false }: { video: VideoView; priority?: boolean }) {
  const n = video.highlight_count;
  return (
    <Link href={`/videos/${video.id}`} className="ea-surface ea-surface-raised block rounded-lg overflow-hidden" data-video-card={video.id}>
      <div className="relative aspect-video bg-surface-muted">
        <LazyImage src={video.thumb_url} alt="" className="absolute inset-0 w-full h-full object-cover" priority={priority} />
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-black/60 text-white">
            <i className="fas fa-play text-sm ml-0.5"></i>
          </span>
        </span>
        {video.status === 'hidden' && (
          <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white" data-video-card-hidden="">
            {video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
          </span>
        )}
        <span className="absolute bottom-2 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white" data-video-card-count={n}>
          {n} {n === 1 ? 'highlight' : 'highlights'}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-primary truncate">{video.title}</p>
        {video.place && <p className="mt-0.5 text-xs text-muted truncate">{video.place.name}</p>}
      </div>
    </Link>
  );
}

export function VideoCardGrid({ videos }: { videos: VideoView[] }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-video-grid={videos.length}>
      {videos.map((v, i) => (
        <li key={v.id}>
          <VideoCard video={v} priority={i === 0} />
        </li>
      ))}
    </ul>
  );
}

/** The "Add a full game" door every surface offers its manager. */
export function AddVideoLink({ href, label = 'Add a full game', className = '' }: { href: string; label?: string; className?: string }) {
  return (
    <Link href={href} className={`ea-interactive inline-flex items-center gap-2 border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold ${className}`} data-video-add="">
      <i className="fas fa-film" aria-hidden="true"></i>
      {label}
    </Link>
  );
}
