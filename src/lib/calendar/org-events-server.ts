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

  const { data, error } = await admin
    .from('events')
    .select(ORG_EVENT_FIELDS)
    .eq(column, orgId)
    .eq('status', 'active')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(LIMIT);
  if (error) {
    // Pre-119 database (column missing → 42703) or missing table: an empty
    // schedule, never an error.
    if (isMissingTableError(error.code) || error.code === '42703') {
      return NextResponse.json({ events: [] });
    }
    console.error('[ORG EVENTS] list error:', error);
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
