/**
 * Who may read ONE post by its id (`GET /api/posts/[id]`). Pure; zero imports.
 *
 * The feed's rule, in one place for the single-post read (Oct 9 2026 — the
 * route used to admit any signed-in viewer to a private post on a public
 * profile, any viewer to a public post on a PRIVATE profile, and anyone to a
 * draft or hidden post):
 *   - the owner, and their guardian (an access row), always;
 *   - everyone else only a PUBLISHED post, and then
 *       · a public post on a public account: anyone, signed in or not;
 *       · otherwise: an approved fan (an accepted follow) only.
 * A refusal is a 404 at the route, never a 403.
 */
export interface PostReadFacts {
  isOwner: boolean;
  /** A profile_access row for the viewer on the author (guardian). */
  hasAccess: boolean;
  /** The viewer follows the author with status 'accepted'. */
  isFan: boolean;
  postVisibility: string | null;
  profileVisibility: string | null;
  /** posts.status — null on rows that predate the column (= published). */
  status: string | null;
}

export function canReadPost(f: PostReadFacts): boolean {
  if (f.isOwner || f.hasAccess) return true;
  if ((f.status ?? 'published') !== 'published') return false;
  if (f.postVisibility === 'public' && f.profileVisibility === 'public') return true;
  return f.isFan;
}
