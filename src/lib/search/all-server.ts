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
import type { FacetRow, SearchAllRow, SearchEntityType } from './all';

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

export interface SearchAllDecoratedParams extends SearchAllParams {
  /** The signed-in viewer (null = anonymous) — only the post-author privacy facts read it. */
  viewerId: string | null;
  /** The route's post read filters, verbatim (283). */
  postSport?: string | null;
  postFrom?: string | null;
  postTo?: string | null;
  postLimit: number;
}

/** What `search_all_decorated` (283) returns: search_all's rows plus the raw display rows per type and the two privacy facts. */
export interface SearchDecorated {
  rows: SearchAllRow[];
  athletes: Array<{ id: string; sport?: string | null; school?: string | null }>;
  courses: unknown[];
  posts: unknown[];
  clubs: Array<{ id: string } & Record<string, unknown>>;
  leagues: Array<{ id: string } & Record<string, unknown>>;
  author_visibility: Array<{ id: string; visibility: string | null }>;
  followed_private: string[];
  /** 289: the viewer's blocks both ways (ids) — an athlete here leaves the list. */
  blocked: string[];
  /** 289: hidden_authors_for(viewer) = muted ∪ blocked ∪ blockers — a post by one of these leaves the posts. */
  hidden: string[];
}

/**
 * search_all AND its decoration in ONE call (migration 283, trip-count
 * program PR 4): the ranked rows, the raw display rows for every ranked id
 * (the route's columns, in the route's order — `json`, so the key order
 * survives), the post authors' visibility and the viewer's accepted follows
 * among the private ones. Every rule stays in the route. The degrade
 * contract is searchAll's: `null` ONLY when the function does not exist yet
 * (a deploy ahead of 283) — the route answers 503 for that; anything else
 * THROWS.
 */
export async function searchAllDecorated({
  query,
  types,
  maxPerType,
  visibleIds = [],
  includePublic = true,
  location = {},
  viewerId,
  postSport = null,
  postFrom = null,
  postTo = null,
  postLimit,
}: SearchAllDecoratedParams): Promise<SearchDecorated | null> {
  const q = normalizeQuery(query);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('search_all_decorated', {
    q,
    p_types: [...types],
    max_per_type: maxPerType,
    visible_ids: [...visibleIds],
    include_public: includePublic,
    ...rpcLocationArgs(location),
    p_viewer: viewerId,
    p_post_sport: postSport,
    p_post_from: postFrom,
    p_post_to: postTo,
    p_post_limit: postLimit,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42883' || code === 'PGRST202') {
      console.error('[search] search_all_decorated is missing — MIGRATION 283 HAS NOT BEEN RUN on this database.');
      return null;
    }
    throw error;
  }
  const d = (data ?? {}) as Partial<SearchDecorated>;
  return {
    rows: d.rows ?? [],
    athletes: d.athletes ?? [],
    courses: d.courses ?? [],
    posts: d.posts ?? [],
    clubs: d.clubs ?? [],
    leagues: d.leagues ?? [],
    author_visibility: d.author_visibility ?? [],
    followed_private: d.followed_private ?? [],
    blocked: d.blocked ?? [],
    hidden: d.hidden ?? [],
  };
}

export interface SearchAllFacetsParams {
  query: string;
  /** Entity types to count; null = every type. */
  types?: readonly SearchEntityType[] | null;
  visibleIds?: readonly string[];
  includePublic?: boolean;
  countryCode?: string;
  regionCode?: string;
}

/**
 * Facet counts for the matched set (search_all_facets, 112). Same degrade
 * contract as searchAll: `null` ONLY when the RPC does not exist yet; any
 * other error throws. Callers treat null as "no facets" — facets are
 * decoration, the panel renders plain controls without them.
 */
export async function searchAllFacets({
  query,
  types = null,
  visibleIds = [],
  includePublic = true,
  countryCode,
  regionCode,
}: SearchAllFacetsParams): Promise<FacetRow[] | null> {
  const q = normalizeQuery(query);
  const admin = getSupabaseAdmin();
  const args: Record<string, unknown> = {
    q,
    p_types: types ? [...types] : null,
    visible_ids: [...visibleIds],
    include_public: includePublic,
  };
  if (countryCode) args.p_country_code = countryCode;
  if (regionCode) args.p_region_code = regionCode;

  const { data, error } = await admin.rpc('search_all_facets', args);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42883' || code === 'PGRST202') {
      console.error(
        '[search] search_all_facets is missing — MIGRATION 112 HAS NOT BEEN RUN. ' +
        'Serving no facets. Run database/migrations/112_search_all.sql.'
      );
      return null;
    }
    throw error;
  }
  return (data ?? []) as FacetRow[];
}
