/**
 * Unified search — the PURE half (node-only vitest covers this file; no
 * Supabase or framework imports, the rate-limit-core pattern).
 *
 * `search_all` (migration 112) returns one ranked, per-type-quota'd list of
 * document rows. These helpers decide WHICH entity types a /api/search
 * request asks for (faithfully encoding the route's historical min-chars
 * rules) and re-assemble hydrated rows in document-rank order.
 */

export type SearchEntityType = 'athlete' | 'club' | 'course' | 'league' | 'post';

/** One row from the search_all RPC. */
export interface SearchAllRow {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  sport_key: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  match_rank: number;
}

/**
 * Per-type result quotas, matching what /api/search returned per section
 * before unification. 'all' keeps courses to a teaser row; a typed tab gets
 * its full page.
 */
export const ALL_QUOTAS: Record<SearchEntityType, number> = {
  athlete: 20,
  course: 5,
  post: 15,
  club: 10,
  league: 5,
};
export const TYPED_QUOTAS: Record<SearchEntityType, number> = {
  athlete: 20,
  course: 15,
  post: 15,
  club: 10,
  league: 15,
};
/** Window widening when a sport/school post-filter could empty a page. */
export const FACET_WIDEN_LIMIT = 100;

const TYPE_PARAM_MAP: Record<string, SearchEntityType> = {
  athletes: 'athlete',
  courses: 'course',
  posts: 'post',
  clubs: 'club',
  leagues: 'league',
};

/**
 * Which entity types this request searches. Encodes the route's rules:
 * people suggest from the FIRST keystroke (087 makes a 1-char prefix an index
 * range scan); posts/clubs/courses need 2+ characters (free-form prose, one
 * letter matches near-arbitrarily); a location filter with an empty query is
 * a browse for the athlete/club/course/league tabs only (posts have no
 * location).
 */
export function typesForRequest(
  type: string,
  queryLength: number,
  locationBrowse: boolean
): SearchEntityType[] {
  if (type !== 'all') {
    const t = TYPE_PARAM_MAP[type];
    if (!t) return [];
    if (t === 'athlete') return queryLength >= 1 || locationBrowse ? [t] : [];
    if (t === 'post') return queryLength >= 2 ? [t] : [];
    return queryLength >= 2 || locationBrowse ? [t] : [];
  }
  const out: SearchEntityType[] = [];
  if (queryLength >= 1) out.push('athlete');
  if (queryLength >= 2) out.push('course', 'post', 'club', 'league');
  return out;
}

/** Group RPC rows by entity type, preserving rank order within each type. */
export function groupByType(
  rows: readonly SearchAllRow[]
): Partial<Record<SearchEntityType, SearchAllRow[]>> {
  const grouped: Partial<Record<SearchEntityType, SearchAllRow[]>> = {};
  for (const row of rows) {
    (grouped[row.entity_type] ??= []).push(row);
  }
  return grouped;
}

/**
 * Re-order hydrated rows to document-rank order. Ids the hydration did not
 * return (row deleted between the RPC and the fetch) are dropped rather than
 * leaving holes.
 */
export function orderByIds<T extends { id: string }>(
  ids: readonly string[],
  items: readonly T[]
): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

/** One row from the search_all_facets RPC (facet ∈ type/sport/country/region). */
export interface FacetRow {
  facet: string;
  code: string;
  label: string | null;
  n: number;
}

export interface FacetOption {
  code: string;
  label: string;
  n: number;
}

export interface GroupedFacets {
  types: FacetOption[];
  sports: FacetOption[];
  countries: FacetOption[];
  regions: FacetOption[];
}

/** Group RPC facet rows for the panel, preserving the RPC's n-desc order.
 *  Unknown facet kinds are dropped; a missing label falls back to the code. */
export function groupFacetRows(rows: readonly FacetRow[]): GroupedFacets {
  const grouped: GroupedFacets = { types: [], sports: [], countries: [], regions: [] };
  for (const row of rows) {
    const option: FacetOption = { code: row.code, label: row.label ?? row.code, n: row.n };
    if (row.facet === 'type') grouped.types.push(option);
    else if (row.facet === 'sport') grouped.sports.push(option);
    else if (row.facet === 'country') grouped.countries.push(option);
    else if (row.facet === 'region') grouped.regions.push(option);
  }
  return grouped;
}
