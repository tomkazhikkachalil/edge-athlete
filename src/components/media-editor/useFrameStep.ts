'use client';

/**
 * Frame-accurate stepping: real fps from the container's packet stats
 * (mediabunny, lazy — only when WebCodecs exists), 30fps fallback, and a
 * requestVideoFrameCallback loop reporting the exact presented mediaTime
 * (falls back to nothing — callers keep timeupdate as their coarse source).
 * Sports moments live in half-seconds; a scrub that lands "somewhere near"
 * the frame isn't good enough for split/cover placement.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

export function useFrameStep(
  videoRef: RefObject<HTMLVideoElement | null>,
  file: File | null,
  onFrameTime?: (mediaTime: number) => void
) {
  const [fps, setFps] = useState(30);
  // Capture v2 (Sep 2026): the container parse for the real fps used to run
  // on EVERY editor open (a mediabunny demux + packet scan on the main
  // thread, even for a video the user never steps through). It now runs once,
  // on the first frame-step, and the 30fps default serves until then.
  const statsRequestedRef = useRef(false);
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    statsRequestedRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [file]);

  const requestRealFps = () => {
    if (!file || statsRequestedRef.current) return;
    statsRequestedRef.current = true;
    void (async () => {
      try {
        const { isVideoEditingSupported } = await import('@/lib/media/video');
        if (!isVideoEditingSupported()) return;
        const mb = await import('mediabunny');
        const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || cancelledRef.current) return;
        const stats = await track.computePacketStats(100);
        if (!cancelledRef.current && Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0) {
          setFps(stats.averagePacketRate);
        }
      } catch {
        /* 30fps fallback stands */
      }
    })();
  };

  // Precise playhead: rVFC reports the presented frame's mediaTime. The
  // callback rides a ref (updated in an effect — never during render) so the
  // rVFC loop below subscribes once.
  const onFrameTimeRef = useRef(onFrameTime);
  useEffect(() => {
    onFrameTimeRef.current = onFrameTime;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !('requestVideoFrameCallback' in video)) return;
    let handle = 0;
    const loop = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      onFrameTimeRef.current?.(metadata.mediaTime);
      handle = video.requestVideoFrameCallback(loop);
    };
    handle = video.requestVideoFrameCallback(loop);
    return () => video.cancelVideoFrameCallback(handle);
    // videoRef is a ref — the element identity is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (frames: number) => {
    const video = videoRef.current;
    if (!video) return;
    requestRealFps();
    video.pause();
    video.currentTime = Math.max(0, video.currentTime + frames / fps);
  };

  return { fps, step };
}
