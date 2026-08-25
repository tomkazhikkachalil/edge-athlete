import { signMediaToken, type MediaEntityType } from './token';

/**
 * Rewrite a stored media URL into the authenticated media-proxy path, so
 * private bytes are never served by a raw public URL. Normalize-on-READ: the
 * DB keeps storing full public URLs, and the proxy path exists only in API
 * responses — so the storage-sweep / delete / account-deletion strippers
 * (which parse `public/uploads/…`) are unaffected.
 *
 * Only PROTECTED_BUCKETS are proxied. avatars + badges stay raw public URLs
 * (owner decision: identity images stay public); anything not recognizably in a
 * protected bucket is returned unchanged, so external URLs (Google avatars,
 * Giphy) and already-public assets pass through untouched.
 */

const PROTECTED_BUCKETS = new Set(['uploads']);

/** Parse {bucket,key} out of a stored Supabase public URL, else null. */
export function parsePublicUrl(url: string): { bucket: string; key: string } | null {
  const marker = '/storage/v1/object/public/';
  const at = url.indexOf(marker);
  if (at === -1) return null;
  let rest = url.slice(at + marker.length); // "<bucket>/<key...>"
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  let key = rest.slice(slash + 1);
  if (!key) return null;
  try {
    key = decodeURIComponent(key);
  } catch {
    /* keep raw */
  }
  return { bucket, key };
}

export interface MediaEntityRef {
  type: MediaEntityType;
  /** Governing entity id the proxy re-authorizes against (post id, etc.). */
  id: string;
}

/**
 * Stored media URL → proxy path, or the value unchanged when it is not in a
 * protected bucket (or is null/empty). One token per distinct object, so the
 * three URL columns of a post_media row (media_url / thumbnail_url /
 * source_url) each get their own token under the same entity id.
 */
export function toProxyUrl(
  stored: string | null | undefined,
  entity: MediaEntityRef
): string | null {
  if (!stored) return null;
  const parsed = parsePublicUrl(stored);
  if (!parsed || !PROTECTED_BUCKETS.has(parsed.bucket)) return stored;
  try {
    const token = signMediaToken({ b: parsed.bucket, k: parsed.key, t: entity.type, id: entity.id });
    return `/api/media/${token}`;
  } catch {
    // Fail OPEN to the raw public URL rather than 500 the response. The only
    // way signing throws is a missing MEDIA_PROXY_SECRET — a deploy that
    // hasn't set it yet. Raw URLs still work while the bucket is public, and
    // the bucket flip to private is explicitly gated on the secret being set
    // (docs/MEDIA_PRIVACY_FLIP.md), so this degradation is safe.
    return stored;
  }
}

/** True when a bucket's bytes are served through the proxy. */
export function isProtectedBucket(bucket: string): boolean {
  return PROTECTED_BUCKETS.has(bucket);
}
