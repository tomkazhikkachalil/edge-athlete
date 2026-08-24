import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubRequestDecisionSchema, isMissingTableError } from '@/lib/clubs/validate';
import { createClubWithOwner } from '@/lib/clubs/create';

// ── /api/admin/club-requests — the decision queue (117) ──────────────────────
// Mirror of /api/admin/league-requests: approval creates the club through
// createClubWithOwner, then CLAIMS the request row with optimistic
// concurrency (.eq('status','pending')) — zero rows updated means another
// admin decided mid-flight, and the fresh club is rolled back.

/** GET — pending requests, oldest first, with requester. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: rows, error } = await supabase
      .from('club_requests')
      .select('id, requester_profile_id, name, description, city, region, country, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
      console.error('[ADMIN CLUB REQUESTS] list error:', error);
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
    console.error('[ADMIN CLUB REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { requestId, decision, reason? } — approve or decline. */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, ClubRequestDecisionSchema);
    if (!parsed.success) return parsed.response;
    const { requestId, decision, reason } = parsed.data;

    const { data: row, error: fetchError } = await supabase
      .from('club_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchError) {
      if (isMissingTableError(fetchError.code)) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      console.error('[ADMIN CLUB REQUESTS] fetch error:', fetchError);
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
      const created = await createClubWithOwner(supabase, {
        name: row.name,
        description: row.description,
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
        return NextResponse.json({ error: 'Failed to create club from request' }, { status: 500 });
      }

      const { data: claimed, error: claimError } = await supabase
        .from('club_requests')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          decided_at: decidedAt,
          created_club_id: created.club.id,
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select();
      if (claimError || !claimed || claimed.length === 0) {
        if (claimError) console.error('[ADMIN CLUB REQUESTS] claim error:', claimError);
        await supabase.from('clubs').delete().eq('id', created.club.id);
        return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
      }

      const { notifyClubRequestResult } = await import('@/lib/clubs/notify');
      await notifyClubRequestResult(supabase, {
        requesterProfileId: row.requester_profile_id,
        requestId,
        clubName: row.name,
        approved: true,
        clubId: created.club.id,
        reason: null,
      });

      return NextResponse.json({ ok: true, club: created.club });
    }

    const { data: claimed, error: claimError } = await supabase
      .from('club_requests')
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
      if (claimError) console.error('[ADMIN CLUB REQUESTS] decline error:', claimError);
      return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
    }

    const { notifyClubRequestResult } = await import('@/lib/clubs/notify');
    await notifyClubRequestResult(supabase, {
      requesterProfileId: row.requester_profile_id,
      requestId,
      clubName: row.name,
      approved: false,
      clubId: null,
      reason: reason ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN CLUB REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
