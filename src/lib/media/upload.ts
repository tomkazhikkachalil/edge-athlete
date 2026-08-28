/**
 * The one post-media upload call (browser-only). Replaces the FormData block
 * that was copy-pasted across five surfaces. Editor output or original file
 * in, public URL out — auth comes from the session cookie server-side.
 *
 * Every JPEG is metadata-stripped (lossless, see exif-strip.ts) before it
 * leaves the device: editor-rendered files are already clean (canvas
 * re-encode), but un-edited uploads and the preserved non-destructive
 * originals used to ship phone-camera GPS byte-for-byte. Video containers
 * are NOT touched (Wave 1 scope — the composer says so honestly).
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

/**
 * `targetProfileId`: set when a guardian uploads media that will belong to a
 * managed athlete's content (acting-as). The server validates it with the
 * acting-as gate and keys storage to the ATHLETE's prefix — omitting it on an
 * acting-as upload mis-attributes the bytes to the guardian.
 */
export async function uploadPostMedia(file: File, targetProfileId?: string): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('file', await withoutJpegMetadata(file));
  if (targetProfileId) formData.append('targetProfileId', targetProfileId);
  const response = await fetch('/api/upload/post-media', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || 'Failed to upload media');
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image' };
}
