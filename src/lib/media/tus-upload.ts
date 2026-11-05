// ── The resumable upload runtime (Videos program Phase 2, Nov 5 2026) ───────
// The tus loop over the pure rules in tus.ts: create (fetch) → one PATCH per
// chunk (XMLHttpRequest — the only upload progress inside the iOS 15 floor)
// → on a 409 a HEAD re-syncs the offset and the loop goes on → done when the
// offset reaches the size. `signal` aborts the request in flight (the queue
// aborts on forget / replace / destroy — a tile's X is the cancel).
// `onUploadUrl` fires once the service has minted the URL, so the caller can
// keep it (resume-store.ts) for a retry or a reload. Every failure is an
// UploadError the queue already understands.

import { UploadError } from './upload';
import { nextChunk, parseOffset, tusFailureOf, tusProgress, TUS_VERSION, encodeUploadMetadata, uploadMetadataFor } from './tus';

export interface TusUploadInput {
  /** `resumableEndpoint(NEXT_PUBLIC_SUPABASE_URL)`. */
  endpoint: string;
  /** The intent's signed-upload token — `x-signature` on every request. */
  token: string;
  bucket: string;
  /** The server-minted `incoming/…` key. */
  objectName: string;
  contentType: string;
  file: Blob;
  /** A URL from an earlier attempt: the loop HEADs it and continues. */
  uploadUrl?: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  onUploadUrl?: (uploadUrl: string) => void;
}

const NETWORK_MESSAGE = 'The upload was interrupted — check your connection and try again';
const REFUSED_MESSAGE = 'The upload did not finish — please try again';

function aborted(signal?: AbortSignal): boolean {
  return !!signal && signal.aborted;
}

async function createUpload(input: TusUploadInput): Promise<string> {
  let res: Response;
  try {
    res = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'Tus-Resumable': TUS_VERSION,
        'Upload-Length': String(input.file.size),
        'Upload-Metadata': encodeUploadMetadata(uploadMetadataFor(input.bucket, input.objectName, input.contentType)),
        'x-signature': input.token,
        'x-upsert': 'false',
      },
      signal: input.signal,
    });
  } catch (err) {
    if (aborted(input.signal)) throw new UploadError('network', 'The upload was cancelled');
    throw new UploadError('network', err instanceof Error && err.message ? NETWORK_MESSAGE : 'The upload could not start');
  }
  const location = res.headers.get('location');
  if (res.status !== 201 || !location) {
    const kind = tusFailureOf(res.status);
    throw new UploadError(kind === 'too-large' ? 'too-large' : kind === 'network' ? 'network' : 'refused', kind === 'too-large' ? 'That file is too large to upload' : REFUSED_MESSAGE);
  }
  return new URL(location, input.endpoint).toString();
}

async function headOffset(input: TusUploadInput, uploadUrl: string): Promise<number | null> {
  try {
    const res = await fetch(uploadUrl, { method: 'HEAD', headers: { 'Tus-Resumable': TUS_VERSION, 'x-signature': input.token }, signal: input.signal });
    if (!res.ok) return null;
    return parseOffset(res.headers.get('upload-offset'));
  } catch {
    return null;
  }
}

/** One chunk by XHR: resolves the new offset the service acknowledged; rejects with the status (0 = network). */
function patchChunk(input: TusUploadInput, uploadUrl: string, offset: number, chunk: Blob, onLoaded: (loaded: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', uploadUrl);
    xhr.setRequestHeader('Tus-Resumable', TUS_VERSION);
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.setRequestHeader('x-signature', input.token);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onLoaded(e.loaded); };
    const onAbort = () => xhr.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => input.signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        const next = parseOffset(xhr.getResponseHeader('upload-offset'));
        resolve(next ?? offset + chunk.size);
      } else reject(xhr.status);
    };
    xhr.onerror = () => { done(); reject(0); };
    xhr.onabort = () => { done(); reject(-1); };
    xhr.send(chunk);
  });
}

/**
 * The whole file, chunk by chunk, from wherever it stopped. Resolves when the
 * service holds every byte; the caller then runs the completing route.
 */
export async function tusUpload(input: TusUploadInput): Promise<void> {
  const size = input.file.size;
  let uploadUrl = input.uploadUrl ?? null;
  let offset = 0;
  if (uploadUrl) {
    const known = await headOffset(input, uploadUrl);
    if (known === null || known > size) uploadUrl = null; // the URL expired or is not this file's — start over
    else offset = known;
  }
  if (!uploadUrl) {
    uploadUrl = await createUpload(input);
    input.onUploadUrl?.(uploadUrl);
  }
  input.onProgress?.(tusProgress(size, offset, 0));
  let drifts = 0;
  for (;;) {
    if (aborted(input.signal)) throw new UploadError('network', 'The upload was cancelled');
    const range = nextChunk(size, offset);
    if (!range) break;
    const chunk = input.file.slice(range.start, range.end);
    try {
      offset = await patchChunk(input, uploadUrl, offset, chunk, loaded => input.onProgress?.(tusProgress(size, offset, loaded)));
      drifts = 0;
    } catch (status) {
      if (status === -1) throw new UploadError('network', 'The upload was cancelled');
      const kind = tusFailureOf(typeof status === 'number' ? status : 0);
      if (kind === 'offset' && drifts < 2) {
        // The service is ahead or behind what we believe: ask it, then carry on from there.
        drifts += 1;
        const known = await headOffset(input, uploadUrl);
        if (known === null) throw new UploadError('network', NETWORK_MESSAGE);
        offset = known;
        continue;
      }
      if (kind === 'network') throw new UploadError('network', NETWORK_MESSAGE);
      if (kind === 'too-large') throw new UploadError('too-large', 'That file is too large to upload');
      throw new UploadError('refused', REFUSED_MESSAGE);
    }
  }
  input.onProgress?.(1);
}
