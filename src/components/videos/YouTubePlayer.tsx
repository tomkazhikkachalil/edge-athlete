'use client';

import { useState } from 'react';
import { embedSrcAt, thumbUrl, watchUrl } from '@/lib/videos/youtube';

/**
 * The one YouTube player (Videos program, 296): click-to-play — the
 * i.ytimg.com poster first (a phone never pays for a player it did not ask
 * for, the help centre's rule), the official responsive embed on tap
 * (youtube-nocookie.com, in the CSP's frame-src through EMBED_FRAME_HOSTS),
 * its controls and branding untouched. A highlight remounts the frame at
 * its start (`playKey` changes → a new iframe with `start=`): a seek to the
 * second, not the frame — the words say so. An unavailable, private or
 * embedding-disabled video shows YouTube's own notice inside the frame; the
 * line under it opens the watch page.
 */
export default function YouTubePlayer({ videoId, title, startMs, playKey }: { videoId: string; title: string; startMs: number | null; playKey: number }) {
  const [tapped, setTapped] = useState(false);
  // Playing is derived: the poster's tap, or any highlight tap (playKey > 0).
  const playing = tapped || playKey > 0;
  const seek = playKey > 0 && startMs !== null && startMs > 0;
  const src = seek ? embedSrcAt(videoId, startMs) : `${embedSrcAt(videoId, null)}&autoplay=1`;
  return (
    <div data-video-player={videoId} data-video-start={seek ? Math.floor(startMs / 1000) : 0}>
      {playing ? (
        <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
          <iframe
            key={playKey}
            src={src}
            title={title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setTapped(true)}
          className="relative aspect-video w-full rounded-lg overflow-hidden bg-surface-muted ea-interactive"
          aria-label={`Play: ${title}`}
          data-video-poster=""
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
          <img src={thumbUrl(videoId)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-black/70 text-white">
              <i className="fas fa-play text-lg ml-1" aria-hidden="true"></i>
            </span>
          </span>
        </button>
      )}
      <p className="mt-2 text-xs text-muted">
        If the video does not play here,{' '}
        <a href={watchUrl(videoId)} target="_blank" rel="noopener noreferrer" className="underline text-secondary" data-video-watch-link="">
          open it on YouTube
        </a>
        .
      </p>
    </div>
  );
}
