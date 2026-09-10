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

import type { SupabaseClient } from '@supabase/supabase-js';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { isRecruitable, parseRecruitingStatus, type RecruitingStatus } from './profile';
import { SCOUT_SEARCH_LIMIT, containsPattern, type RecruitingSearchParams } from './search';

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

/** profiles.sport is a display label ("Golf"); accept a registry key too. */
function sportLabels(sport: string): string[] {
  const def = (SPORT_REGISTRY as Record<string, { display_name: string } | undefined>)[sport as SportKey];
  return def ? [def.display_name, sport] : [sport];
}

export async function searchRecruitableAthletes(
  admin: Admin,
  p: RecruitingSearchParams
): Promise<{ supported: boolean; athletes: RecruitableAthlete[] }> {
  let query = admin
    .from('profiles')
    .select(FIELDS)
    .in('recruiting_status', ['open', 'committed'])
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false })
    .limit(SCOUT_SEARCH_LIMIT * 2);
  if (p.q) query = query.ilike('full_name', containsPattern(p.q));
  if (p.sport) query = query.in('sport', sportLabels(p.sport));
  if (p.gradFrom !== null) query = query.gte('class_year', p.gradFrom);
  if (p.gradTo !== null) query = query.lte('class_year', p.gradTo);
  const { data, error } = await query;
  if (error) {
    if (error.code === '42703') return { supported: false, athletes: [] };
    console.error('[scout/search] read error:', error);
    return { supported: true, athletes: [] };
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
  return { supported: true, athletes };
}
