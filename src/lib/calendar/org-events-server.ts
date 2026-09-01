// ── Org upcoming events — the shared core (119) ─────────────────────────────
// Both org routes (/api/leagues/[id]/events, /api/clubs/[id]/events) wrap
// these. Public reads: org pages are public, and the select is
// guest-data-free (no event_guests columns ever leave here). The calendar's
// own guest-row-driven access paths are untouched — this is the org PAGE's
// schedule, per the no-fan-out v1 decision.
//
// Phase 3 R2 split fetchOrgEvents (plain data, viewer-independent — the
// public org-site schedule module reads it through unstable_cache) out of
// the NextResponse wrapper; route behavior is unchanged at the defaults,
// with limit/range_days now accepted and clamped.

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { isMissingTableError } from '@/lib/leagues/validate';
import { clampScheduleQuery, SCHEDULE_LIMIT_DEFAULT } from '@/lib/org-sites/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

/** Public columns only — deliberately no organizer/guest data. venue_id/
 *  facility_id (141) are included DELIBERATELY: harmless ids on a public
 *  schedule, and the future venue picker must not silently drop here. */
const ORG_EVENT_FIELDS =
  'id, title, description, location, starts_at, ends_at, all_day, timezone, category, venue_id, facility_id';

export interface OrgEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean | null;
  timezone: string | null;
  category: string | null;
  venue_id: string | null;
  facility_id: string | null;
}

/** Upcoming events for an org, viewer-independent (nothing here may branch
 *  on a session). Returns null ONLY on a real DB error; a pre-119/146
 *  database (missing table/column) is an empty schedule. */
export async function fetchOrgEvents(
  admin: Admin,
  side: 'league' | 'club',
  orgId: string,
  opts: { limit?: number; rangeDays?: number } = {}
): Promise<OrgEvent[] | null> {
  const column = side === 'league' ? 'league_id' : 'club_id';
  const limit = opts.limit ?? SCHEDULE_LIMIT_DEFAULT;
  const nowIso = new Date().toISOString();
  const endIso =
    opts.rangeDays !== undefined
      ? new Date(Date.now() + opts.rangeDays * 86_400_000).toISOString()
      : null;

  const base = () => {
    let q = admin
      .from('events')
      .select(ORG_EVENT_FIELDS)
      .eq('status', 'active')
      .gte('starts_at', nowIso);
    if (endIso) q = q.lt('starts_at', endIso);
    return q.order('starts_at', { ascending: true }).limit(limit);
  };

  // 0.9 (Tom's decision): the org page INCLUDES its divisions'/teams' events
  // — page visibility ≠ calendar placement, and a house-league game IS org
  // activity. Structure ids first (bounded: an org's own rows), then three
  // scope queries merged, resorted, and re-capped.
  const [divisionRows, teamRows] = await Promise.all([
    admin.from('divisions').select('id').eq(column, orgId),
    admin.from('teams').select('id').eq(column, orgId),
  ]);
  const divisionIds = (divisionRows.data ?? []).map(r => r.id as string);
  const teamIds = (teamRows.data ?? []).map(r => r.id as string);

  const results = await Promise.all([
    base().eq(column, orgId),
    divisionIds.length > 0
      ? base().in('division_id', divisionIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length > 0
      ? base().in('team_id', teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const { error } of results) {
    // Pre-119/146 database (column missing → 42703) or missing table: an
    // empty schedule, never an error.
    if (error && !isMissingTableError(error.code) && error.code !== '42703') {
      console.error('[ORG EVENTS] list error:', error);
      return null;
    }
  }
  const seen = new Set<string>();
  return results
    .flatMap(r => (r.data ?? []) as unknown as OrgEvent[])
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, limit);
}

export async function orgEventsGET(
  request: NextRequest,
  side: 'league' | 'club',
  orgId: string
) {
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const params = request.nextUrl.searchParams;
  const query = clampScheduleQuery({
    limit: params.get('limit') ?? undefined,
    rangeDays: params.get('range_days') ?? undefined,
  });
  const events = await fetchOrgEvents(getSupabaseAdmin(), side, orgId, query);
  if (events === null) {
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
  }
  return NextResponse.json({ events });
}
