import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubRequestDecisionSchema, isMissingTableError } from '@/lib/clubs/validate';
import { createClubWithOwner } from '@/lib/clubs/create';
import { revalidateTag } from 'next/cache';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { draftPreviewUrls } from '@/lib/orgs/pending-org';

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
      .select('id, requester_profile_id, name, description, city, region, country, created_at, operates_competitions, operates_teams, structure_draft, connections_draft, created_club_id')
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

    // C4: a provisioned club has a DRAFT site — a signed preview link lets
    // the admin see what they are approving (requireOrgManager gives admins
    // nothing, so the queue mints it). Best-effort: no site/secret → null.
    const previewByOrg = await draftPreviewUrls(
      supabase,
      'club',
      list.map(r => (r as { created_club_id?: string | null }).created_club_id ?? null)
    );
    return NextResponse.json({
      requests: list.map(r => ({
        ...r,
        requester: byId.get(r.requester_profile_id) ?? null,
        previewUrl: previewByOrg.get((r as { created_club_id?: string | null }).created_club_id ?? '') ?? null,
      })),
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
      // C4: BUILD WHILE WAITING — the club usually already exists (provisioned
      // at request time, approved_at NULL). ADOPT it: structure replays into
      // it, approval stamps approved_at, and a failure never deletes it (it
      // holds the owner's work). No provisioned club → today's create path.
      const { data: adoptedRow } = row.created_club_id
        ? await supabase.from('clubs').select('*').eq('id', row.created_club_id).maybeSingle()
        : { data: null };
      const adopted = (adoptedRow as { id: string; name: string } | null) ?? null;
      const created = adopted ? { club: adopted } : await createClubWithOwner(supabase, {
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
        return NextResponse.json({ error: 'Failed to create club from request' }, { status: 500 });
      }

      // STRUCTURE REPLAY — STRICT, before the claim (see the league mirror).
      const { planStructureReplay, replayStructure } = await import('@/lib/orgs/wizard-replay');
      const plan = planStructureReplay(row.structure_draft, 'club', null);
      let structureCounts: { divisions: number; teams: number } | null = null;
      if (plan) {
        const replayed = await replayStructure(supabase, { side: 'club', orgId: created.club.id }, plan);
        if (!replayed.ok) {
          console.error('[ADMIN CLUB REQUESTS] structure replay failed at', replayed.step, replayed.status);
          if (!adopted) await supabase.from('clubs').delete().eq('id', created.club.id);
          return NextResponse.json(
            { error: 'Failed to build the club structure — the request is still pending; try approving again' },
            { status: 500 }
          );
        }
        structureCounts = replayed.counts;
      }

      if (adopted) {
        // R1 (179): approval LISTS the org (and stamps the approval time; a
        // re-listing after "link only" re-stamps). Pre-179: approved_at only.
        let { error: stampError } = await supabase
          .from('clubs')
          .update({ approved_at: decidedAt, listing_status: 'listed' })
          .eq('id', adopted.id);
        if (stampError?.code === 'PGRST204' && /listing_status/.test(stampError.message ?? '')) {
          ({ error: stampError } = await supabase.from('clubs').update({ approved_at: decidedAt }).eq('id', adopted.id));
        }
        if (stampError) {
          console.error('[ADMIN CLUB REQUESTS] approve stamp error:', stampError);
          return NextResponse.json({ error: 'Failed to approve the club — try again' }, { status: 500 });
        }
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
        if (!adopted) await supabase.from('clubs').delete().eq('id', created.club.id);
        return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
      }

      // R1: the site's cached `listed` and the directory/sitemap follow.
      await revalidateOrgSiteForOrg(supabase, 'club', created.club.id);
      revalidateTag('org-sitemap', { expire: 0 });

      // CONNECTIONS REPLAY — BEST-EFFORT after the claim.
      const { replayConnections } = await import('@/lib/orgs/wizard-replay');
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const connectionReport = await replayConnections(
        supabase,
        { side: 'club', orgId: created.club.id },
        row.name,
        row.connections_draft,
        row.requester_profile_id,
        user.id,
        appUrl
      );

      const { notifyClubRequestResult } = await import('@/lib/clubs/notify');
      await notifyClubRequestResult(supabase, {
        requesterProfileId: row.requester_profile_id,
        requestId,
        clubName: row.name,
        approved: true,
        clubId: created.club.id,
        reason: null,
      });

      return NextResponse.json({
        ok: true,
        club: created.club,
        replay: {
          structure: structureCounts,
          connections: connectionReport.connections,
          stubs: connectionReport.stubs,
        },
      });
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

    // R1 (179): a declined LISTING leaves the org alive as link-only — it is
    // someone's live work now (was C4: delete the pending org). The request
    // row keeps its drafts; the owner can ask again from the console.
    if (row.created_club_id) {
      const { error: unlistError } = await supabase
        .from('clubs')
        .update({ listing_status: 'unlisted' })
        .eq('id', row.created_club_id);
      if (unlistError && !(unlistError.code === 'PGRST204' && /listing_status/.test(unlistError.message ?? ''))) {
        console.error('[ADMIN CLUB REQUESTS] unlist error:', unlistError);
      }
      await revalidateOrgSiteForOrg(supabase, 'club', row.created_club_id);
      revalidateTag('org-sitemap', { expire: 0 });
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
