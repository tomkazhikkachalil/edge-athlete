/**
 * Post categories — cross-cutting content classification, orthogonal to
 * sport_key (posts.post_category, migration 077). 'training' was a sport_key
 * masquerading as a sport until Aug 2026; it is a category now.
 *
 * The DB column carries NO CHECK (the migration-020 activity_mode reasoning);
 * this module is the vocabulary's single source of truth.
 */

export const POST_CATEGORIES = ['training'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export function isPostCategory(value: unknown): value is PostCategory {
  return typeof value === 'string' && (POST_CATEGORIES as readonly string[]).includes(value);
}

export interface PostIdentity {
  postType: string;
  postCategory: PostCategory | null;
}

/**
 * Normalize the (postType, postCategory) pair a client sends.
 *
 * - Legacy alias (one release, protects stale tabs): `postType: 'training'`
 *   — the pre-077 shape — becomes `{ postType: 'general', postCategory:
 *   'training' }`. 'training' is no longer a registry sport, so without this
 *   the old shape would 400 as an invalid post type.
 * - An invalid category returns an error string instead of an identity.
 */
export function normalizePostIdentity(
  postType: string,
  postCategory: unknown
): PostIdentity | { error: string } {
  if (postType === 'training') {
    return { postType: 'general', postCategory: 'training' };
  }
  if (postCategory === undefined || postCategory === null || postCategory === '') {
    return { postType, postCategory: null };
  }
  if (!isPostCategory(postCategory)) {
    return { error: 'Invalid post category' };
  }
  return { postType, postCategory };
}
