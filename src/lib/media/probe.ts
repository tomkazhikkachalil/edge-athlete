// Browser-only metadata probes for export results. Best-effort by contract:
// callers treat null as "don't send dimensions", never as an error — the
// media itself uploads regardless (post_media.width/height/duration are
// nullable and were never written before this).

import { ensureSeekableDuration } from './poster';

export interface MediaDims {
  width: number;
  height: number;
}

export async function probeImageDims(blob: Blob): Promise<MediaDims | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims.width > 0 && dims.height > 0 ? dims : null;
  } catch {
    return null;
  }
}

export interface VideoMeta extends MediaDims {
  durationSeconds: number;
}

export async function probeVideoMeta(blob: Blob): Promise<VideoMeta | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  try {
    await new Promise<void>((resolve, reject) => {
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video could not be loaded'));
      video.src = url;
    });
    // MediaRecorder files report Infinity until force-seeked (poster.ts).
    const duration = await ensureSeekableDuration(video);
    const meta = {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Number.isFinite(duration) ? duration : 0,
    };
    return meta.width > 0 && meta.height > 0 ? meta : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
