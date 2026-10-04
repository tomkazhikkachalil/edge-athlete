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

export interface UploadOptions {
  /** 0..1 as the bytes leave the device (the PUT to storage). */
  onProgress?: (fraction: number) => void;
}

async function readError(response: Response, fallback: string): Promise<string> {
  // Defensive: a gateway 413 / 502 answers plain text or HTML, never JSON.
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload.error === 'string') return payload.error;
  if (response.status === 413) return 'That file is too large to upload';
  return fallback;
}

/** PUT the bytes straight to the signed storage URL, reporting progress. */
function putToStorage(signedUrl: string, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('content-type', file.type);
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.setRequestHeader('x-upsert', 'false');
    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else if (xhr.status === 413) {
        reject(new Error('That file is too large to upload'));
      } else {
        reject(new Error('The upload did not finish — please try again'));
      }
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted — check your connection and try again'));
    xhr.onabort = () => reject(new Error('The upload was cancelled'));
    xhr.send(file);
  });
}

/**
 * `targetProfileId`: set when a guardian uploads media that will belong to a
 * managed athlete's content (acting-as). The server validates it with the
 * acting-as gate and keys storage to the ATHLETE's prefix — omitting it on an
 * acting-as upload mis-attributes the bytes to the guardian.
 *
 * Direct-to-storage (Oct 2026, upload-rules.ts): intent → the bytes go
 * straight from the device to Supabase Storage → complete. The function never
 * carries the file, so Vercel's 4.5 MB request cap no longer applies.
 */
export async function uploadPostMedia(
  file: File,
  targetProfileId?: string,
  options: UploadOptions = {}
): Promise<UploadedMedia> {
  const body = file.type.startsWith('video/') ? file : await withoutJpegMetadata(file);
  const target = targetProfileId ? { targetProfileId } : {};

  const intent = await fetch('/api/upload/post-media/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: body.type, size: body.size, ...target }),
  });
  if (!intent.ok) throw new Error(await readError(intent, 'Failed to upload media'));
  const { path, signedUrl } = (await intent.json()) as { path: string; signedUrl: string };

  await putToStorage(signedUrl, body, options.onProgress);

  const complete = await fetch('/api/upload/post-media/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...target }),
  });
  const payload = complete.ok ? await complete.json().catch(() => ({})) : null;
  if (!complete.ok || !payload?.url) {
    throw new Error(complete.ok ? 'Failed to upload media' : await readError(complete, 'Failed to upload media'));
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image', scrubbed: payload.scrubbed === true };
}

/**
 * The background original (Oct 4 2026): after an edited video's post is
 * created from its RENDER, the untouched original uploads from the device
 * and is attached to the row. Fire-and-forget — it outlives the composer
 * (a plain promise, no component state); every failure is a warning, never
 * the user's problem (re-edit then starts from the render).
 */
export async function attachOriginalInBackground(
  postId: string,
  mediaId: string,
  original: File,
  targetProfileId?: string
): Promise<void> {
  try {
    const { url } = await uploadPostMedia(original, targetProfileId);
    const response = await fetch(`/api/posts/${postId}/media/${mediaId}/source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: url }),
    });
    if (!response.ok) console.warn('[upload] original attach refused:', response.status);
  } catch (err) {
    console.warn('[upload] original upload failed (the render is the post):', err);
  }
}
