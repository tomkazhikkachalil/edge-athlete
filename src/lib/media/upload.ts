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
import { resumableEndpoint, uploadTransportFor, type UploadTransport } from './tus';
import { clearResumeEntry, defaultResumeStorage, readResumeEntry, writeResumeEntry } from './resume-store';

export interface UploadedMedia {
  url: string;
  type: 'image' | 'video';
  /** True when the server re-muxed the video to drop its metadata. */
  scrubbed?: boolean;
  /** True when the server will still convert the file (an iPhone HEVC clip — the media jobs, PR 8). */
  processing?: boolean;
  /** The video track's codec the server read at completion (PR 7). */
  codec?: string;
  /** Phase 2: how the bytes travelled — the plain PUT, or the resumable chunks. */
  transport?: UploadTransport;
}

/** Why an upload failed — the queue decides from it what a reconnect retries. */
export type UploadFailureKind = 'network' | 'offline' | 'refused' | 'too-large';

export class UploadError extends Error {
  readonly kind: UploadFailureKind;
  constructor(kind: UploadFailureKind, message: string) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
  }
}

/** The kind of any thrown value: an UploadError's own; a fetch that never reached the server (TypeError) is `network`; anything else `refused`. */
export function failureKindOf(err: unknown): UploadFailureKind {
  if (err instanceof UploadError) return err.kind;
  if (err instanceof TypeError) return 'network';
  return 'refused';
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
  /** 0..1 as the bytes leave the device (the PUT or the chunks to storage). */
  onProgress?: (fraction: number) => void;
  /** Aborts the request in flight (the queue's forget / replace / destroy — a tile's X is the cancel). */
  signal?: AbortSignal;
  /** Phase 2: the key a resumable upload is remembered under (the queue's session + local id), so a
   *  retry — or a reload inside the service's 24 h — continues from the last acknowledged chunk. */
  resumeKey?: string;
}

async function readError(response: Response, fallback: string): Promise<string> {
  // Defensive: a gateway 413 / 502 answers plain text or HTML, never JSON.
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload.error === 'string') return payload.error;
  if (response.status === 413) return 'That file is too large to upload';
  return fallback;
}

/** PUT the bytes straight to the signed storage URL, reporting progress. */
function putToStorage(signedUrl: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    if (signal) {
      if (signal.aborted) { reject(new UploadError('network', 'The upload was cancelled')); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
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
        reject(new UploadError('too-large', 'That file is too large to upload'));
      } else {
        reject(new UploadError('refused', 'The upload did not finish — please try again'));
      }
    };
    xhr.onerror = () => reject(new UploadError('network', 'The upload was interrupted — check your connection and try again'));
    xhr.onabort = () => reject(new UploadError('network', 'The upload was cancelled'));
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
/**
 * Steps 1 and 2 of the direct upload: the intent, then the bytes straight to
 * storage. Returns the incoming key the completing route finalizes — the post
 * media route, or the profile photo route (Nov 2 2026), which finalizes to
 * the slot's own path. A JPEG loses its metadata on the device first.
 */
export async function stageUpload(
  file: File,
  targetProfileId?: string,
  options: UploadOptions = {}
): Promise<{ path: string; transport: UploadTransport }> {
  const body = file.type.startsWith('video/') ? file : await withoutJpegMetadata(file);
  const target = targetProfileId ? { targetProfileId } : {};
  const transport = uploadTransportFor(body.size);
  const storage = transport === 'tus' && options.resumeKey ? defaultResumeStorage() : null;

  // Phase 2 (Nov 5 2026): a resumable upload that stopped inside the service's
  // 24 h continues where it was — the stored key and token are the intent's
  // own, so no new intent is spent and no second object is minted.
  const remembered = options.resumeKey ? readResumeEntry(storage, options.resumeKey, body, Date.now()) : null;
  let path: string;
  let token: string;
  let signedUrl: string | null = null;
  if (remembered) {
    path = remembered.path;
    token = remembered.token;
  } else {
    const intent = await fetch('/api/upload/post-media/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: body.type, size: body.size, ...target }),
      signal: options.signal,
    }).catch(err => {
      if (options.signal?.aborted) throw new UploadError('network', 'The upload was cancelled');
      throw new UploadError('network', err instanceof Error && err.message ? 'The upload could not start — check your connection' : 'The upload could not start');
    });
    if (!intent.ok) throw new UploadError(intent.status === 413 ? 'too-large' : 'refused', await readError(intent, 'Failed to upload media'));
    const minted = (await intent.json()) as { path: string; signedUrl: string; token: string };
    path = minted.path;
    token = minted.token;
    signedUrl = minted.signedUrl;
  }

  if (transport === 'put' && signedUrl) {
    await putToStorage(signedUrl, body, options.onProgress, options.signal);
    return { path, transport };
  }

  const { tusUpload } = await import('./tus-upload');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const resumeKey = options.resumeKey;
  await tusUpload({
    endpoint: resumableEndpoint(supabaseUrl),
    token,
    bucket: UPLOAD_BUCKET,
    objectName: path,
    contentType: body.type,
    file: body,
    uploadUrl: remembered?.uploadUrl ?? null,
    signal: options.signal,
    onProgress: options.onProgress,
    onUploadUrl: uploadUrl => {
      if (resumeKey) writeResumeEntry(storage, resumeKey, { uploadUrl, path, token, size: body.size, type: body.type, savedAt: Date.now() });
    },
  });
  if (resumeKey) clearResumeEntry(storage, resumeKey);
  return { path, transport };
}

/** The bucket the intent mints into — upload-server.ts's BUCKET, named here for the client's metadata. */
const UPLOAD_BUCKET = 'uploads';

export async function uploadPostMedia(
  file: File,
  targetProfileId?: string,
  options: UploadOptions = {}
): Promise<UploadedMedia> {
  const target = targetProfileId ? { targetProfileId } : {};
  const { path, transport } = await stageUpload(file, targetProfileId, options);

  const complete = await fetch('/api/upload/post-media/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...target }),
  }).catch(() => { throw new UploadError('network', 'The upload was interrupted — check your connection and try again'); });
  const payload = complete.ok ? await complete.json().catch(() => ({})) : null;
  if (!complete.ok || !payload?.url) {
    throw new UploadError(complete.status === 413 ? 'too-large' : 'refused', complete.ok ? 'Failed to upload media' : await readError(complete, 'Failed to upload media'));
  }
  return {
    url: payload.url,
    type: payload.type === 'video' ? 'video' : 'image',
    scrubbed: payload.scrubbed === true,
    ...(payload.processing === true ? { processing: true } : {}),
    ...(typeof payload.codec === 'string' ? { codec: payload.codec } : {}),
    transport,
  };
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
