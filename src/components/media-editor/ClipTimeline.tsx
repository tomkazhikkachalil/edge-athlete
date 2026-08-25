'use client';

/**
 * Multi-clip timeline (recipe v2). The track stays in SOURCE space — the
 * familiar thumbnail strip — with each clip drawn as an outlined region
 * carrying its OUTPUT-ORDER badge (1, 2, 3…). Tap a region to select it;
 * the selected clip gets in/out drag handles (Pointer Events +
 * setPointerCapture, same recipe as TrimTimeline). Regions no clip covers
 * are dimmed: they exist in the source but not in the output.
 */

import { useRef } from 'react';
import { fractionToTime, timeToFraction } from '@/lib/media/video-math';
import type { VideoClip } from '@/lib/media/types';
import { useTimelineThumbs } from './useTimelineThumbs';

interface ClipTimelineProps {
  videoUrl: string;
  duration: number;
  clips: VideoClip[]; // materialized (never [])
  selectedIndex: number;
  playhead: number; // SOURCE seconds
  onSelect: (index: number) => void;
  onScrub: (sourceTime: number) => void;
  onEdgeDrag: (index: number, edge: 'in' | 'out', sourceTime: number) => void;
}

export default function ClipTimeline({
  videoUrl,
  duration,
  clips,
  selectedIndex,
  playhead,
  onSelect,
  onScrub,
  onEdgeDrag,
}: ClipTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbs = useTimelineThumbs(videoUrl, duration);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return fractionToTime((clientX - rect.left) / rect.width, duration);
  };

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const handle = (clientX: number) => {
      const t = timeAt(clientX);
      // Tapping inside a clip selects it too (first covering clip wins).
      const hit = clips.findIndex(c => t >= c.in && t <= c.out);
      if (hit !== -1 && hit !== selectedIndex) onSelect(hit);
      onScrub(t);
    };
    handle(e.clientX);
    const move = (ev: PointerEvent) => handle(ev.clientX);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // Uncurried on purpose (TrimTimeline precedent): invoking during render
  // would make the ref read a render-phase access.
  const dragEdge = (edge: 'in' | 'out', e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onEdgeDrag(selectedIndex, edge, timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const selected = clips[selectedIndex];
  const playheadF = timeToFraction(playhead, duration);

  // Uncovered = in the source but absent from the output; dim it. Built as
  // the complement of the union of clip ranges.
  const covered = [...clips]
    .map(c => ({ start: c.in, end: c.out }))
    .sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const range of covered) {
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (duration > 0 && cursor < duration) gaps.push({ start: cursor, end: duration });

  return (
    <div className="px-4 py-2 select-none w-full max-w-xl mx-auto">
      <div
        ref={trackRef}
        onPointerDown={scrub}
        className="relative h-14 rounded-lg overflow-hidden bg-white/10 touch-none cursor-pointer"
        role="slider"
        aria-label="Clip timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
      >
        <div className="absolute inset-0 flex">
          {thumbs.map((src, i) => (
            // Raw <img>: data: URI canvas frames the optimizer cannot fetch.
            // draggable={false} is load-bearing — the parent is a pointer-drag
            // scrubber, and a native image drag would hijack it.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" className="h-full flex-1 object-cover min-w-0" draggable={false} />
          ))}
        </div>

        {/* Source moments the output no longer contains */}
        {gaps.map((gap, i) => (
          <div
            key={`gap-${i}`}
            className="absolute inset-y-0 bg-black/70 pointer-events-none"
            style={{
              left: `${timeToFraction(gap.start, duration) * 100}%`,
              width: `${(timeToFraction(gap.end, duration) - timeToFraction(gap.start, duration)) * 100}%`,
            }}
          />
        ))}

        {/* Clip regions with output-order badges */}
        {clips.map((clip, i) => {
          const startF = timeToFraction(clip.in, duration);
          const endF = timeToFraction(clip.out, duration);
          const isSelected = i === selectedIndex;
          return (
            <div
              key={`clip-${i}`}
              className={`absolute inset-y-0 pointer-events-none border-y-2 ${
                isSelected ? 'border-violet-500' : 'border-white/40'
              }`}
              style={{ left: `${startF * 100}%`, width: `${(endF - startF) * 100}%` }}
            >
              <span
                className={`absolute top-0.5 left-0.5 min-w-4 h-4 px-0.5 rounded text-[10px] font-bold flex items-center justify-center ${
                  isSelected ? 'bg-violet-500 text-white' : 'bg-black/70 text-white/80'
                }`}
              >
                {i + 1}
              </span>
              {clip.volume === 0 && (
                <i
                  className="fas fa-volume-xmark absolute bottom-0.5 left-0.5 text-[10px] text-white/80"
                  aria-hidden="true"
                ></i>
              )}
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white shadow pointer-events-none"
          style={{ left: `${playheadF * 100}%` }}
        />

        {/* Selected clip's edge handles (44px touch hitbox) */}
        {selected && (
          <>
            <button
              type="button"
              aria-label="Clip start"
              onPointerDown={e => dragEdge('in', e)}
              className="absolute inset-y-0 w-11 -ml-[22px] flex items-center justify-center touch-none cursor-ew-resize"
              style={{ left: `${timeToFraction(selected.in, duration) * 100}%` }}
            >
              <span className="w-1.5 h-full bg-violet-500 rounded-full" />
            </button>
            <button
              type="button"
              aria-label="Clip end"
              onPointerDown={e => dragEdge('out', e)}
              className="absolute inset-y-0 w-11 -ml-[22px] flex items-center justify-center touch-none cursor-ew-resize"
              style={{ left: `${timeToFraction(selected.out, duration) * 100}%` }}
            >
              <span className="w-1.5 h-full bg-violet-500 rounded-full" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
