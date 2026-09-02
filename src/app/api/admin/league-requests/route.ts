import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueRequestDecisionSchema, isMissingTableError } from '@/lib/leagues/validate';
import { createLeagueWithOwner } from '@/lib/leagues/create';
import { readApproval, shouldDeleteOnDecline } from '@/lib/orgs/approval';
import { draftPreviewUrls } from '@/lib/orgs/pending-org';

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
      .select('id, requester_profile_id, name, description, sport_key, city, region, country, created_at, operates_competitions, operates_teams, structure_draft, connections_draft, created_league_id')
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

    // C4: a provisioned league has a DRAFT site — a signed preview link lets
    // the admin see what they are approving (requireOrgManager gives admins
    // nothing, so the queue mints it). Best-effort: no site/secret → null.
    const previewByOrg = await draftPreviewUrls(
      supabase,
      'league',
      list.map(r => (r as { created_league_id?: string | null }).created_league_id ?? null)
    );
    return NextResponse.json({
      requests: list.map(r => ({
        ...r,
        requester: byId.get(r.requester_profile_id) ?? null,
        previewUrl: previewByOrg.get((r as { created_league_id?: string | null }).created_league_id ?? '') ?? null,
      })),
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
      // C4: BUILD WHILE WAITING — the league usually already exists (provisioned
      // at request time, approved_at NULL). ADOPT it: structure replays into
      // it, approval stamps approved_at, and a failure never deletes it (it
      // holds the owner's work). No provisioned league → today's create path.
      const { data: adoptedRow } = row.created_league_id
        ? await supabase.from('leagues').select('*').eq('id', row.created_league_id).is('approved_at', null).maybeSingle()
        : { data: null };
      const adopted = (adoptedRow as { id: string; name: string } | null) ?? null;
      const created = adopted ? { league: adopted } : await createLeagueWithOwner(supabase, {
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
        // 149 tristate: NULL wizard columns pass nothing → 142 defaults.
        capabilities:
          row.operates_competitions === null || row.operates_competitions === undefined
            ? undefined
            : {
                operatesCompetitions: row.operates_competitions,
                operatesTeams: row.operates_teams ?? false,
              },
      });
      if ('error' in created) {
        return NextResponse.json({ error: 'Failed to create league from request' }, { status: 500 });
      }

      // 1b. STRUCTURE REPLAY — STRICT, before the claim: any failure
      //     deletes the org (145 cascades erase everything) and the request
      //     stays pending, so the retry is a free second click.
      const { planStructureReplay, replayStructure } = await import('@/lib/orgs/wizard-replay');
      const plan = planStructureReplay(row.structure_draft, 'league', row.sport_key);
      let structureCounts: { divisions: number; teams: number } | null = null;
      if (plan) {
        const replayed = await replayStructure(supabase, { side: 'league', orgId: created.league.id }, plan);
        if (!replayed.ok) {
          console.error('[ADMIN LEAGUE REQUESTS] structure replay failed at', replayed.step, replayed.status);
          if (!adopted) await supabase.from('leagues').delete().eq('id', created.league.id);
          return NextResponse.json(
            { error: 'Failed to build the league structure — the request is still pending; try approving again' },
            { status: 500 }
          );
        }
        structureCounts = replayed.counts;
      }

      // 2. Claim the row. Zero rows = another admin decided mid-flight —
      //    roll the new league back (members cascade) and report the race.
      if (adopted) {
        const { error: stampError } = await supabase
          .from('leagues')
          .update({ approved_at: decidedAt })
          .eq('id', adopted.id)
          .is('approved_at', null);
        if (stampError) {
          console.error('[ADMIN LEAGUE REQUESTS] approve stamp error:', stampError);
          return NextResponse.json({ error: 'Failed to approve the league — try again' }, { status: 500 });
        }
      }
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
        if (!adopted) await supabase.from('leagues').delete().eq('id', created.league.id);
        return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
      }

      // 2b. CONNECTIONS REPLAY — BEST-EFFORT after the claim: a partner
      //     hiccup never forces deleting a fully-built approved org.
      const { replayConnections } = await import('@/lib/orgs/wizard-replay');
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const connectionReport = await replayConnections(
        supabase,
        { side: 'league', orgId: created.league.id },
        row.name,
        row.connections_draft,
        row.requester_profile_id,
        user.id,
        appUrl
      );

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

      return NextResponse.json({
        ok: true,
        league: created.league,
        replay: {
          structure: structureCounts,
          connections: connectionReport.connections,
          stubs: connectionReport.stubs,
        },
      });
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

    // C4: a declined request's provisioned league goes away — ONLY while it
    // is still pending (an approved league is never collateral). The
    // cascade is the same rollback create.ts relies on; the request row
    // keeps its name and drafts (FK SET NULL) so a resubmit is one click.
    if (row.created_league_id) {
      const approval = await readApproval(supabase, 'league', row.created_league_id);
      if (approval.known && shouldDeleteOnDecline({ createdOrgId: row.created_league_id, approvedAt: approval.approvedAt })) {
        const { error: deleteError } = await supabase
          .from('leagues')
          .delete()
          .eq('id', row.created_league_id)
          .is('approved_at', null);
        if (deleteError) console.error('[ADMIN LEAGUE REQUESTS] pending league delete error:', deleteError);
      }
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
