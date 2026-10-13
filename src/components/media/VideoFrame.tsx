'use client';

import { useState, type SyntheticEvent } from 'react';
import Image from 'next/image';
import { useOptimizedSrc } from './useOptimizedSrc';
import BlurBox from './BlurBox';
import { formatDuration } from '@/lib/media/duration';
import { canPlayCodec } from '@/lib/media/playback';

// ── THE one video renderer (video posters program, Oct 13 2026) ─────────────
// Tom: videos showed as "a black rectangle with a play button". Every surface
// that shows a video renders THIS, so the rule holds everywhere:
//   • poster first — the stored poster (`thumbnail_url`) as an image; nothing
//     is fetched from the video before a tap;
//   • a LOCAL file (`blob:`) with no poster yet previews itself — a muted,
//     metadata-only <video> costs no network and shows the clip the instant
//     it is attached (Capture v2's tile);
//   • a STORED video with no poster is a branded placeholder with a play
//     glyph — never a black box, never a <video> the browser may not decode
//     (an iPhone HEVC clip paints black on Android);
//   • `playable`: a tap mounts the <video> in place and plays it; the poster
//     stays underneath until the first frame paints. Where a tap OPENS the
//     post (a grid tile, a quoted post) the host passes `playable={false}`.
//   • upload states: `pending` (a progress bar), `failed` (a full-tile
//     "Upload failed — tap to retry" that keeps the local file), `processing`
//     (the poster and a chip until the server's playable file exists —
//     unless THIS device can decode the stored codec (`codec` + canPlayType,
//     PR 8: Safari and a hardware-HEVC Android), which plays it as it is);
//   • `codec` on a READY clip this device cannot decode (an old HEVC row the
//     worker gave up on, read where the worker is off): the still and
//     "Can't play on this device" — never a <video> that paints black.
// The raw <video> stays only in MediaLightbox (autoplay), InAppCamera and the
// editor — `video-frame.test.ts` sweeps every other `<video` out of the tree.
// `data-video-frame` is the one hook: poster | placeholder | preview |
// processing | unplayable | pending | failed | playing.

export type VideoFrameState = 'ready' | 'pending' | 'failed' | 'processing';

interface VideoFrameProps {
  /** The playable URL — a proxy path, a storage URL, or a local `blob:`. */
  src: string;
  /** The stored poster (`thumbnail_url`) or a local poster object URL. */
  poster?: string | null;
  /** The stored ThumbHash (PR 6): painted under the still while it loads. */
  blurHash?: string | null;
  /** The stored codec (261): with `processing`, a device that decodes it plays now; on a ready clip, one that cannot gets the still and a note. */
  codec?: string | null;
  state?: VideoFrameState;
  /** 0..1 while `pending`. */
  progress?: number;
  durationSeconds?: number | null;
  /** A tap plays in place. Default false: the host's own tap target decides. */
  playable?: boolean;
  controls?: boolean;
  fit?: 'cover' | 'contain';
  /** Smaller badges, no duration — a 48 px thumb. */
  compact?: boolean;
  onRetry?: () => void;
  onFirstPlay?: () => void;
  onTimeUpdate?: (e: SyntheticEvent<HTMLVideoElement>) => void;
  /** A local preview's own metadata (width / height / duration) — the composer's tile reads it here, no probe load. */
  onLoadedMetadata?: (e: SyntheticEvent<HTMLVideoElement>) => void;
  alt: string;
  /** MUST carry the size (an `aspect-*` or `h-/w-`), MediaTile's contract. */
  className?: string;
  sizes?: string;
  priority?: boolean;
}

const isLocalUrl = (url: string) => url.startsWith('blob:') || url.startsWith('data:');

export default function VideoFrame({
  src,
  poster,
  blurHash,
  codec,
  state = 'ready',
  progress,
  durationSeconds,
  playable = false,
  controls = true,
  fit = 'cover',
  compact = false,
  onRetry,
  onFirstPlay,
  onTimeUpdate,
  onLoadedMetadata,
  alt,
  className = '',
  sizes = '(max-width: 640px) 100vw, 600px',
  priority = false,
}: VideoFrameProps) {
  const [playing, setPlaying] = useState(false);
  const [painted, setPainted] = useState(false);
  const optimized = useOptimizedSrc(poster ?? null);
  const posterSrc = optimized.src ?? null;
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';
  // The codec rule (PR 8), feature-detected once per render: null = unknown or
  // no media element here (assume playable). A `processing` clip this device
  // decodes is simply READY; a ready clip it cannot decode is unplayable.
  const decodes = codec ? canPlayCodec(codec) : null;
  const effectiveState: VideoFrameState = state === 'processing' && decodes === true ? 'ready' : state;
  const unplayable = effectiveState === 'ready' && decodes === false && !isLocalUrl(src);
  const canPlayHere = playable && effectiveState === 'ready' && !unplayable;
  const localPreview = !posterSrc && isLocalUrl(src);

  const shown: string =
    playing ? 'playing'
    : effectiveState === 'pending' ? 'pending'
    : effectiveState === 'failed' ? 'failed'
    : effectiveState === 'processing' ? 'processing'
    : unplayable ? 'unplayable'
    : posterSrc ? 'poster'
    : localPreview ? 'preview'
    : 'placeholder';

  const badge = (
    <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <span className={`flex items-center justify-center rounded-full bg-black/55 ${compact ? 'h-6 w-6' : 'h-11 w-11'}`}>
        <i className={`fas fa-play text-white ${compact ? 'text-[9px]' : 'text-sm'} pl-0.5`}></i>
      </span>
    </span>
  );

  return (
    <div className={`relative overflow-hidden bg-surface-sunken ${className}`} data-video-frame={shown}>
      {blurHash && <BlurBox hash={blurHash} />}
      {/* The still: the poster, the local preview, or the branded placeholder. */}
      {posterSrc ? (
        <Image
          src={posterSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized={optimized.unoptimized}
          onError={optimized.onError}
          className={`${fitClass} ${playing && painted ? 'invisible' : ''}`}
        />
      ) : localPreview ? (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoadedMetadata}
          className={`absolute inset-0 h-full w-full ${fitClass} ${playing && painted ? 'invisible' : ''}`}
          aria-hidden="true"
        />
      ) : (
        <div
          className={`absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,var(--brand-soft),transparent_70%)] ${playing && painted ? 'invisible' : ''}`}
          aria-hidden="true"
        />
      )}

      {/* Playback, mounted on the tap only. */}
      {playing && (
        <video
          src={src}
          poster={posterSrc ?? undefined}
          autoPlay
          playsInline
          controls={controls}
          preload="auto"
          onPlaying={() => setPainted(true)}
          onTimeUpdate={onTimeUpdate}
          className={`absolute inset-0 h-full w-full ${fitClass}`}
        />
      )}

      {!playing && effectiveState !== 'failed' && effectiveState !== 'pending' && !unplayable && badge}

      {!playing && !compact && typeof durationSeconds === 'number' && durationSeconds > 0 && effectiveState === 'ready' && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {formatDuration(durationSeconds)}
        </span>
      )}

      {effectiveState === 'processing' && !playing && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white" data-video-processing="">
          Processing…
        </span>
      )}

      {unplayable && !playing && (
        <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-[11px] font-semibold text-white" data-video-unplayable="" role="status">
          {compact ? '—' : "This video can't play on this device"}
        </span>
      )}

      {effectiveState === 'pending' && (
        <div
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((progress ?? 0) * 100)}
          className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[11px] font-semibold text-white"
        >
          <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/30">
            <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          {compact ? null : `${Math.round((progress ?? 0) * 100)}%`}
        </div>
      )}

      {effectiveState === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-900/60 px-2 text-center text-xs font-semibold text-white"
          aria-label="Retry upload"
          data-video-retry=""
        >
          <i className="fas fa-rotate-right" aria-hidden="true"></i>
          {!compact && <span>Upload failed — tap to retry</span>}
        </button>
      )}

      {canPlayHere && !playing && (
        <button
          type="button"
          onClick={() => { setPlaying(true); onFirstPlay?.(); }}
          className="absolute inset-0"
          aria-label="Play video"
          data-video-play=""
        />
      )}
    </div>
  );
}
