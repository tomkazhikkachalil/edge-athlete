// ── One liked truth per tab (Oct 4 2026) ─────────────────────────────────
// Tom: "if you liked a post on your feed, then go to that same post on the
// user profile, it sometimes doesn't show the heart filled — the count is
// right, the heart isn't." Every surface used to derive "the viewer liked
// this" from its OWN read, and the profile path's single-post GET resolves
// the viewer from cookies inside a try/catch: an access token caught between
// refreshes answers as nobody — correct `likes_count`, `likes: []`.
//
// This module is the tab's memory of what it KNOWS: every like / unlike the
// viewer performs here, and every read that carried the viewer's own state
// (the server says who it resolved — a read that resolved nobody writes
// nothing). A card seeds its heart from here first and from its props second.
// Last writer wins, so another device's unlike still lands on the next read
// that knows the viewer. Zero imports; pinned in __tests__/likes-store.test.ts.

const known = new Map<string, boolean>();

/** Record that the viewer does / does not like `postId`. */
export function rememberLike(postId: string, liked: boolean): void {
  known.set(postId, liked);
}

/** What this tab knows about `postId`, or undefined when it has never heard. */
export function knownLike(postId: string): boolean | undefined {
  return known.get(postId);
}

/** A read that carried the viewer's state, as a list of {id, liked}. */
export function rememberLikes(entries: ReadonlyArray<{ id: string; liked: boolean }>): void {
  for (const e of entries) known.set(e.id, e.liked);
}

/** The heart a card should show: the tab's knowledge first, the row second. */
export function likedFor(postId: string, likes: ReadonlyArray<{ profile_id: string }> | null | undefined, viewerId: string | null | undefined): boolean {
  const remembered = known.get(postId);
  if (remembered !== undefined) return remembered;
  return !!viewerId && !!likes?.some(l => l.profile_id === viewerId);
}

/** Tests only. */
export function _resetLikesStore(): void {
  known.clear();
}
