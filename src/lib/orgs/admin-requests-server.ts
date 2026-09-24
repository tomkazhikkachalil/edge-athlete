// ── The admin decision queue for org requests (116 / 117), one handler for
// both kinds since Round 5 D3 (236: `org_requests`) ─────────────────────────
// Approval creates the org through the SAME createLeagueWithOwner /
// createClubWithOwner path the admin console uses — or ADOPTS the org the
// request already provisioned (C4: build while waiting) — replays the
// structure draft STRICTLY, then CLAIMS the request row with optimistic
// concurrency (.eq('status','pending')): zero rows updated means another
// admin decided mid-flight, and a freshly created org is rolled back (an
// adopted one never is — it holds the owner's work). Connections replay
// best-effort after the claim. The wire shape keeps the kind's words
// (`league: …` / `club: …`, `created_league_id` / `created_club_id`).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { OrgRequestDecisionSchema, isMissingTableError } from '@/lib/orgs/validate';
import { createOrgWithOwner } from './create';
import { revalidateTag } from 'next/cache';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { draftPreviewUrls } from '@/lib/orgs/pending-org';
import { reportRouteError } from '@/lib/observability/report';
import type { OrgKind } from './org-ref';
import { publicRequestRow } from './requests-server';

const TAG: Record<OrgKind, string> = { league: '[ADMIN LEAGUE REQUESTS]', club: '[ADMIN CLUB REQUESTS]' };

/** GET — pending requests of this kind, oldest first (it's a queue), with the requester. */
export async function adminRequestsGET(request: NextRequest, kind: OrgKind) {
  await requireAdmin(request);
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from('org_requests')
    .select('id, requester_profile_id, name, description, sport_key, city, region, country, created_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft, created_org_id')
    .eq('kind', kind)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
    reportRouteError(`${TAG[kind]} list error:`, error);
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  }

  const list = rows ?? [];
  const requesterIds = [...new Set(list.map(r => r.requester_profile_id as string))];
  const { data: profiles } = requesterIds.length
    ? await supabase.from('profiles').select('id, first_name, last_name, full_name, handle, email').in('id', requesterIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map(p => [p.id, p]));

  // C4: a provisioned org has a DRAFT site — a signed preview link lets the
  // admin see what they are approving (requireOrgManager gives admins
  // nothing, so the queue mints it). Best-effort: no site/secret → null.
  const previewByOrg = await draftPreviewUrls(supabase, kind, list.map(r => (r.created_org_id as string | null) ?? null));
  return NextResponse.json({
    requests: list.map(r => ({
      ...publicRequestRow(kind, r as { created_org_id?: string | null }),
      requester: byId.get(r.requester_profile_id as string) ?? null,
      previewUrl: previewByOrg.get((r.created_org_id as string | null) ?? '') ?? null,
    })),
  });
}

/** The kind's create path over the request row's columns (the nine location
 *  columns pass verbatim — no PlaceValue round-trip). */
async function createFromRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  kind: OrgKind,
  row: Record<string, unknown>
): Promise<{ org: { id: string; name: string } } | { error: string }> {
  const common = {
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    ownerProfileId: row.requester_profile_id as string,
    placeColumns: {
      place_id: row.place_id as string | null,
      city: row.city as string | null,
      region: row.region as string | null,
      region_code: row.region_code as string | null,
      country: row.country as string | null,
      country_code: row.country_code as string | null,
      lat: row.lat as number | null,
      lng: row.lng as number | null,
      location_source: row.location_source as string | null,
    },
    // 149 tristate: NULL wizard columns pass nothing → 142 defaults.
    capabilities:
      row.operates_competitions === null || row.operates_competitions === undefined
        ? undefined
        : {
            operatesCompetitions: row.operates_competitions as boolean,
            operatesTeams: (row.operates_teams as boolean | null) ?? false,
          },
  };
  // A league's sport is its own (required); a club's request carries none.
  return createOrgWithOwner(supabase, { ...common, kind, sportKey: kind === 'league' ? (row.sport_key as string) : null });
}

/** PATCH { requestId, decision, reason? } — approve or decline. */
export async function adminRequestsPATCH(request: NextRequest, kind: OrgKind) {
  // requireAuth for the reviewer's id; requireAdmin is the gate.
  const user = await requireAuth(request);
  await requireAdmin(request);
  const supabase = getSupabaseAdmin();
  const label = kind === 'league' ? 'league' : 'club';

  const parsed = await parseBody(request, OrgRequestDecisionSchema);
  if (!parsed.success) return parsed.response;
  const { requestId, decision, reason } = parsed.data;

  const { data: row, error: fetchError } = await supabase
    .from('org_requests')
    .select('*')
    .eq('id', requestId)
    .eq('kind', kind)
    .maybeSingle();
  if (fetchError) {
    if (isMissingTableError(fetchError.code)) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    reportRouteError(`${TAG[kind]} fetch error:`, fetchError);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (row.status !== 'pending') return NextResponse.json({ error: 'Request already decided' }, { status: 409 });

  const decidedAt = new Date().toISOString();
  const createdOrgId = (row.created_org_id as string | null) ?? null;

  if (decision === 'approve') {
    // C4: BUILD WHILE WAITING — the org usually already exists (provisioned
    // at request time, approved_at NULL). ADOPT it: structure replays into
    // it, approval stamps approved_at, and a failure never deletes it (it
    // holds the owner's work). No provisioned org → today's create path.
    const { data: adoptedRow } = createdOrgId
      ? await supabase.from('organizations').select('*').eq('id', createdOrgId).maybeSingle()
      : { data: null };
    const adopted = (adoptedRow as { id: string; name: string } | null) ?? null;
    const created = adopted ? { org: adopted } : await createFromRow(supabase, kind, row as Record<string, unknown>);
    if ('error' in created) {
      return NextResponse.json({ error: `Failed to create ${label} from request` }, { status: 500 });
    }
    const org = created.org;

    // STRUCTURE REPLAY — STRICT, before the claim: any failure deletes a
    // fresh org (145 cascades erase everything) and the request stays
    // pending, so the retry is a free second click.
    const { planStructureReplay, replayStructure } = await import('@/lib/orgs/wizard-replay');
    const plan = planStructureReplay(row.structure_draft, kind, kind === 'league' ? (row.sport_key as string) : null);
    let structureCounts: { divisions: number; teams: number } | null = null;
    if (plan) {
      const replayed = await replayStructure(supabase, { side: kind, orgId: org.id }, plan);
      if (!replayed.ok) {
        reportRouteError(`${TAG[kind]} structure replay failed at`, replayed.step, replayed.status);
        if (!adopted) await supabase.from('organizations').delete().eq('id', org.id);
        return NextResponse.json(
          { error: `Failed to build the ${label} structure — the request is still pending; try approving again` },
          { status: 500 }
        );
      }
      structureCounts = replayed.counts;
    }

    // Claim the row. Zero rows = another admin decided mid-flight — roll a
    // fresh org back (members cascade) and report the race.
    if (adopted) {
      // R1 (179): approval LISTS the org (and stamps the approval time; a re-listing after "link only" re-stamps).
      const { error: stampError } = await supabase
        .from('organizations')
        .update({ approved_at: decidedAt, listing_status: 'listed' })
        .eq('id', adopted.id);
      if (stampError) {
        reportRouteError(`${TAG[kind]} approve stamp error:`, stampError);
        return NextResponse.json({ error: `Failed to approve the ${label} — try again` }, { status: 500 });
      }
    }
    const { data: claimed, error: claimError } = await supabase
      .from('org_requests')
      .update({ status: 'approved', reviewed_by: user.id, decided_at: decidedAt, created_org_id: org.id })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select();
    if (claimError || !claimed || claimed.length === 0) {
      if (claimError) reportRouteError(`${TAG[kind]} claim error:`, claimError);
      if (!adopted) await supabase.from('organizations').delete().eq('id', org.id);
      return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
    }

    // CONNECTIONS REPLAY — BEST-EFFORT after the claim: a partner hiccup
    // never forces deleting a fully-built approved org. R1: the site's
    // cached `listed` and the directory / sitemap follow.
    await revalidateOrgSiteForOrg(supabase, kind, org.id);
    revalidateTag('org-sitemap', { expire: 0 });

    const { replayConnections } = await import('@/lib/orgs/wizard-replay');
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
    const connectionReport = await replayConnections(
      supabase,
      { side: kind, orgId: org.id },
      row.name as string,
      row.connections_draft,
      row.requester_profile_id as string,
      user.id,
      appUrl
    );

    // Best-effort notification — never fails the decision.
    await notifyResult(supabase, kind, { requesterProfileId: row.requester_profile_id as string, requestId, name: row.name as string, approved: true, orgId: org.id, reason: null });

    return NextResponse.json({
      ok: true,
      [kind]: org,
      replay: { structure: structureCounts, connections: connectionReport.connections, stubs: connectionReport.stubs },
    });
  }

  // Decline (reason presence enforced by the schema).
  const { data: claimed, error: claimError } = await supabase
    .from('org_requests')
    .update({ status: 'declined', decline_reason: reason, reviewed_by: user.id, decided_at: decidedAt })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select();
  if (claimError || !claimed || claimed.length === 0) {
    if (claimError) reportRouteError(`${TAG[kind]} decline error:`, claimError);
    return NextResponse.json({ error: 'Request was decided by someone else' }, { status: 409 });
  }

  // R1 (179): a declined LISTING leaves the org alive as link-only — it is
  // someone's live work now (was C4: delete the pending org). The request
  // row keeps its drafts; the owner can ask again from the console.
  if (createdOrgId) {
    const { error: unlistError } = await supabase.from('organizations').update({ listing_status: 'unlisted' }).eq('id', createdOrgId);
    if (unlistError) reportRouteError(`${TAG[kind]} unlist error:`, unlistError);
    await revalidateOrgSiteForOrg(supabase, kind, createdOrgId);
    revalidateTag('org-sitemap', { expire: 0 });
  }

  await notifyResult(supabase, kind, { requesterProfileId: row.requester_profile_id as string, requestId, name: row.name as string, approved: false, orgId: null, reason: reason ?? null });
  return NextResponse.json({ ok: true });
}

async function notifyResult(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  kind: OrgKind,
  n: { requesterProfileId: string; requestId: string; name: string; approved: boolean; orgId: string | null; reason: string | null }
) {
  const { notifyOrgRequestResult } = await import('@/lib/orgs/notify');
  await notifyOrgRequestResult(supabase, { kind, requesterProfileId: n.requesterProfileId, requestId: n.requestId, orgName: n.name, approved: n.approved, orgId: n.orgId, reason: n.reason });
}
