import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { placeToLeagueColumns, isMissingTableError } from '@/lib/leagues/validate';
import { LeagueRequestWizardSchema } from '@/lib/orgs/wizard-validate';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';

// ── /api/leagues/requests — self-service "Start a league" (116) ─────────────
// The org-signup flow: any signed-in user submits a request; admins decide
// on /dashboard/leagues. The requester is ALWAYS the session user (the
// schema strips any client-sent ownerProfileId). ONE pending request per
// user, enforced by the partial unique index — its 23505 is the authority,
// no racy pre-check.

/** POST — submit a request. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'league-request', { userId: user.id });
    if (limited) return limited;

    const parsed = await parseBody(request, LeagueRequestWizardSchema);
    if (!parsed.success) return parsed.response;
    const { name, sportKey, description, place, capabilities, structure, connections, siteDraft } = parsed.data;

    if (!isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }
    // Phase 7 C2: a league's site draft always leads with ITS sport; any
    // extra sports listed pass the same gate.
    for (const key of siteDraft?.sports ?? []) {
      if (!isSportEnabled(key as SportKey)) {
        return NextResponse.json({ error: `Unknown or disabled sport: ${key}` }, { status: 400 });
      }
    }
    const siteDraftRow = {
      ...(siteDraft ?? {}),
      sports: [sportKey, ...(siteDraft?.sports ?? []).filter(k => k !== sportKey)],
    };
    // Server-truth stamp: a league's divisions ARE its sport — client
    // values are untrusted (the 113 route-gates-sport convention).
    const structureDraft = structure
      ? { ...structure, divisions: structure.divisions.map(d => ({ ...d, sportKey })) }
      : null;

    const supabase = getSupabaseAdmin();
    const insertRow = {
      requester_profile_id: user.id,
      name,
      description: description ?? null,
      sport_key: sportKey,
      ...placeToLeagueColumns(place),
      operates_competitions: capabilities?.operatesCompetitions ?? null,
      operates_teams: capabilities?.operatesTeams ?? null,
      structure_draft: structureDraft,
      connections_draft: connections ?? null,
    };
    let { data: row, error } = await supabase
      .from('league_requests')
      .insert({ ...insertRow, site_draft: siteDraftRow })
      .select()
      .single();
    if (error?.code === 'PGRST204' && /site_draft/.test(error.message ?? '')) {
      // Pre-174 database: the request still lands; only the site draft is dropped.
      console.warn('[LEAGUE REQUESTS] site_draft column missing — run migration 174');
      ({ data: row, error } = await supabase.from('league_requests').insert(insertRow).select().single());
    }
    if (error || !row) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'You already have a league request waiting for review' },
          { status: 409 }
        );
      }
      if (isMissingTableError(error?.code)) {
        // Pre-116 database: the page exists, the table doesn't — 503 keeps
        // that distinct from a real not-found in the logs.
        return NextResponse.json({ error: 'League requests are not available yet' }, { status: 503 });
      }
      console.error('[LEAGUE REQUESTS] insert error:', error);
      return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
    }

    return NextResponse.json({ request: row });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE REQUESTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — the caller's own requests, newest first (powers /league/start's
 *  pending / declined / approved states). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('league_requests')
      .select('id, name, sport_key, description, city, region, country, status, decline_reason, decided_at, created_league_id, created_at')
      .eq('requester_profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
      console.error('[LEAGUE REQUESTS] list error:', error);
      return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }
    return NextResponse.json({ requests: data ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
