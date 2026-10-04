/**
 * Direct-to-storage upload rules (Oct 2026). Pure, zero server imports — the
 * client reads the cap, the routes read everything, and the tests pin it.
 *
 * Why direct: the old door (/api/upload/post-media) carried the WHOLE file
 * through a Vercel function, and Vercel refuses a function request body over
 * 4.5 MB on every plan (413 FUNCTION_PAYLOAD_TOO_LARGE, DEVLOG Aug 1 2026).
 * Most phone videos never reached storage. Now the function only signs:
 *
 *   1. intent   — the gates run, the server mints `incoming/<owner>/<uuid>.<ext>`
 *                 and a one-time signed upload URL for exactly that key;
 *   2. the browser PUTs the bytes straight to Supabase Storage;
 *   3. complete — the gates run again, the object's real size and type are
 *                 checked, a video's metadata is scrubbed, and it lands at
 *                 `posts/<owner>/<uuid>.<ext>` — the path every reader knew.
 *
 * An `incoming/` object that never completes is unreferenced, so the storage
 * sweep removes it after its 48 h grace (it is deliberately NOT a protected
 * prefix — storage-sweep.test.ts pins that).
 */

import { MB } from './limits';
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from './validation';

/**
 * The one upload cap. It tracks the Supabase PROJECT's file-size limit
 * (Free = 50 MB per file, fixed; Pro = raise it in the dashboard first, then
 * here). Raising this alone only moves the refusal into storage.
 */
export const MAX_UPLOAD_BYTES = 50 * MB;

export const INCOMING_PREFIX = 'incoming/';

export const EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const TYPE_BY_EXT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type])
);

export function uploadKindOf(mime: string): 'image' | 'video' | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return 'image';
  if ((ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)) return 'video';
  return null;
}

export type UploadRefusal = { ok: false; status: 400 | 413; error: string };

/** The intent's checks: an allowlisted type and a size within the cap. */
export function checkUploadIntent(type: unknown, size: unknown): { ok: true; type: string; size: number } | UploadRefusal {
  if (typeof type !== 'string' || !uploadKindOf(type)) {
    return {
      ok: false,
      status: 400,
      error: 'Please select a valid image or video file (JPG, PNG, GIF, WebP, MP4, MOV, WebM)',
    };
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, error: 'The file is empty' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: `File size must be less than ${MAX_UPLOAD_BYTES / MB}MB` };
  }
  return { ok: true, type, size };
}

/** `incoming/<owner>/<uuid>.<ext>` — nothing in it comes from the caller but the validated type. */
export function incomingKey(ownerId: string, type: string, uuid: string): string {
  return `${INCOMING_PREFIX}${ownerId}/${uuid}.${EXT_BY_TYPE[type]}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INCOMING_RE = new RegExp(`^${INCOMING_PREFIX}(${UUID})/(${UUID})\\.([a-z0-9]+)$`);

/**
 * Parse a key the client hands back at complete. Null unless it is exactly
 * the shape intent mints AND belongs to `ownerId` — a forged path for
 * someone else's upload is refused here, before any storage call.
 */
export function parseIncomingKey(
  path: unknown,
  ownerId: string
): { id: string; ext: string; type: string } | null {
  if (typeof path !== 'string') return null;
  const m = INCOMING_RE.exec(path);
  if (!m || m[1] !== ownerId.toLowerCase()) return null;
  const type = TYPE_BY_EXT[m[3]];
  if (!type) return null;
  return { id: m[2], ext: m[3], type };
}

/** Where a completed upload lives — the same `posts/` path the old door wrote. */
export function postsKey(ownerId: string, id: string, ext: string): string {
  return `posts/${ownerId}/${id}.${ext}`;
}

/** The type the stored bytes must carry: the minted one, never the client's later word. */
export function storedTypeMatches(mintedType: string, storedType: string | null | undefined): boolean {
  if (!storedType) return false;
  return storedType.split(';')[0].trim().toLowerCase() === mintedType;
}

const POSTS_URL_RE = new RegExp(`/storage/v1/object/public/uploads/posts/(${UUID})/(${UUID})\\.([a-z0-9]+)$`);

/**
 * True when `url` is a finished upload (`posts/<owner>/<uuid>.<ext>`) that
 * belongs to `ownerId` — what the background original PATCH accepts and
 * nothing else (never another owner's object, never an arbitrary URL).
 */
export function isOwnPostsUploadUrl(url: unknown, ownerId: string): boolean {
  if (typeof url !== 'string') return false;
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    pathname = parsed.pathname;
  } catch {
    return false;
  }
  const m = POSTS_URL_RE.exec(pathname);
  return !!m && m[1] === ownerId.toLowerCase() && !!TYPE_BY_EXT[m[3]];
}
