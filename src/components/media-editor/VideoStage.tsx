'use client';

/**
 * Video editing stage: preview with trim-clamped playback, trim tool
 * (timeline handles + split-at-playhead + clear), poster tool (scrub to a
 * frame — capture happens at export via poster.ts, so poster selection
 * works even on browsers where trimming is unavailable).
 */

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Scissors } from 'lucide-react';
import {
  formatClipTime,
  splitRanges,
  type TrimRange,
} from '@/lib/media/video-math';
import type { VideoRecipe } from '@/lib/media/types';
import TrimTimeline from './TrimTimeline';

interface VideoStageProps {
  videoUrl: string;
  recipe: VideoRecipe;
  tool: 'trim' | 'poster';
  canTrim: boolean;
  canSplit: boolean; // room for one more asset AND trimming supported
  onPatch: (patch: Partial<VideoRecipe>) => void;
  onSplit: (first: TrimRange, second: TrimRange) => void;
}

export default function VideoStage({
  videoUrl,
  recipe,
  tool,
  canTrim,
  canSplit,
  onPatch,
  onSplit,
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Trim-clamped playback: play loops within [start, end]
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setPlayhead(video.currentTime);
      const end = recipe.trim?.end ?? Infinity;
      if (!video.paused && video.currentTime >= end) {
        video.currentTime = recipe.trim?.start ?? 0;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [recipe.trim]);

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setPlayhead(time);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const { start, end } = recipe.trim ?? { start: 0, end: duration };
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
      void video.play();
    } else {
      video.pause();
    }
  };

  const range = recipe.trim ?? { start: 0, end: duration };
  const split = duration > 0 ? splitRanges(recipe.trim, playhead, duration) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {/* Wrapper is exactly the video's box, so the play button anchors to
            the video's corner — never floating in the letterbox dead space */}
        <div className="relative inline-flex max-w-full max-h-full">
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            muted
            preload="metadata"
            onLoadedMetadata={e => {
              // MediaRecorder files report Infinity until force-seeked once.
              // currentTarget is nulled after the handler returns — capture it.
              const video = e.currentTarget;
              void import('@/lib/media/poster').then(async ({ ensureSeekableDuration }) =>
                setDuration(await ensureSeekableDuration(video))
              );
            }}
            onClick={togglePlay}
            className="max-w-full max-h-full"
          />
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="absolute bottom-2 left-2 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
        </div>
      </div>

      {tool === 'trim' ? (
        <>
          {!canTrim && (
            <p className="px-4 pt-2 text-chip text-amber-300">
              Trimming isn&apos;t supported on this browser — the original video will upload.
              Poster selection still works.
            </p>
          )}
          <TrimTimeline
            videoUrl={videoUrl}
            duration={duration}
            trim={recipe.trim}
            playhead={playhead}
            showHandles={canTrim}
            onTrimChange={canTrim ? trim => onPatch({ trim }) : undefined}
            onScrub={seekTo}
          />
          <div className="flex items-center gap-3 px-4 pb-2 text-chip text-white/70 w-full max-w-xl mx-auto">
            <span className="tabular-nums">
              {formatClipTime(range.start)} – {formatClipTime(range.end)}
              {duration > 0 && ` (${formatClipTime(range.end - range.start)})`}
            </span>
            {recipe.trim && (
              <button
                type="button"
                onClick={() => onPatch({ trim: null })}
                className="inline-flex items-center underline hover:text-white active:text-white min-h-[44px]"
              >
                Clear trim
              </button>
            )}
            <button
              type="button"
              disabled={!canSplit || !split}
              onClick={() => split && onSplit(split[0], split[1])}
              className="ml-auto inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-full bg-white/10 text-white disabled:opacity-40 hover:bg-white/20"
              title={!canSplit ? 'Splitting unavailable' : !split ? 'Move the playhead inside the clip' : 'Split into two clips at the playhead'}
            >
              <Scissors className="w-4 h-4" /> Split
            </button>
          </div>
        </>
      ) : (
        <>
          <TrimTimeline
            videoUrl={videoUrl}
            duration={duration}
            trim={null}
            playhead={recipe.posterTime}
            showHandles={false}
            onScrub={time => {
              seekTo(time);
              onPatch({ posterTime: time });
            }}
          />
          <p className="px-4 pb-2 text-chip text-white/70 w-full max-w-xl mx-auto">
            Drag on the timeline to pick the cover frame ({formatClipTime(recipe.posterTime)}).
          </p>
        </>
      )}
    </div>
  );
}
