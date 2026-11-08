'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { embedSrcAt, thumbUrl, watchUrl } from '@/lib/videos/youtube';
import { PLAYER_HOST, PLAYER_TICK_MS, type PlayerMode } from '@/lib/videos/player-rules';
import { loadYouTubeApi, type YTPlayer } from '@/lib/videos/youtube-player-api';
import FaIcon from '@/components/FaIcon';
import { faPlay } from '@/lib/icons/fa/play';

/**
 * The one YouTube player (Videos program, 296; polish B, Nov 6 2026):
 * click-to-play — the i.ytimg.com poster first (a phone never pays for a
 * player it did not ask for), then YouTube's frame on tap. With YouTube's
 * IFrame Player API when it answers (loaded by trusted code under the CSP's
 * 'strict-dynamic' — no host added, nothing parser-inserted): the page then
 * knows the playhead — "Mark this moment", "Play highlights", resume — and a
 * highlight tap SEEKS instead of remounting. When the API does not answer in
 * time, or fails, the plain embed renders exactly as before (a highlight
 * remounts the frame at its start through `playKey`). An unavailable,
 * private or embedding-disabled video shows YouTube's own notice inside the
 * frame; the line under it opens the watch page. The frame host stays
 * youtube-nocookie.com (EMBED_FRAME_HOSTS).
 */
export interface YouTubePlayerHandle {
  /** The playhead in ms, or null when the player is not the API's (or not playing yet). */
  currentMs(): number | null;
  seekTo(ms: number, play?: boolean): void;
  mode(): PlayerMode | null;
}

interface Props {
  /** Try YouTube's IFrame API (the video page); off it — the feed card, the message poster — the plain frame on tap, as always. */
  api?: boolean;
  videoId: string;
  title: string;
  startMs: number | null;
  playKey: number;
  /** The playhead, every PLAYER_TICK_MS while playing (API mode only). */
  onTime?: (ms: number) => void;
  onPlaying?: (playing: boolean) => void;
  onEnded?: () => void;
  onMode?: (mode: PlayerMode) => void;
  /** Rendered over the poster (the resume chip). */
  overlay?: React.ReactNode;
}

const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer({ api = false, videoId, title, startMs, playKey, onTime, onPlaying, onEnded, onMode, overlay }, ref) {
  const [tapped, setTapped] = useState(false);
  const [mode, setMode] = useState<PlayerMode | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cbs = useRef({ onTime, onPlaying, onEnded, onMode });
  useEffect(() => {
    cbs.current = { onTime, onPlaying, onEnded, onMode };
  });
  // Playing is derived: the poster's tap, or any highlight tap (playKey > 0).
  const playing = tapped || playKey > 0;
  const seek = startMs !== null && startMs > 0;

  // The API, once, after the first tap; the plain frame when it does not answer.
  useEffect(() => {
    if (!playing || mode !== null) return;
    let live = true;
    (api ? loadYouTubeApi() : Promise.reject(new Error('plain frame')))
      .then(YT => {
        if (!live || !mountRef.current) return;
        const stopTick = () => {
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
        };
        playerRef.current = new YT.Player(mountRef.current, {
          host: PLAYER_HOST,
          videoId,
          playerVars: { rel: 0, autoplay: 1, playsinline: 1, ...(seek ? { start: Math.floor(startMs / 1000) } : {}) },
          events: {
            onReady: () => {
              if (!live) return;
              setMode('api');
              cbs.current.onMode?.('api');
            },
            onStateChange: e => {
              if (!live) return;
              const isPlaying = e.data === YT.PlayerState.PLAYING;
              cbs.current.onPlaying?.(isPlaying);
              stopTick();
              if (isPlaying) {
                tickRef.current = setInterval(() => {
                  const p = playerRef.current;
                  if (p) cbs.current.onTime?.(Math.round(p.getCurrentTime() * 1000));
                }, PLAYER_TICK_MS);
              }
              if (e.data === YT.PlayerState.ENDED) cbs.current.onEnded?.();
            },
            onError: () => {
              /* YouTube's own notice shows inside the frame */
            },
          },
        });
      })
      .catch(() => {
        if (!live) return;
        setMode('frame');
        cbs.current.onMode?.('frame');
      });
    return () => {
      live = false;
    };
    // The API is tried once per mount; the id and the start are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Unmount: stop the tick, destroy the player.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    try {
      playerRef.current?.destroy();
    } catch {
      /* already gone */
    }
    playerRef.current = null;
  }, []);

  // A highlight tap in API mode seeks; the frame mode remounts through `key`.
  useEffect(() => {
    if (mode !== 'api' || playKey === 0 || !seek) return;
    playerRef.current?.seekTo(startMs / 1000, true);
    playerRef.current?.playVideo();
  }, [playKey, startMs, seek, mode]);

  useImperativeHandle(ref, () => ({
    currentMs: () => (mode === 'api' && playerRef.current ? Math.round(playerRef.current.getCurrentTime() * 1000) : null),
    seekTo: (ms, play = true) => {
      if (mode !== 'api' || !playerRef.current) return;
      playerRef.current.seekTo(ms / 1000, true);
      if (play) playerRef.current.playVideo();
    },
    mode: () => mode,
  }), [mode]);

  const frameSrc = seek ? embedSrcAt(videoId, startMs) : `${embedSrcAt(videoId, null)}&autoplay=1`;
  return (
    <div data-video-player={videoId} data-video-start={seek ? Math.floor(startMs / 1000) : 0} data-video-player-mode={mode ?? (playing ? 'loading' : 'poster')}>
      {playing ? (
        <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
          {mode === 'frame' ? (
            <iframe
              key={playKey}
              src={frameSrc}
              title={title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            // The API replaces this element with its iframe; until it answers (or fails) the box is black, as a frame would be while loading.
            <div ref={mountRef} className="w-full h-full" aria-label={title} />
          )}
        </div>
      ) : (
        <div className="relative">
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
                <FaIcon icon={faPlay} className="text-lg ml-1" />
              </span>
            </span>
          </button>
          {overlay}
        </div>
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
});

export default YouTubePlayer;
