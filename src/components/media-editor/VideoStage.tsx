'use client';

/**
 * Video editing stage, multi-clip round. Two tools:
 *
 * 'clips'  — the output timeline: clip regions over the source strip
 *            (ClipTimeline), a selected-clip control row (reorder, split,
 *            delete, volume) and frame-accurate stepping. Playback previews
 *            the OUTPUT: it walks the clips in order, jumping the single
 *            <video> element across clip boundaries.
 * 'poster' — scrub the full source strip for the cover frame; posterTime is
 *            stored in TIMELINE space (uncovered scrubs snap to the nearest
 *            covered instant), because the poster is captured from the
 *            RENDERED output at export.
 *
 * Split now adds a clip WITHIN this asset's timeline — one asset renders to
 * ONE stitched video (the old split-into-separate-assets behavior retired
 * with recipe v2).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Scissors,
  StepBack,
  StepForward,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatClipTime, MIN_CLIP_SECONDS } from '@/lib/media/video-math';
import {
  deleteClip,
  materializeClips,
  reorderClip,
  setClipEdge,
  setClipVolume,
  timelineFromSource,
  timelineToSource,
} from '@/lib/media/timeline-math';
import type { VideoRecipe } from '@/lib/media/types';
import ClipTimeline from './ClipTimeline';
import TrimTimeline from './TrimTimeline';
import { useFrameStep } from './useFrameStep';

interface VideoStageProps {
  videoUrl: string;
  file: File;
  recipe: VideoRecipe;
  tool: 'clips' | 'poster';
  canEdit: boolean; // WebCodecs available — clip tools hidden without it
  onPatch: (patch: Partial<VideoRecipe>) => void;
}

export default function VideoStage({
  videoUrl,
  file,
  recipe,
  tool,
  canEdit,
  onPatch,
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0); // SOURCE seconds
  const [playing, setPlaying] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Output-order position while playing across clips.
  const playOrderRef = useRef(0);

  const clips = useMemo(
    () => (duration > 0 ? materializeClips(recipe.clips, duration) : []),
    [recipe.clips, duration]
  );
  const selected = clips[Math.min(selectedIndex, Math.max(0, clips.length - 1))];
  const selectedClamped = Math.min(selectedIndex, Math.max(0, clips.length - 1));

  const { fps, step } = useFrameStep(videoRef, file, mediaTime => setPlayhead(mediaTime));

  // Output-preview playback: when the playhead crosses the current clip's
  // out-point, jump to the next clip's in-point; after the last clip, stop
  // and rewind to the first. (timeupdate stays the coarse playhead source —
  // rVFC above refines it when available.)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setPlayhead(video.currentTime);
      if (video.paused || clips.length === 0) return;
      const current = clips[Math.min(playOrderRef.current, clips.length - 1)];
      if (video.currentTime >= current.out) {
        if (playOrderRef.current + 1 < clips.length) {
          playOrderRef.current += 1;
          video.currentTime = clips[playOrderRef.current].in;
        } else {
          video.pause();
          playOrderRef.current = 0;
          video.currentTime = clips[0].in;
        }
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
  }, [clips]);

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
      if (clips.length > 0) {
        // Start from the selected clip when the playhead sits outside it.
        const start = clips[selectedClamped];
        if (video.currentTime < start.in || video.currentTime >= start.out) {
          video.currentTime = start.in;
        }
        playOrderRef.current = selectedClamped;
      }
      void video.play();
    } else {
      video.pause();
    }
  };

  const patchClips = (next: typeof clips) => onPatch({ clips: next });

  const canSplitHere =
    !!selected &&
    playhead > selected.in + MIN_CLIP_SECONDS &&
    playhead < selected.out - MIN_CLIP_SECONDS;

  const splitSelected = () => {
    if (!selected || !canSplitHere) return;
    const next = [...clips];
    next.splice(
      selectedClamped,
      1,
      { ...selected, out: playhead },
      { ...selected, in: playhead }
    );
    patchClips(next);
  };

  const removeSelected = () => {
    const next = deleteClip(clips, selectedClamped);
    if (!next) return;
    patchClips(next);
    setSelectedIndex(Math.max(0, selectedClamped - 1));
  };

  const move = (direction: -1 | 1) => {
    const to = selectedClamped + direction;
    const next = reorderClip(clips, selectedClamped, to);
    if (next === clips) return;
    patchClips(next);
    setSelectedIndex(to);
  };

  // Poster scrub runs over the SOURCE strip; store timeline space.
  const posterSource =
    clips.length > 0
      ? (timelineToSource(recipe.posterTime, clips)?.sourceTime ?? clips[0]?.in ?? 0)
      : recipe.posterTime;

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

      {tool === 'clips' ? (
        <>
          {!canEdit && (
            <p className="px-4 pt-2 text-chip text-amber-300">
              Video editing isn&apos;t supported on this browser — the original video will
              upload. Poster selection still works.
            </p>
          )}
          {clips.length > 0 && (
            <ClipTimeline
              videoUrl={videoUrl}
              duration={duration}
              clips={clips}
              selectedIndex={selectedClamped}
              playhead={playhead}
              onSelect={setSelectedIndex}
              onScrub={seekTo}
              onEdgeDrag={
                canEdit
                  ? (i, edge, t) => patchClips(setClipEdge(clips, i, edge, t, duration))
                  : () => {}
              }
            />
          )}

          {/* Selected-clip control row. Scrolls, not clips (320px rule). */}
          {canEdit && selected && (
            <div className="flex items-center gap-1 px-4 pb-1 overflow-x-auto scrollbar-hide w-full max-w-xl mx-auto">
              <span className="text-chip text-white/70 tabular-nums shrink-0 mr-1">
                Clip {selectedClamped + 1}/{clips.length} ·{' '}
                {formatClipTime(selected.out - selected.in)}
              </span>
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={selectedClamped === 0}
                aria-label="Move clip earlier"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                disabled={selectedClamped >= clips.length - 1}
                aria-label="Move clip later"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={splitSelected}
                disabled={!canSplitHere}
                aria-label="Split clip at playhead"
                title={canSplitHere ? 'Split at the playhead' : 'Move the playhead inside the clip'}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <Scissors className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={removeSelected}
                disabled={clips.length <= 1}
                aria-label="Delete clip"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  patchClips(setClipVolume(clips, selectedClamped, selected.volume === 0 ? 1 : 0))
                }
                aria-label={selected.volume === 0 ? 'Unmute clip' : 'Mute clip'}
                aria-pressed={selected.volume === 0}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
              >
                {selected.volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(selected.volume * 100)}
                onChange={e =>
                  patchClips(setClipVolume(clips, selectedClamped, Number(e.target.value) / 100))
                }
                aria-label="Clip volume (applies to the exported video)"
                className="w-20 shrink-0 accent-violet-500 min-h-[44px]"
              />
            </div>
          )}

          {/* Frame stepping — sports moments live in half-seconds */}
          <div className="flex items-center gap-2 px-4 pb-2 text-chip text-white/70 w-full max-w-xl mx-auto">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Back one frame"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <StepBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Forward one frame"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <StepForward className="w-4 h-4" />
            </button>
            <span className="tabular-nums">
              {formatClipTime(playhead)} · {Math.round(fps)}fps
            </span>
          </div>
        </>
      ) : (
        <>
          <TrimTimeline
            videoUrl={videoUrl}
            duration={duration}
            trim={null}
            playhead={posterSource}
            showHandles={false}
            onScrub={time => {
              seekTo(time);
              onPatch({
                posterTime:
                  clips.length > 0 ? timelineFromSource(time, clips) : time,
              });
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
