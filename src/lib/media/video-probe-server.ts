// ── The server-side video probe (video posters PR 7, Oct 13 2026) ───────────
// What a stored video IS: its primary video track's codec (folded to the
// five we store), its display size, its duration and the audio codec —
// through mediabunny, which the scrub already runs in Node (no ffprobe on a
// Vercel function). Null on anything unreadable: the caller treats that as
// "unknown", never as a failure of the upload.

import { foldCodec, type ProbedVideo } from './media-jobs';

export async function probeVideo(bytes: Uint8Array): Promise<ProbedVideo | null> {
  if (bytes.length === 0) return null;
  try {
    const { Input, ALL_FORMATS, BufferSource } = await import('mediabunny');
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const audio = await input.getPrimaryAudioTrack().catch(() => null);
    const duration = await input.computeDuration().catch(() => Number.NaN);
    return {
      codec: foldCodec(video.codec),
      audioCodec: audio?.codec ?? null,
      width: Number.isFinite(video.displayWidth) && video.displayWidth > 0 ? video.displayWidth : null,
      height: Number.isFinite(video.displayHeight) && video.displayHeight > 0 ? video.displayHeight : null,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch (err) {
    console.warn('[media] video probe failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
