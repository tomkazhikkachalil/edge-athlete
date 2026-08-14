/**
 * People search — the SERVER half. Wraps the `search_people` RPC (migration
 * 087) so every people-search endpoint ranks and limits identically.
 *
 * PRIVACY IS THE CALLER'S JOB, deliberately. The RPC takes the allowed-id set
 * as an argument rather than joining `follows` itself, because the repo's rule
 * — written at src/app/api/mentions/search/route.ts:9-11 — is that when a
 * route runs on the admin client, the filter in the ROUTE is the privacy
 * boundary. That rule was earned from `search_profiles` shipping with no
 * filter at all while the app was assumed to gate. Each caller therefore keeps
 * computing its own audience, and they are all different on purpose:
 *
 *   /api/search                  public + self
 *   /api/mentions/search         public + ONE-directional accepted follows
 *   /api/calendar/invite-search  public + BIDIRECTIONAL accepted follows
 *
 * What the RPC does add is that the LIMIT lands AFTER the privacy filter. The
 * old path filtered in TS after the RPC's LIMIT 20, so private profiles ate
 * result slots and public matches silently fell off the end.
 */

import { getSupabaseAdmin } from '@/lib/auth-server';
import { normalizeQuery, type PersonSuggestion } from './people';

export interface SearchPeopleParams {
  /** Raw user input; normalised here, so callers need not pre-clean it. */
  query: string;
  /**
   * Profiles this caller may see BEYOND the public set — typically their
   * accepted follows, plus themselves. Empty is valid.
   */
  visibleIds?: readonly string[];
  /** Whether public profiles are in the audience. Nearly always true. */
  includePublic?: boolean;
  limit?: number;
  /** @mention targets must be addressable, so mentions passes true. */
  requireHandle?: boolean;
  /** Usually the caller — you cannot tag or invite yourself. */
  excludeId?: string | null;
}

/**
 * Ranked people search. Returns [] for an empty query rather than throwing —
 * every caller treats "nothing typed" as "no suggestions", not an error.
 */
export async function searchPeople({
  query,
  visibleIds = [],
  includePublic = true,
  limit = 20,
  requireHandle = false,
  excludeId = null,
}: SearchPeopleParams): Promise<PersonSuggestion[]> {
  const q = normalizeQuery(query);
  if (!q) return [];

  const admin = getSupabaseAdmin();
  // requireHandle/excludeId go to the RPC rather than being filtered off the
  // result: applied after the LIMIT they would quietly return fewer rows than
  // the caller asked for.
  const { data, error } = await admin.rpc('search_people', {
    search_term: q,
    visible_ids: [...visibleIds],
    include_public: includePublic,
    max_results: limit,
    require_handle: requireHandle,
    exclude_id: excludeId,
  });

  // Surfaced, never swallowed: a broken search must show up in logs rather
  // than looking like "no results". Callers decide the status code.
  if (error) throw error;

  return (data ?? []) as PersonSuggestion[];
}

/**
 * The id set for "public profiles plus people I have an accepted follow with".
 * `direction` is the deliberate asymmetry:
 *
 *   'following' — people I follow. canViewProfile's "you know them" rule.
 *                 Someone following ME must not become taggable BY me, which
 *                 is why mentions uses this and not 'either'.
 *   'either'    — a follow in either direction. Calendar invites use this so
 *                 private friends stay invitable.
 */
export async function accessibleProfileIds(
  viewerId: string,
  direction: 'following' | 'either'
): Promise<string[]> {
  const admin = getSupabaseAdmin();

  if (direction === 'following') {
    const { data } = await admin
      .from('follows')
      .select('following_id')
      .eq('follower_id', viewerId)
      .eq('status', 'accepted');
    return (data ?? [])
      .map(f => f.following_id as string)
      .filter(id => id !== viewerId);
  }

  const { data } = await admin
    .from('follows')
    .select('follower_id, following_id')
    .eq('status', 'accepted')
    .or(`follower_id.eq.${viewerId},following_id.eq.${viewerId}`);

  const related = new Set<string>();
  for (const f of data ?? []) {
    related.add(f.follower_id === viewerId ? f.following_id : f.follower_id);
  }
  related.delete(viewerId);
  return [...related];
}
