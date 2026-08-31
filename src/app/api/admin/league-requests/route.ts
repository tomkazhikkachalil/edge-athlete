import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueRequestDecisionSchema, isMissingTableError } from '@/lib/leagues/validate';
import { createLeagueWithOwner } from '@/lib/leagues/create';

// ── /api/admin/league-requests — the decision queue (116) ────────────────────
// Approval creates the league through the SAME createLeagueWithOwner path
// the admin console uses, then CLAIMS the request row with optimistic
// concurrency (.eq('status','pending')): zero rows updated means another
// admin decided mid-flight, and the freshly created league is rolled back.

/** GET — pending requests, oldest first (it's a queue), with requester. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: rows, error } = await supabase
      .from('league_requests')
      .select('id, requester_profile_id, name, description, sport_key, city, region, country, created_at, operates_competitions, operates_teams, structure_draft, connections_draft')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
      console.error('[ADMIN LEAGUE REQUESTS] list error:', error);
      return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }

    const list = rows ?? [];
    const requesterIds = [...new Set(list.map(r => r.requester_profile_id))];
    const { data: profiles } = requesterIds.length
      ? await supabase
          .from('profiles')
          .select('id, first_name, last_name, full_name, handle, email')
          .in('id', requesterIds)
      : { data: [] };
    const byId = new Map((profiles ?? []).map(p => [p.id, p]));

    return NextResponse.json({
      requests: list.map(r => ({ ...r, requester: byId.get(r.requester_profile_id) ?? null })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN LEAGUE REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { requestId, decision, reason? } — approve or decline. */
export async function PATCH(request: NextRequest) {
  try {
    // requireAuth for the reviewer's id; requireAdmin is the gate.
    const user = await requireAuth(request);
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, LeagueRequestDecisionSchema);
    if (!parsed.success) return parsed.response;
    const { requestId, decision, reason } = parsed.data;

    const { data: row, error: fetchError } = await supabase
      .from('league_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchError) {
      if (isMissingTableError(fetchError.code)) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      console.error('[ADMIN LEAGUE REQUESTS] fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'Request already decided' }, { status: 409 });
    }

    const decidedAt = new Date().toISOString();

    if (decision === 'approve') {
      // 1. Create the league first (the request row's nine location columns
      //    pass verbatim — no PlaceValue round-trip).
      const created = await createLeagueWithOwner(supabase, {
        name: row.name,
        description: row.description,
        sportKey: row.sport_key,
        ownerProfileId: row.requester_profile_id,
        placeColumns: {
          place_id: row.place_id,
          city: row.city,
          region: row.region,
          region_code: row.region_code,
          country: row.country,
          country_code: row.country_code,
          lat: row.lat,
          lng: row.lng,
          location_source: row.location_source,
        },
      });
      if ('error' in created) {
        return NextResponse.json({ error: 'Failed to create league from request' }, { status: 500 });
      }

      // 2. Claim the row. Zero rows = another admin decided mid-flight —
      //    roll the new league back (members cascade) and report the race.
      const { data: claimed, error: claimError } = await supabase
        .from('league_requests')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          decided_at: decidedAt,
          created_league_id: created.league.id,
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select();
      if (claimError || !claimed || claimed.length === 0) {
        if (claimError) console.error('[ADMIN LEAGUE REQUESTS] claim error:', claimError);
        await supabase.from('leagues').delete().eq('id', created.league.id);
        return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
      }

      // 3. Best-effort notification — never fails the decision.
      const { notifyLeagueRequestResult } = await import('@/lib/leagues/notify');
      await notifyLeagueRequestResult(supabase, {
        requesterProfileId: row.requester_profile_id,
        requestId,
        leagueName: row.name,
        approved: true,
        leagueId: created.league.id,
        reason: null,
      });

      return NextResponse.json({ ok: true, league: created.league });
    }

    // Decline (reason presence enforced by the schema).
    const { data: claimed, error: claimError } = await supabase
      .from('league_requests')
      .update({
        status: 'declined',
        decline_reason: reason,
        reviewed_by: user.id,
        decided_at: decidedAt,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select();
    if (claimError || !claimed || claimed.length === 0) {
      if (claimError) console.error('[ADMIN LEAGUE REQUESTS] decline error:', claimError);
      return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
    }

    const { notifyLeagueRequestResult } = await import('@/lib/leagues/notify');
    await notifyLeagueRequestResult(supabase, {
      requesterProfileId: row.requester_profile_id,
      requestId,
      leagueName: row.name,
      approved: false,
      leagueId: null,
      reason: reason ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN LEAGUE REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
