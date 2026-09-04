'use client';

/**
 * Timeline thumbnail strip: sequential seeks through ONE reused low-res
 * canvas. Extracted from TrimTimeline so ClipTimeline (multi-clip round)
 * shares the exact pipeline.
 */

import { useEffect, useState } from 'react';
import { thumbnailTimes } from '@/lib/media/video-math';

export const THUMB_COUNT = 8;

// Capture v2 (Sep 2026): the strip is computed once per (object URL, duration)
// for the editor's lifetime — the Cover tab used to re-run all eight seeks
// that the Clips tab had just done. Small (8 × ~2KB data URLs per video).
const thumbCache = new Map<string, string[]>();
const MAX_CACHED_VIDEOS = 12;

export function useTimelineThumbs(videoUrl: string, duration: number): string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    if (!videoUrl || duration <= 0) return;
    let cancelled = false;
    const cacheKey = `${videoUrl}|${duration}`;
    (async () => {
      const cached = thumbCache.get(cacheKey);
      if (cached) {
        await Promise.resolve();
        if (!cancelled) setThumbs(cached);
        return;
      }
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
      if (urls.length === THUMB_COUNT) {
        if (thumbCache.size >= MAX_CACHED_VIDEOS) thumbCache.delete(thumbCache.keys().next().value as string);
        thumbCache.set(cacheKey, urls);
      }
      if (!cancelled) setThumbs(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, duration]);

  return thumbs;
}
