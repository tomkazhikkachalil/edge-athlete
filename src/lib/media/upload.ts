/**
 * The one post-media upload call (browser-only). Replaces the FormData block
 * that was copy-pasted across five surfaces. Editor output or original file
 * in, public URL out — auth comes from the session cookie server-side.
 *
 * Every JPEG is metadata-stripped (lossless, see exif-strip.ts) before it
 * leaves the device: editor-rendered files are already clean (canvas
 * re-encode), but un-edited uploads and the preserved non-destructive
 * originals used to ship phone-camera GPS byte-for-byte. Since Wave 6,
 * MP4/MOV containers get the same treatment via a mediabunny stream-copy
 * re-mux (packets copied, container rewritten — the phone-camera GPS/©xyz
 * and creation atoms don't survive; rotation rides the track matrix, which
 * does). WebM is skipped like non-JPEG images: no phone writes GPS there.
 * Both scrubs fail OPEN — an upload must never die in the scrubber.
 */

import { stripJpegMetadata } from './exif-strip';

export interface UploadedMedia {
  url: string;
  type: 'image' | 'video';
}

async function withoutJpegMetadata(file: File): Promise<File> {
  if (file.type !== 'image/jpeg') return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const out = stripJpegMetadata(bytes);
    if (out === bytes) return file; // nothing to strip
    // TS 5.7 typed-array generics: Uint8Array<ArrayBufferLike> isn't a
    // BlobPart; the array was freshly allocated over a plain ArrayBuffer.
    return new File([out as Uint8Array<ArrayBuffer>], file.name, { type: file.type });
  } catch (err) {
    // Fail open — an upload must never die in the scrubber — but never
    // silently: this is a privacy control.
    console.warn('[upload] JPEG metadata strip failed; uploading as-is:', err);
    return file;
  }
}

/** Containers phones actually write GPS into (MOV ©xyz / MP4 udta+keys). */
const SCRUBBABLE_VIDEO = new Set(['video/mp4', 'video/quicktime']);

async function withoutVideoMetadata(file: File): Promise<File> {
  if (!SCRUBBABLE_VIDEO.has(file.type)) return file;
  try {
    // Dynamic import — house rule (video.ts): mediabunny stays out of every
    // bundle until a video is actually touched. A metadata-only Conversion
    // stream-copies packets (no WebCodecs decode/encode), so this runs even
    // on browsers the editor's trim path can't serve.
    const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat } =
      await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({ input, output });
    // A dropped track (codec the container can't carry and this browser
    // can't transcode) would lose CONTENT to save metadata — wrong trade;
    // upload the original and let the composer's caveat stand for it.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      console.warn('[upload] video metadata strip unsupported for this file; uploading as-is');
      return file;
    }
    await conversion.execute();
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) return file;
    return new File([buffer], file.name.replace(/\.(mov|qt)$/i, '.mp4'), { type: 'video/mp4' });
  } catch (err) {
    // Fail open, never silently — this is a privacy control (JPEG stance).
    console.warn('[upload] video metadata strip failed; uploading as-is:', err);
    return file;
  }
}

/**
 * `targetProfileId`: set when a guardian uploads media that will belong to a
 * managed athlete's content (acting-as). The server validates it with the
 * acting-as gate and keys storage to the ATHLETE's prefix — omitting it on an
 * acting-as upload mis-attributes the bytes to the guardian.
 */
export async function uploadPostMedia(file: File, targetProfileId?: string): Promise<UploadedMedia> {
  const formData = new FormData();
  const scrubbed = file.type.startsWith('video/')
    ? await withoutVideoMetadata(file)
    : await withoutJpegMetadata(file);
  formData.append('file', scrubbed);
  if (targetProfileId) formData.append('targetProfileId', targetProfileId);
  const response = await fetch('/api/upload/post-media', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || 'Failed to upload media');
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image' };
}
