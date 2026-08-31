// ── Org upcoming events — the shared core (119) ─────────────────────────────
// Both org routes (/api/leagues/[id]/events, /api/clubs/[id]/events) wrap
// these. Public reads: org pages are public, and the select is
// guest-data-free (no event_guests columns ever leave here). The calendar's
// own guest-row-driven access paths are untouched — this is the org PAGE's
// schedule, per the no-fan-out v1 decision.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { isMissingTableError } from '@/lib/leagues/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

const LIMIT = 10;

/** Public columns only — deliberately no organizer/guest data. venue_id/
 *  facility_id (141) are included DELIBERATELY: harmless ids on a public
 *  schedule, and the future venue picker must not silently drop here. */
const ORG_EVENT_FIELDS =
  'id, title, description, location, starts_at, ends_at, all_day, timezone, category, venue_id, facility_id';

export async function orgEventsGET(
  request: NextRequest,
  side: 'league' | 'club',
  orgId: string
) {
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();
  const column = side === 'league' ? 'league_id' : 'club_id';
  const nowIso = new Date().toISOString();

  const base = () =>
    admin
      .from('events')
      .select(ORG_EVENT_FIELDS)
      .eq('status', 'active')
      .gte('starts_at', nowIso)
      .order('starts_at', { ascending: true })
      .limit(LIMIT);

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
      return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
    }
  }
  const seen = new Set<string>();
  const events = results
    .flatMap(r => (r.data ?? []) as { id: string; starts_at: string }[])
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, LIMIT);

  return NextResponse.json({ events });
}
