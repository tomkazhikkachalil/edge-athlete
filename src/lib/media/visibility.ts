/**
 * ONE answer to "may anyone see this post's media?" (speed round 2). The
 * feed's single-post read and the media proxy's authorization used to spell
 * it differently (`=== 'public' && === 'public'` vs `!== 'private'`); both
 * read this now, and the proxy-URL minter uses it to decide whether a URL
 * is a public (resizable, CDN-cached) one or a private expiring one. Pure;
 * a missing visibility reads as private — the safe side.
 */

export interface PostMediaVisibility {
  postVisibility: string | null | undefined;
  ownerVisibility: string | null | undefined;
}

export function isPublicPostMedia(v: PostMediaVisibility): boolean {
  return v.postVisibility === 'public' && v.ownerVisibility === 'public';
}
