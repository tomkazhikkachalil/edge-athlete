/**
 * Video rendering via mediabunny (WebCodecs) — browser-only, and mediabunny
 * is ONLY ever loaded through `await import()` so it stays out of every
 * bundle until someone actually edits a video.
 *
 * Chosen for mobile: hardware-accelerated encode, no 31MB wasm download, no
 * COOP/COEP headers (which would break cross-origin Supabase/Giphy media).
 * Browsers without WebCodecs keep poster selection (plain canvas — see
 * poster.ts); editing degrades to uploading the original.
 *
 * renderVideoRecipe (multi-clip round) is TIERED by cost:
 *   1. single clip, no crop, all-volume-1  → Conversion trim (stream-copies
 *      when in === 0; re-encodes for mid-start trims — pre-existing cost)
 *   2. single clip + crop, volume 1        → one Conversion with trim+crop
 *   3. multi-clip and/or volume ≠ 1        → manual pipeline: CanvasSink per
 *      clip → retimed VideoSamples; PCM gain per clip → retimed
 *      AudioSamples; one Mp4 Output. `await source.add()` IS the
 *      backpressure guard; long edge capped for full re-encodes.
 */

import type { TrimRange } from './video-math';
import type { CropRect, VideoClip, VideoRecipe } from './types';
import { materializeClips, timelineDuration } from './timeline-math';

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

/** Long-edge cap for tier-3 full re-encodes — mobile encode time + memory. */
const RENDER_MAX_DIM = 1280;

/** mediabunny/WebCodecs want even dimensions for avc. */
const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

function toCropRectangle(crop: CropRect) {
  return { left: crop.x, top: crop.y, width: crop.width, height: crop.height };
}

/** Output box for a (possibly cropped) frame, capped to RENDER_MAX_DIM. */
function outputSize(sourceW: number, sourceH: number, crop: CropRect | null) {
  const w = crop ? crop.width : sourceW;
  const h = crop ? crop.height : sourceH;
  const scale = Math.min(1, RENDER_MAX_DIM / Math.max(w, h));
  return { width: even(w * scale), height: even(h * scale) };
}

/** Multiply interleaved f32 PCM in place. Exported for unit tests. */
export function gainPCM(data: Float32Array, volume: number): Float32Array {
  if (volume === 1) return data;
  for (let i = 0; i < data.length; i++) data[i] *= volume;
  return data;
}

/**
 * Render a v2 recipe to one mp4. Callers gate on isVideoEditingSupported()
 * and skip no-op recipes (isNoopRecipe) before calling.
 */
export async function renderVideoRecipe(
  file: File,
  recipe: VideoRecipe,
  duration: number,
  onProgress?: (fraction: number) => void
): Promise<TrimResult> {
  const clips = materializeClips(recipe.clips, duration);
  const singleFullVolume = clips.length === 1 && clips[0].volume === 1;

  // Tier 1: plain trim — keep the existing (stream-copy-eligible) path.
  if (singleFullVolume && !recipe.crop) {
    return trimVideo(file, { start: clips[0].in, end: clips[0].out }, onProgress);
  }

  const mb = await import('mediabunny');

  // Tier 2: single clip + crop → one Conversion does decode/crop/encode.
  if (singleFullVolume && recipe.crop) {
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track');
    const size = outputSize(track.displayWidth, track.displayHeight, recipe.crop);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      trim: { start: clips[0].in, end: clips[0].out },
      video: { crop: toCropRectangle(recipe.crop), width: size.width, height: size.height, fit: 'fill' },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map(t => t.reason).join(', ');
      throw new Error(`Video cannot be reframed on this browser (${reasons || 'unsupported'})`);
    }
    if (onProgress) conversion.onProgress = f => onProgress(f);
    await conversion.execute();
    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer) throw new Error('Reframe produced no output');
    return { blob: new Blob([buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
  }

  // Tier 3: multi-clip / per-clip volume → manual pipeline.
  return renderClipsManually(mb, file, clips, recipe.crop, onProgress);
}

type Mediabunny = typeof import('mediabunny');

async function renderClipsManually(
  mb: Mediabunny,
  file: File,
  clips: VideoClip[],
  crop: CropRect | null,
  onProgress?: (fraction: number) => void
): Promise<TrimResult> {
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('No video track');
  const audioTrack = await input.getPrimaryAudioTrack();

  const size = outputSize(videoTrack.displayWidth, videoTrack.displayHeight, crop);
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
  const videoSource = new mb.VideoSampleSource({ codec: 'avc', quality: mb.QUALITY_MEDIUM });
  output.addVideoTrack(videoSource);
  const audioSource = audioTrack
    ? new mb.AudioSampleSource({ codec: 'aac', quality: mb.QUALITY_MEDIUM })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const total = timelineDuration(clips);
  // Frames re-decode through ONE pooled CanvasSink (constant VRAM); crop is
  // applied at the sink so tier 3 and tier 2 render identically.
  const sink = new mb.CanvasSink(videoTrack, {
    width: size.width,
    height: size.height,
    fit: 'fill',
    ...(crop ? { crop: toCropRectangle(crop) } : {}),
    poolSize: 4,
  });

  let offset = 0;
  for (const clip of clips) {
    for await (const wrapped of sink.canvases(clip.in, clip.out)) {
      const timestamp = offset + Math.max(0, wrapped.timestamp - clip.in);
      const sample = new mb.VideoSample(wrapped.canvas, {
        timestamp,
        duration: wrapped.duration,
      });
      await videoSource.add(sample); // backpressure — never skip the await
      sample.close();
      if (onProgress && total > 0) onProgress(Math.min(0.99, timestamp / total));
    }
    offset += clip.out - clip.in;
  }

  if (audioSource && audioTrack) {
    const audioSink = new mb.AudioSampleSink(audioTrack);
    let audioOffset = 0;
    for (const clip of clips) {
      for await (const sample of audioSink.samples(clip.in, clip.out)) {
        const timestamp = audioOffset + Math.max(0, sample.timestamp - clip.in);
        if (clip.volume === 1) {
          sample.setTimestamp(timestamp);
          await audioSource.add(sample);
          sample.close();
          continue;
        }
        // Per-clip gain: pull interleaved f32 PCM, scale, rewrap. volume 0
        // writes silence — a gap in the audio track would desync players.
        const frameCount = sample.numberOfFrames;
        const data = new Float32Array(frameCount * sample.numberOfChannels);
        sample.copyTo(data, { planeIndex: 0, format: 'f32' });
        gainPCM(data, clip.volume);
        const scaled = new mb.AudioSample({
          data,
          format: 'f32',
          numberOfChannels: sample.numberOfChannels,
          sampleRate: sample.sampleRate,
          timestamp,
        });
        sample.close();
        await audioSource.add(scaled);
        scaled.close();
      }
      audioOffset += clip.out - clip.in;
    }
  }

  await output.finalize();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error('Render produced no output');
  if (onProgress) onProgress(1);
  return { blob: new Blob([buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
}
