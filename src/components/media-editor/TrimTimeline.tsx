'use client';

/**
 * Scrubbable trim timeline: thumbnail strip, darkened out-of-trim regions,
 * start/end handles, playhead. Handles use Pointer Events +
 * setPointerCapture + touch-action:none (first-class touch — drags never
 * scroll the page).
 */

import { useEffect, useRef, useState } from 'react';
import {
  fractionToTime,
  moveTrimHandle,
  thumbnailTimes,
  timeToFraction,
  type TrimRange,
} from '@/lib/media/video-math';

const THUMB_COUNT = 8;

interface TrimTimelineProps {
  videoUrl: string;
  duration: number;
  trim: TrimRange | null; // null = full clip (no trim set yet)
  playhead: number;
  showHandles: boolean; // false = scrub-only (poster tool / trim unsupported)
  onTrimChange?: (range: TrimRange) => void;
  onScrub: (time: number) => void;
}

export default function TrimTimeline({
  videoUrl,
  duration,
  trim,
  playhead,
  showHandles,
  onTrimChange,
  onScrub,
}: TrimTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);

  // Thumbnail strip: sequential seeks through ONE reused low-res canvas
  useEffect(() => {
    if (!videoUrl || duration <= 0) return;
    let cancelled = false;
    (async () => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('thumbnail video load failed'));
      }).catch(() => undefined);
      if (cancelled || !video.videoWidth) return;
      // MediaRecorder files report Infinity until force-seeked once
      const { ensureSeekableDuration } = await import('@/lib/media/poster');
      await ensureSeekableDuration(video);
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      const height = 56;
      canvas.height = height;
      canvas.width = Math.max(1, Math.round((video.videoWidth / video.videoHeight) * height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const urls: string[] = [];
      for (const time of thumbnailTimes(duration, THUMB_COUNT)) {
        if (cancelled) break;
        await new Promise<void>(resolve => {
          video.onseeked = () => resolve();
          video.currentTime = time;
        });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        urls.push(canvas.toDataURL('image/jpeg', 0.5));
      }
      canvas.width = 0;
      canvas.height = 0;
      video.src = '';
      if (!cancelled) setThumbs(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, duration]);

  const range = trim ?? { start: 0, end: duration };
  const startF = timeToFraction(range.start, duration);
  const endF = timeToFraction(range.end, duration);
  const playheadF = timeToFraction(playhead, duration);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return fractionToTime((clientX - rect.left) / rect.width, duration);
  };

  const dragHandle = (handle: 'start' | 'end') => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onTrimChange) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      onTrimChange(moveTrimHandle(trim ?? { start: 0, end: duration }, handle, timeAt(ev.clientX), duration));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    onScrub(timeAt(e.clientX));
    const move = (ev: PointerEvent) => onScrub(timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div className="px-4 py-2 select-none">
      <div
        ref={trackRef}
        onPointerDown={scrub}
        className="relative h-14 rounded-lg overflow-hidden bg-white/10 touch-none cursor-pointer"
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
      >
        <div className="absolute inset-0 flex">
          {thumbs.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" className="h-full flex-1 object-cover min-w-0" draggable={false} />
          ))}
        </div>

        {/* Out-of-trim shading */}
        {showHandles && (
          <>
            <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: `${startF * 100}%` }} />
            <div className="absolute inset-y-0 right-0 bg-black/70" style={{ width: `${(1 - endF) * 100}%` }} />
            <div
              className="absolute inset-y-0 border-y-2 border-blue-500 pointer-events-none"
              style={{ left: `${startF * 100}%`, width: `${(endF - startF) * 100}%` }}
            />
          </>
        )}

        {/* Playhead */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white shadow pointer-events-none"
          style={{ left: `${playheadF * 100}%` }}
        />

        {/* Trim handles (44px touch hitbox, visually slimmer) */}
        {showHandles && (
          <>
            <button
              type="button"
              aria-label="Trim start"
              onPointerDown={dragHandle('start')}
              className="absolute inset-y-0 w-11 -ml-[22px] flex items-center justify-center touch-none cursor-ew-resize"
              style={{ left: `${startF * 100}%` }}
            >
              <span className="w-1.5 h-full bg-blue-500 rounded-full" />
            </button>
            <button
              type="button"
              aria-label="Trim end"
              onPointerDown={dragHandle('end')}
              className="absolute inset-y-0 w-11 -ml-[22px] flex items-center justify-center touch-none cursor-ew-resize"
              style={{ left: `${endF * 100}%` }}
            >
              <span className="w-1.5 h-full bg-blue-500 rounded-full" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
