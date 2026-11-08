'use client';

import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import { formatLiveWhen, liveBadgeFor } from '@/lib/videos/live-rules';
import { formatTimestamp } from '@/lib/videos/rules';
import type { VideoView } from '@/lib/videos/types';
import FaIcon from '@/components/FaIcon';
import { faFilm } from '@/lib/icons/fa/film';
import { faPlay } from '@/lib/icons/fa/play';

/**
 * The cards (Videos program, 296): the YouTube poster, the title, the
 * marker count, where it was played, and the hidden chip a manager sees.
 * One card for every surface — the profile tab, the org bubble, the event
 * tab, the contest section — so a video reads the same everywhere. Phase 4a:
 * a broadcast's LIVE pill or its scheduled time come from the ROW the API
 * answered — a card never asks YouTube.
 */
export function LivePill({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${className}`} aria-label="Live now">
      <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true"></span>
      Live
    </span>
  );
}

export function VideoCard({ video, priority = false }: { video: VideoView; priority?: boolean }) {
  const n = video.highlight_count;
  const live = liveBadgeFor(video);
  return (
    <Link href={`/videos/${video.id}`} className="ea-surface ea-surface-raised block rounded-lg overflow-hidden" data-video-card={video.id} data-video-card-live={live?.kind ?? undefined}>
      <div className="relative aspect-video bg-surface-muted">
        <LazyImage src={video.thumb_url} alt="" className="absolute inset-0 w-full h-full object-cover" priority={priority} />
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-black/60 text-white">
            <FaIcon icon={faPlay} className="text-sm ml-0.5" />
          </span>
        </span>
        {live?.kind === 'live' && <LivePill className="absolute top-2 right-2" />}
        {video.status === 'hidden' && (
          <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white" data-video-card-hidden="">
            {video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
          </span>
        )}
        <span className="absolute bottom-2 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white" data-video-card-count={n}>
          {n} {n === 1 ? 'highlight' : 'highlights'}
        </span>
        {video.duration_ms !== null && video.duration_ms > 0 && live?.kind !== 'live' && (
          <span className="absolute bottom-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white font-mono" data-video-card-duration={video.duration_ms}>
            {formatTimestamp(video.duration_ms)}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-primary truncate">{video.title}</p>
        {live?.kind === 'upcoming' && <p className="mt-0.5 text-xs font-semibold text-brand-fg truncate">{live.at ? `Live ${formatLiveWhen(live.at)}` : 'Live soon'}</p>}
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
      <FaIcon icon={faFilm} />
      {label}
    </Link>
  );
}
