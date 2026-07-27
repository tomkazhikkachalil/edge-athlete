/**
 * Poster-frame capture (browser-only). Deliberately plain <video> seek +
 * drawImage — NO WebCodecs — so poster selection works on every browser,
 * including ones where trimming is unavailable.
 */

import { fitWithin, MAX_CANVAS_DIM } from './limits';

const POSTER_MAX_DIM = 1280;

/**
 * MediaRecorder-produced files (screen recordings, in-browser captures)
 * report duration = Infinity until forced to the end once. Returns the real
 * duration and leaves the element seekable from 0.
 */
export async function ensureSeekableDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise(resolve => {
    const onDurationChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.removeEventListener('durationchange', onDurationChange);
        video.currentTime = 0;
        resolve(video.duration);
      }
    };
    video.addEventListener('durationchange', onDurationChange);
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Video could not be loaded'));
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error('Video seek failed'));
    video.currentTime = Math.min(Math.max(time, 0), Math.max(0, video.duration - 0.05));
  });
}

/** Capture a jpeg poster frame at `timeSec` from a video file. */
export async function capturePoster(file: File, timeSec: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideo(url);
    await ensureSeekableDuration(video);
    await seek(video, timeSec);
    const size = fitWithin(
      Math.min(video.videoWidth, MAX_CANVAS_DIM),
      Math.min(video.videoHeight, MAX_CANVAS_DIM),
      POSTER_MAX_DIM
    );
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(video, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Poster export failed'))), 'image/jpeg', 0.82)
    );
    canvas.width = 0;
    canvas.height = 0;
    video.src = '';
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
