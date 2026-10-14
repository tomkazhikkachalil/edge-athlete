// ── Profile photo paths: the ONE rule for what we manage (Oct 14 2026) ───────
// Pure, zero imports. A profile picture or cover URL is "managed" when it is a
// public-object URL in one of OUR buckets under OUR prefix — those files the
// photo routes may delete (replace, Remove). Anything else (a Google OAuth
// avatar on lh3.googleusercontent.com, a hand-set URL) is never touched.

export type ProfilePhotoSlot = 'avatar' | 'cover';

/** The avatar route tried these buckets in turn for years; a stored URL may name any of them. */
export const AVATAR_BUCKETS = ['avatars', 'uploads', 'images', 'files'] as const;
export const COVER_BUCKET = 'uploads';

export interface ManagedPhotoPath {
  bucket: string;
  path: string;
}

/**
 * The bucket + object path behind a stored profile photo URL, or null when
 * the URL is not one of ours. An avatar lives at `avatars/…` in any of the
 * four legacy buckets; a cover at `covers/…` in `uploads`.
 */
export function managedProfilePhotoPath(url: string | null | undefined, slot: ProfilePhotoSlot): ManagedPhotoPath | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url);
  if (!m) return null;
  const bucket = m[1];
  let path: string;
  try {
    path = decodeURIComponent(m[2].split('?')[0]);
  } catch {
    return null;
  }
  if (slot === 'avatar') {
    if (!(AVATAR_BUCKETS as readonly string[]).includes(bucket)) return null;
    return path.startsWith('avatars/') ? { bucket, path } : null;
  }
  if (bucket !== COVER_BUCKET) return null;
  return path.startsWith('covers/') ? { bucket, path } : null;
}
