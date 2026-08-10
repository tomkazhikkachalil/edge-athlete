/**
 * Statement classification — the app-layer mirror of migration 074's SQL
 * predicate.
 *
 * A STATEMENT is a post with no portfolio content: no stats, no solo round,
 * no shared round, and no media attachments. Statements live in the feed and
 * the profile's Statements rail; everything else belongs to the Media grid.
 *
 * The SQL canonical form (074, used by get_profile_statements_media and the
 * statements_count subquery):
 *
 *       (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
 *   AND p.round_id IS NULL
 *   AND p.group_post_id IS NULL
 *   AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
 *
 * Change one, change both.
 *
 * A future repost (posts.shared_post_id — not built yet) carrying no media or
 * stats of its own classifies as a statement by construction. Do NOT
 * special-case shared_post_id here or in SQL when that feature lands.
 */

export interface StatementCandidate {
  stats_data?: Record<string, unknown> | null;
  round_id?: string | null;
  group_post_id?: string | null;
  /** RPC row shape (get_profile_*_media) */
  media_count?: number | null;
  /** PostgREST embed shape (e.g. /api/public/profile's post_media(...)) */
  post_media?: unknown[] | null;
  /** enriched API shape (media route attaches `media`) */
  media?: unknown[] | null;
}

export function isStatementPost(post: StatementCandidate): boolean {
  if (post.stats_data && Object.keys(post.stats_data).length > 0) return false;
  if (post.round_id) return false;
  if (post.group_post_id) return false;
  // Any media signal vetoes — callers supply whichever shape they have.
  if (typeof post.media_count === 'number' && post.media_count > 0) return false;
  if (Array.isArray(post.post_media) && post.post_media.length > 0) return false;
  if (Array.isArray(post.media) && post.media.length > 0) return false;
  return true;
}
