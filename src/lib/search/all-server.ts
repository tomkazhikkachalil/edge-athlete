/**
 * Unified search — the SERVER half. Wraps the `search_all` RPC (migration
 * 112) the way people-server.ts wraps search_people.
 *
 * PRIVACY IS THE CALLER'S JOB (087's rule): athletes are filtered in-query
 * via visible_ids/include_public; post documents only exist while the post is
 * public AND published, and AUTHOR-level privacy (private athlete whose
 * accepted followers may still see their posts) stays in the route.
 *
 * The degrade contract mirrors people-server.ts exactly: a missing RPC
 * (42883 from Postgres, PGRST202 from PostgREST's schema cache) means the
 * migration has not run — shout in the logs and return `null` so the route
 * serves the entire per-entity legacy path. Anything else THROWS: a broken
 * search must not look like an empty one.
 */

import { getSupabaseAdmin } from '@/lib/auth-server';
import { normalizeQuery } from './people';
import { rpcLocationArgs, type LocationParams } from '@/lib/geo/params';
import type { SearchAllRow, SearchEntityType } from './all';

export interface SearchAllParams {
  /** Raw user input; normalised here, so callers need not pre-clean it. */
  query: string;
  /** Entity types to search. Never empty — the caller gates on that. */
  types: readonly SearchEntityType[];
  /** Ranked window per type; the route slices to its display quotas. */
  maxPerType: number;
  /** Profiles visible to this caller beyond the public set (usually self). */
  visibleIds?: readonly string[];
  includePublic?: boolean;
  location?: LocationParams;
}

/**
 * Ranked unified search. Returns `null` ONLY when the RPC does not exist yet
 * (pre-112 database) — the caller's signal to use the legacy per-entity path.
 */
export async function searchAll({
  query,
  types,
  maxPerType,
  visibleIds = [],
  includePublic = true,
  location = {},
}: SearchAllParams): Promise<SearchAllRow[] | null> {
  const q = normalizeQuery(query);
  const admin = getSupabaseAdmin();
  // Location args are OMITTED when unset (rpcLocationArgs) — the same
  // old-signature safety every sibling RPC wrapper uses.
  const { data, error } = await admin.rpc('search_all', {
    q,
    p_types: [...types],
    max_per_type: maxPerType,
    visible_ids: [...visibleIds],
    include_public: includePublic,
    ...rpcLocationArgs(location),
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42883' || code === 'PGRST202') {
      console.error(
        '[search] search_all is missing — MIGRATION 112 HAS NOT BEEN RUN. ' +
        'Serving the per-entity search paths. Run database/migrations/112_search_all.sql.'
      );
      return null;
    }
    // Anything else is a real failure: surfaced, never swallowed.
    throw error;
  }

  return (data ?? []) as SearchAllRow[];
}
