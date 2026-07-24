// ── Post pinning rules ────────────────────────────────────────────────────────
// Pure logic behind the "Featured" row (pinned posts on athlete profiles),
// kept out of the API route so the cap and ordering are unit-testable.

/** Hard cap on featured posts per profile — enforced in PATCH /api/posts. */
export const MAX_PINNED_POSTS = 3;

export function canPin(currentPinCount: number): boolean {
  return currentPinCount < MAX_PINNED_POSTS;
}

/**
 * Featured-row display order: newest pin first. Rows without pinned_at
 * (shouldn't happen for pinned posts, but the column is nullable) sink to
 * the end deterministically.
 */
export function sortByPinnedAt<T extends { pinned_at?: string | null }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    const ta = a.pinned_at ? Date.parse(a.pinned_at) : -Infinity;
    const tb = b.pinned_at ? Date.parse(b.pinned_at) : -Infinity;
    return tb - ta;
  });
}
