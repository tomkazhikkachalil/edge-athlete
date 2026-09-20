'use client';

import { useState } from 'react';

/**
 * A YouTube how-to (Support & Reporting, Spec 3): click-to-play. The
 * thumbnail (i.ytimg.com, img-src https:) renders first; the iframe
 * (youtube-nocookie.com — in the CSP's frame-src through the site builder's
 * EMBED_FRAME_HOSTS) mounts only when tapped — a phone on a golf course
 * never pays for five players it did not ask for.
 */
export default function HelpVideo({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="aspect-video w-full rounded-lg overflow-hidden bg-black" data-help-video-playing={videoId}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="relative aspect-video w-full rounded-lg overflow-hidden bg-surface-muted ea-interactive"
      aria-label={`Play: ${title}`}
      data-help-video={videoId}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
      <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-black/70 text-white">
          <i className="fas fa-play text-lg ml-1" aria-hidden="true"></i>
        </span>
      </span>
    </button>
  );
}
