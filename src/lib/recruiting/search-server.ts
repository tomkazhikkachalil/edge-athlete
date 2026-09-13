// ── Scout search — the server half (Recruiting skeleton R4) ───────────────
// A scout's "Find athletes": the recruitable profiles (open or committed,
// public, claimed — isRecruitable, THE predicate, re-applied in code after
// the query) narrowed by a name needle, a sport and a grad-year window.
//
// Deliberately NOT a search_all change: widening that RPC's signature means
// re-stating a hundred lines of plpgsql for three parameters and the
// overload trap (PGRST203); the 182 partial index on open profiles already
// makes this a small scan. Revisit (rank, facets, the index) when the
// recruitable population outgrows a bounded profiles query.
//
// Data foundation F6 (Sep 13 2026): the PERFORMANCE filters (`since`,
// `minProvenance`, `minHeadline`) are the first reader of
// athlete_performances (194). With a sport chosen, one bounded pass over
// the table (PERFORMANCE_SCAN_LIMIT rows, disputed rows out) yields the
// profile ids that qualify; a `post`-sourced row's visibility is re-derived
// through one bounded posts pass (the table stores no visibility — a
// private post's numbers never make its author findable); the profiles
// query then narrows to those ids and isRecruitable is re-applied. A
// missing table → `performanceFilters: false` and the filters are ignored.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import { headlineDirection } from '@/lib/performance/types';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { isRecruitable, parseRecruitingStatus, type RecruitingStatus } from './profile';
import {
  PERFORMANCE_SCAN_LIMIT,
  SCOUT_SEARCH_LIMIT,
  containsPattern,
  hasPerformanceFilters,
  rungsAtOrAbove,
  type RecruitingSearchParams,
} from './search';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export interface RecruitableAthlete {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  sport: string | null;
  school: string | null;
  gradYear: number | null;
  recruitingStatus: RecruitingStatus;
  city: string | null;
  region: string | null;
  countryCode: string | null;
}

export interface RecruitingSearchResult {
  supported: boolean;
  /** False when a performance filter was asked and the table is missing (194). */
  performanceFilters: boolean;
  athletes: RecruitableAthlete[];
}

interface Row {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  sport: string | null;
  school: string | null;
  class_year: number | null;
  email: string | null;
  visibility: string | null;
  recruiting_status: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
}

const FIELDS = 'id, first_name, last_name, full_name, handle, avatar_url, sport, school, class_year, email, visibility, recruiting_status, city, region, country_code';

/** The most profile ids the performance pass hands to the profiles query. */
const PERFORMANCE_PROFILE_CAP = 500;
const IN_CHUNK = 200;

/** profiles.sport is a display label ("Golf"); accept a registry key too. */
function sportLabels(sport: string): string[] {
  const def = (SPORT_REGISTRY as Record<string, { display_name: string } | undefined>)[sport as SportKey];
  return def ? [def.display_name, sport] : [sport];
}

interface PerfRow {
  profile_id: string;
  source: string;
  source_id: string;
}

/** The profile ids with a qualifying performance, or `null` when the
 *  table is missing. Bounded: PERFORMANCE_SCAN_LIMIT rows, newest first. */
async function performanceProfileIds(admin: Admin, sport: string, p: RecruitingSearchParams): Promise<string[] | null> {
  let query = admin
    .from('athlete_performances')
    .select('profile_id, source, source_id')
    .eq('sport_key', sport)
    .neq('dispute_status', 'disputed')
    .order('occurred_on', { ascending: false })
    .limit(PERFORMANCE_SCAN_LIMIT);
  if (p.since !== null) query = query.gte('occurred_on', p.since);
  if (p.minProvenance !== null) query = query.in('provenance', rungsAtOrAbove(p.minProvenance));
  if (p.minHeadline !== null) {
    query = headlineDirection(sport) === 'lower' ? query.lte('headline', p.minHeadline) : query.gte('headline', p.minHeadline);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) return null;
    console.error('[scout/search] performance read error:', error);
    return [];
  }
  const rows = (data ?? []) as PerfRow[];

  // A post's numbers are findable only while the post is public and live.
  const postIds = [...new Set(rows.filter(r => r.source === 'post' && r.source_id).map(r => r.source_id))];
  const visiblePosts = new Set<string>();
  for (let i = 0; i < postIds.length; i += IN_CHUNK) {
    const { data: posts, error: postsError } = await admin
      .from('posts')
      .select('id')
      .in('id', postIds.slice(i, i + IN_CHUNK))
      .eq('visibility', 'public')
      .eq('status', 'published');
    if (postsError) {
      console.error('[scout/search] post visibility read error:', postsError);
      break; // fail closed: those rows stay invisible
    }
    for (const row of posts ?? []) visiblePosts.add(row.id as string);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.source === 'post' && !visiblePosts.has(r.source_id)) continue;
    if (seen.has(r.profile_id)) continue;
    seen.add(r.profile_id);
    ids.push(r.profile_id);
    if (ids.length >= PERFORMANCE_PROFILE_CAP) break;
  }
  return ids;
}

export async function searchRecruitableAthletes(admin: Admin, p: RecruitingSearchParams): Promise<RecruitingSearchResult> {
  let performanceFilters = true;
  let onlyIds: string[] | null = null;
  if (p.sport && hasPerformanceFilters(p)) {
    const ids = await performanceProfileIds(admin, p.sport, p);
    if (ids === null) performanceFilters = false;
    else onlyIds = ids;
  }
  if (onlyIds && onlyIds.length === 0) return { supported: true, performanceFilters, athletes: [] };

  let query = admin
    .from('profiles')
    .select(FIELDS)
    .in('recruiting_status', ['open', 'committed'])
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false })
    .limit(SCOUT_SEARCH_LIMIT * 2);
  if (onlyIds) query = query.in('id', onlyIds);
  if (p.q) query = query.ilike('full_name', containsPattern(p.q));
  if (p.sport) query = query.in('sport', sportLabels(p.sport));
  if (p.gradFrom !== null) query = query.gte('class_year', p.gradFrom);
  if (p.gradTo !== null) query = query.lte('class_year', p.gradTo);
  const { data, error } = await query;
  if (error) {
    if (error.code === '42703') return { supported: false, performanceFilters, athletes: [] };
    console.error('[scout/search] read error:', error);
    return { supported: true, performanceFilters, athletes: [] };
  }
  const athletes: RecruitableAthlete[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (!isRecruitable({ email: r.email, visibility: r.visibility, recruiting_status: r.recruiting_status })) continue;
    athletes.push({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.full_name || 'Athlete',
      handle: r.handle,
      avatarUrl: r.avatar_url,
      sport: r.sport,
      school: r.school,
      gradYear: r.class_year,
      recruitingStatus: parseRecruitingStatus(r.recruiting_status),
      city: r.city,
      region: r.region,
      countryCode: r.country_code,
    });
    if (athletes.length >= SCOUT_SEARCH_LIMIT) break;
  }
  return { supported: true, performanceFilters, athletes };
}
