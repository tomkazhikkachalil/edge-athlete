/**
 * Video trim via mediabunny (WebCodecs) — browser-only, and mediabunny is
 * ONLY ever loaded through `await import()` so it stays out of every bundle
 * until someone actually trims a video.
 *
 * Chosen for mobile: hardware-accelerated encode, no 31MB wasm download, no
 * COOP/COEP headers (which would break cross-origin Supabase/Giphy media).
 * Browsers without WebCodecs keep poster selection (plain canvas — see
 * poster.ts); trimming degrades to uploading the original.
 */

import type { TrimRange } from './video-math';

/** Cheap synchronous capability gate for showing/hiding trim UI. */
export function isVideoEditingSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window
  );
}

export interface TrimResult {
  blob: Blob;
  mime: 'video/mp4';
}

/**
 * Re-encode `file` to an mp4 containing only [start, end]. Throws when the
 * conversion is invalid for this file/browser (caller falls back to the
 * original file) — exactness over keyframe-snapped copying is deliberate:
 * users expect the trim they set, not the nearest keyframe.
 */
export async function trimVideo(
  file: File,
  range: TrimRange,
  onProgress?: (fraction: number) => void
): Promise<TrimResult> {
  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat } =
    await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: range.start, end: range.end },
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map(t => t.reason).join(', ');
    throw new Error(`Video cannot be trimmed on this browser (${reasons || 'unsupported'})`);
  }
  if (onProgress) conversion.onProgress = fraction => onProgress(fraction);

  await conversion.execute();
  const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
  if (!buffer) throw new Error('Trim produced no output');
  return { blob: new Blob([buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
}
