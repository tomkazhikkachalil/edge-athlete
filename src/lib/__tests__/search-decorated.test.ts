import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG_ROW_COLUMNS } from '../golf/course-catalog';

// Trip-count program PR 4 (Oct 27 2026): GET /api/search is ONE database
// call after the limiter and the session — search_all_decorated (283) ranks
// (search_all, unchanged) and returns the raw display rows for every ranked
// id plus the two post-author privacy facts. Every rule stays in the route.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('search decoration rides the search call', () => {
  const route = read('src/app/api/search/route.ts');
  const server = read('src/lib/search/all-server.ts');
  it('the unified path makes one call and no table read of its own; the legacy path keeps its reads', () => {
    expect(route.match(/await searchAllDecorated\(\{/g)?.length).toBe(1);
    expect(route).not.toMatch(/searchAll\(\{/);
    expect(route).not.toMatch(/from\('golf_courses'\)/);
    expect(route.match(/\.from\('posts'\)/g)?.length).toBe(2); // the legacy post reads
    expect(route.match(/\.from\('organizations'\)/g)?.length).toBe(1); // the legacy club read
    expect(route.match(/\.from\('profiles'\)/g)?.length).toBe(1); // the legacy privacy fallback
    expect(route.match(/\.from\('follows'\)/g)?.length).toBe(1); // the legacy privacy fallback
    expect(route).toMatch(/const authorProfiles = decorated\s*\? decorated\.author_visibility/);
    expect(route).toMatch(/const myFollows = decorated\s*\? decorated\.followed_private\.map/);
  });
  it('the rules did not move: rank order, the filters, the quotas, the course mapping, the listing filter, the privacy filter, the proxy, the envelope', () => {
    expect(route).toMatch(/orderByIds\(ids, decorated\.athletes\)/);
    expect(route).toMatch(/athletes\.filter\(a => a\.sport === sport\)/);
    expect(route).toMatch(/results\.athletes = athletes\.slice\(0, quotas\.athlete\)/);
    expect(route).toMatch(/orderByIds\(ids, decorated\.courses as unknown as CatalogRow\[\]\)[\s\S]*?\.slice\(0, quotas\.course\)[\s\S]*?rowToCourse\(/);
    expect(route).toMatch(/results\.posts = decorated\.posts;/);
    expect(route).toMatch(/orderByIds\(ids, filterListedRows\(decorated\.clubs\)\)[\s\S]*?\.slice\(0, quotas\.club\)/);
    expect(route).toMatch(/orderByIds\(ids, filterListedRows\(decorated\.leagues\)\)[\s\S]*?\.slice\(0, quotas\.league\)/);
    expect(route).toMatch(/return !privateAuthors\.has\(authorId\) \|\| followedPrivate\.has\(authorId\);/);
    expect(route).toMatch(/media_url: toProxyUrl\(m\.media_url, \{ type: 'post', id: p\.id \}\) \?\? m\.media_url,/);
    expect(route).toMatch(/total: results\.athletes\.length \+ results\.posts\.length \+ results\.clubs\.length \+ results\.courses\.length \+ results\.leagues\.length,/);
    expect(route).toMatch(/postTo: badDate \? null : \(dateTo \? `\$\{dateTo\}T23:59:59\.999Z` : null\)/);
    expect(route).toMatch(/postLimit: badDate \? 0 : quotas\.post/);
  });
  it('a database ahead of 283 answers 503, no-store; the wrapper degrades only on a missing function', () => {
    expect(route).toMatch(/if \(docTypes\.length > 0 && decorated === null\) \{[\s\S]*?\{ error: 'Search service updating' \}, \{ status: 503, headers: \{ 'Cache-Control': 'no-store' \} \}/);
    expect(server).toMatch(/admin\.rpc\('search_all_decorated', \{/);
    expect(server).toMatch(/if \(code === '42883' \|\| code === 'PGRST202'\) \{\s*console\.error\('\[search\] search_all_decorated is missing/);
  });
});

describe('migration 283', () => {
  const m = read('database/migrations/283_search_all_decorated.sql');
  it('calls search_all unchanged and returns json with the route\'s columns in the route\'s order', () => {
    expect(m).toMatch(/RETURNS json\s*LANGUAGE sql STABLE SECURITY INVOKER\s*SET search_path = public, extensions/);
    expect(m).toMatch(/FROM public\.search_all\(q, p_types, max_per_type, visible_ids, include_public,\s*p_country_code, p_region_code, p_near_lat, p_near_lng, p_radius_km\)\s*WITH ORDINALITY/);
    expect(m).not.toMatch(/CREATE OR REPLACE FUNCTION public\.search_all\(/);
    // athletes: the route's sixteen columns, in order
    expect(m).toMatch(/'id', a\.id, 'handle', a\.handle, 'first_name', a\.first_name, 'middle_name', a\.middle_name, 'last_name', a\.last_name,\s*'full_name', a\.full_name, 'avatar_url', a\.avatar_url, 'location', a\.location, 'sport', a\.sport, 'school', a\.school,\s*'visibility', a\.visibility, 'city', a\.city, 'region', a\.region, 'region_code', a\.region_code,\s*'country', a\.country, 'country_code', a\.country_code/);
    // courses: exactly CATALOG_ROW_COLUMNS, in order
    const cols = CATALOG_ROW_COLUMNS.split(',').map(c => c.trim());
    let last = -1;
    for (const c of cols) {
      const i = m.indexOf(`'${c}', g.${c}`);
      expect(i, c).toBeGreaterThan(last);
      last = i;
    }
    // posts: the route's read verbatim + the embeds
    expect(m).toMatch(/AND p\.status = 'published'\s*AND p\.on_feed = true\s*AND \(p_post_sport IS NULL OR p\.sport_key = p_post_sport\)\s*AND \(p_post_from IS NULL OR p\.created_at >= p_post_from\)\s*AND \(p_post_to IS NULL OR p\.created_at <= p_post_to\)\s*ORDER BY p\.created_at DESC\s*LIMIT GREATEST\(COALESCE\(p_post_limit, 15\), 0\)/);
    expect(m).toMatch(/'id', p\.id, 'caption', p\.caption, 'sport_key', p\.sport_key, 'hashtags', p\.hashtags, 'tags', p\.tags, 'created_at', p\.created_at,/);
    // the embeds are jsonb (PostgREST's own rendering of an embed: keys sorted) cast to json inside the json row
    expect(m).toMatch(/'profile', \(SELECT \(jsonb_build_object\('id', pr\.id, 'full_name', pr\.full_name, 'first_name', pr\.first_name,\s*'middle_name', pr\.middle_name, 'last_name', pr\.last_name, 'avatar_url', pr\.avatar_url\)\)::json/);
    expect(m).toMatch(/json_agg\(\(jsonb_build_object\('media_url', m\.media_url, 'media_type', m\.media_type\)\)::json\s*ORDER BY m\.display_order, m\.id\)/);
    // orgs: the route's lists + the listing columns
    expect(m).toMatch(/'id', o\.id, 'name', o\.name, 'description', o\.description, 'location', o\.location, 'city', o\.city, 'region', o\.region,\s*'region_code', o\.region_code, 'country', o\.country, 'country_code', o\.country_code, 'lat', o\.lat, 'lng', o\.lng,\s*'visibility', o\.visibility, 'listing_status', o\.listing_status, 'approved_at', o\.approved_at[\s\S]*?o\.kind = 'club'/);
    expect(m).toMatch(/'id', o\.id, 'name', o\.name, 'description', o\.description, 'sport_key', o\.sport_key, 'city', o\.city, 'region', o\.region,[\s\S]*?o\.kind = 'league'/);
    // the privacy facts
    expect(m).toMatch(/f\.follower_id = p_viewer AND f\.status = 'accepted'/);
    expect(m).toMatch(/pr\.visibility IS DISTINCT FROM 'public'/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.search_all_decorated\([^)]*\)\s*FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_all_decorated\([^)]*\)\s*TO service_role;/);
    expect(m).toMatch(/VALUES \(283, '283_search_all_decorated\.sql'\)/);
  });
  it('search_all itself (279) is untouched by this program', () => {
    expect(read('database/migrations/279_search_candidate_cap.sql')).toMatch(/cap\s+int\s+:= 1000;/);
  });
});
