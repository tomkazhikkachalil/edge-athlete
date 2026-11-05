// ── Resumable uploads — the pure protocol rules (Videos program Phase 2, Nov 5 2026) ──
// A phone on LTE loses a 40 MB PUT at 90 % and starts again from zero. The
// tus protocol (Supabase Storage speaks it) splits the bytes into fixed
// chunks the server acknowledges by OFFSET, so a lost connection costs one
// chunk, never the file. Proven against staging on Nov 5 2026:
//
//   POST   <supabase>/storage/v1/upload/resumable/sign      → 201 + Location
//          (x-signature: the intent's signed-upload token — the SAME token
//          the plain PUT uses; no user JWT, no apikey; the same host, so
//          the CSP's connect-src is untouched)
//   PATCH  <Location>  Upload-Offset: n  application/offset+octet-stream
//          → 204 + Upload-Offset: n + len
//   HEAD   <Location>  → Upload-Offset (the resume point); a wrong offset → 409
//
// Zero imports: the uploader, the queue and the tests read these.

export const TUS_VERSION = '1.0.0';
/** Supabase's chunk — fixed by the service ("must be 6 MB"); every chunk but the last is exactly this. */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
/** Files at or above this go resumable; a file of ONE chunk gains nothing over the plain PUT. */
export const TUS_MIN_BYTES = TUS_CHUNK_BYTES;
/** An upload URL lives 24 h on the service; a resume entry older than this starts over. */
export const RESUME_TTL_MS = 23 * 60 * 60 * 1000;

export type UploadTransport = 'put' | 'tus';

/** The transport by size: one chunk or less = the PUT; more = resumable. */
export function uploadTransportFor(size: number): UploadTransport {
  return Number.isFinite(size) && size > TUS_MIN_BYTES ? 'tus' : 'put';
}

/** The signed resumable endpoint on the project's own host. */
export function resumableEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable/sign`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without btoa (a UTF-8 object name must survive; btoa throws past Latin-1). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function utf8ToBase64(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

/** `Upload-Metadata`: `key base64(value)` pairs, comma-joined — what Supabase reads the bucket and object name from. */
export function encodeUploadMetadata(pairs: Readonly<Record<string, string>>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key} ${utf8ToBase64(value)}`)
    .join(',');
}

/** The metadata of OUR upload: the bucket, the server-minted key, the minted type, the same cache rule as the PUT. */
export function uploadMetadataFor(bucket: string, objectName: string, contentType: string): Record<string, string> {
  return { bucketName: bucket, objectName, contentType, cacheControl: '3600' };
}

/** The next chunk from `offset`: `[start, end)`; null when the file is done. */
export function nextChunk(size: number, offset: number): { start: number; end: number } | null {
  if (!Number.isFinite(size) || !Number.isFinite(offset) || offset < 0 || offset >= size) return null;
  return { start: offset, end: Math.min(size, offset + TUS_CHUNK_BYTES) };
}

/** An `Upload-Offset` header → a whole number, or null when it is not one. */
export function parseOffset(header: string | null | undefined): number | null {
  if (typeof header !== 'string') return null;
  const n = Number(header.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Progress over the whole file: the acknowledged offset plus the chunk's bytes in flight. */
export function tusProgress(size: number, offset: number, chunkLoaded: number): number {
  if (!(size > 0)) return 0;
  return Math.min(1, Math.max(0, (offset + Math.max(0, chunkLoaded)) / size));
}

export type TusFailure = 'network' | 'offset' | 'too-large' | 'refused';

/** What a status means to the loop: 0 = the network; 409 = the offset drifted (HEAD and go on); 413 = the cap; anything else 4xx/5xx = refused. */
export function tusFailureOf(status: number): TusFailure {
  if (status === 0) return 'network';
  if (status === 409) return 'offset';
  if (status === 413) return 'too-large';
  return 'refused';
}

/** What the store keeps so a retry — or a reload within the TTL — continues where the bytes stopped. */
export interface ResumeEntry {
  uploadUrl: string;
  /** The server-minted `incoming/…` key the completing route finalizes. */
  path: string;
  /** The intent's signed-upload token — the credential for every tus request. */
  token: string;
  size: number;
  type: string;
  savedAt: number;
}

export function isResumeEntry(v: unknown): v is ResumeEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.uploadUrl === 'string' && e.uploadUrl.startsWith('https://') &&
    typeof e.path === 'string' && e.path.length > 0 &&
    typeof e.token === 'string' && e.token.length > 0 &&
    typeof e.size === 'number' && e.size > 0 &&
    typeof e.type === 'string' &&
    typeof e.savedAt === 'number'
  );
}

/** An entry continues THIS file only: the same size and type, and younger than the service's URL. */
export function resumeEntryUsable(entry: ResumeEntry | null | undefined, file: { size: number; type: string }, now: number): entry is ResumeEntry {
  return !!entry && entry.size === file.size && entry.type === file.type && now - entry.savedAt >= 0 && now - entry.savedAt < RESUME_TTL_MS;
}
