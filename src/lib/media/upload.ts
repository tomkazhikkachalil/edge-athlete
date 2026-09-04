/**
 * Post-media upload (client). Capture v2 (Sep 3 2026) — the phone does NO
 * heavy work here:
 *
 * - JPEG: a byte-level metadata strip that KEEPS the Orientation tag
 *   (exif-strip.ts). Phone-camera GPS never leaves the device; un-edited
 *   portraits stay upright by tag. No decode, no canvas.
 * - Video: nothing client-side. The MP4/MOV metadata scrub (GPS ©xyz, udta)
 *   runs on the SERVER now — src/lib/media/video-scrub-server.ts, inside
 *   /api/upload/post-media, before the storage write. The client re-mux it
 *   replaces loaded the whole file into memory on the main thread of the
 *   phone, N videos at once; that is where a 5-second clip froze. Policy
 *   shift, recorded in the DEVLOG: GPS is scrubbed "before it is stored"
 *   rather than "before it leaves the device" — the bytes transit TLS to our
 *   own function, as the JPEG bytes always did.
 *
 * Every scrub fails OPEN — an upload must never die in the scrubber.
 */

import { stripJpegMetadataKeepOrientation } from './exif-strip';

export interface UploadedMedia {
  url: string;
  type: 'image' | 'video';
  /** True when the server re-muxed the video to drop its metadata. */
  scrubbed?: boolean;
}

async function withoutJpegMetadata(file: File): Promise<File> {
  if (file.type !== 'image/jpeg') return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const out = stripJpegMetadataKeepOrientation(bytes);
    if (out === bytes) return file; // nothing to strip
    return new File([out as BlobPart], file.name, { type: file.type, lastModified: file.lastModified });
  } catch (err) {
    // Fail open, never silently — this is a privacy control.
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
  const scrubbed = file.type.startsWith('video/') ? file : await withoutJpegMetadata(file);
  formData.append('file', scrubbed);
  if (targetProfileId) formData.append('targetProfileId', targetProfileId);
  const response = await fetch('/api/upload/post-media', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || 'Failed to upload media');
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image', scrubbed: payload.scrubbed === true };
}
