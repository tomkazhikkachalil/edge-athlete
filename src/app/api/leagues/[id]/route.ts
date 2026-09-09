import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueUpdateSchema, placeToLeagueColumns, isMissingTableError } from '@/lib/leagues/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { readListing } from '@/lib/orgs/listing';
import { applyListing } from '@/lib/orgs/listing-server';
import { orgMemberPreview, redactPendingRoster } from '@/lib/orgs/members';
import { viewerRegistrationSummary } from '@/lib/orgs/registration-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { deriveOrgSports } from '@/lib/orgs/sports';
import type { OrgRole } from '@/lib/orgs/authz';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { readSiteBrandRow, revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { buildOrgBrand } from '@/lib/org-sites/brand';
import { buildAppComposition } from '@/lib/site-builder/app-composition';
import { readOrgAccess } from '@/lib/orgs/access';
import { viewerJoinRequest } from '@/lib/orgs/join-requests-server';

// ── /api/leagues/[id] — the public league read + owner/manager edit ──────────
// The GET needs no viewer gate — optional auth only resolves the viewer's
// own membership role for the page's Join/Leave/manage affordances. Program
// 11: a league can be private (177) — the member preview is then for
// members, and the site's gates read the same column.

const MEMBER_PREVIEW = 12;
const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, member: 2 };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const supabase = getSupabaseAdmin();

    const { data: league, error } = await supabase
      .from('leagues')
      .select('id, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, created_at, operates_competitions, operates_teams')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      // Pre-113 database (42P01/PGRST205): the page shows not-found, never a 500.
      if (isMissingTableError(error.code)) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 });
      }
      console.error('[LEAGUES] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
    }
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const { count, members: memberRows, viewerRole, viewerRoster } = await orgMemberPreview(
      supabase,
      { side: 'league', orgId: id },
      viewerId,
      MEMBER_PREVIEW
    );

    // Pending roster offers are private to managers and the invitee.
    const canManage =
      roleAllows((viewerRole as OrgRole | null) ?? null, 'manage_members') ||
      (!!viewerId && viewerId === league.owner_profile_id);

    // Onboarding v2 R1 (179): an org is LIVE BY LINK from creation — the
    // pending 404 is gone (the join door depends on this GET). The listing
    // state rides along for the chips; approval gates only the directory,
    // the sitemap, search and the robots index.
    const listing = await readListing(supabase, 'league', id);
    const access = await readOrgAccess(supabase, 'league', id);
    // Owner first, then managers, then members by join date (SQL can't order
    // by this role ranking without a CASE PostgREST won't emit).
    const members = redactPendingRoster([...memberRows], canManage, viewerId).sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    // 0.6b: derived sports (division sports ∪ the cached primary sport).
    const sports = await deriveOrgSports(
      supabase,
      { side: 'league', orgId: id },
      (league.sport_key as string | null) ?? null
    );

    // Program 11: a private league's member list is for members.
    const privateOutsider = access.visibility === 'private' && !viewerRole && viewerId !== league.owner_profile_id;

    // Phase 10: the brand row + the site's stored layout (published, or the
    // draft's while offline) — the composition the in-app page follows.
    const siteRow = await readSiteBrandRow(supabase, 'league', id, { layout: true });
    const composition = buildAppComposition(siteRow?.layout ?? null, { isMember: !!viewerRole || (!!viewerId && viewerId === league.owner_profile_id), canManage });
    return NextResponse.json({
      league,
      // R1: the listing state (pending = a listing request is in the queue).
      pending: listing.status === 'pending',
      listing: listing.status,
      sports,
      // Program 11: the membership settings (177; pre-177 ⇒ public / open).
      visibility: access.visibility,
      joinPolicy: access.joinPolicy,
      // The viewer's own queued request (approval leagues).
      viewerRequestPending: !!(await viewerJoinRequest(supabase, 'league', id, viewerId)),
      // Phase 6b A1: the league page's "Public site" link — published only;
      // pre-155 or draft reads null (link hidden), never an error.
      site: siteRow?.published_at ? { subdomain: siteRow.subdomain } : null,
      // Org Pages R2: the in-app brand (logo, hero, accent) — draft or
      // published, for every viewer (the bytes are already anonymous).
      brand: buildOrgBrand(siteRow),
      // Phase 10: the app-capable instances of the site's layout in reading
      // order, pruned to this viewer; null = no stored layout (registry order).
      composition,
      memberCount: count,
      members: privateOutsider ? [] : members,
      viewerRole,
      viewerRoster,
      // Phase 5 R3: the Register banner's data — flag-off/pre-162 reads
      // as closed/none (surface hidden), never an error.
      viewerRegistration: await viewerRegistrationSummary(
        supabase,
        'league',
        id,
        viewerId,
        FEATURE_FLAGS.FEATURE_ORG_REGISTRATION
      ),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH — owner or manager edits name/description/place. sport_key is
 *  immutable in v1 (absent from the schema): a league is one sport, and
 *  changing it would silently re-home every member. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const loaded = await getOrgAndRole(supabase, 'league', id, user.id);
    if (loaded.status === 'error') {
      console.error('[LEAGUES] PATCH fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    if (!roleAllows(loaded.role, 'manage_org')) {
      return NextResponse.json({ error: 'Not authorized to edit this league' }, { status: 403 });
    }

    const parsed = await parseBody(request, LeagueUpdateSchema);
    if (!parsed.success) return parsed.response;

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    // place: null clears the location; absent leaves it untouched.
    if (parsed.data.place !== undefined) {
      Object.assign(updates, placeToLeagueColumns(parsed.data.place));
    }
    // Program 11: the membership settings (177).
    if (parsed.data.visibility !== undefined) updates.visibility = parsed.data.visibility;
    if (parsed.data.joinPolicy !== undefined) updates.join_policy = parsed.data.joinPolicy;
    // Onboarding v2 R1 (179): the directory listing has its own path (the
    // request row + the admin bell) — applied after the column updates.
    const listingChange = parsed.data.listing;
    if (Object.keys(updates).length === 0 && !listingChange) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    let updated: Record<string, unknown> | null = null;
    if (Object.keys(updates).length > 0) {
      const { data: row, error: updateError } = await supabase
        .from('leagues')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (updateError || !row) {
        if (updateError?.code === 'PGRST204' && /visibility|join_policy/.test(updateError.message ?? '')) {
          return NextResponse.json({ error: 'Membership settings are not available yet' }, { status: 503 });
        }
        console.error('[LEAGUES] update error:', updateError);
        return NextResponse.json({ error: 'Failed to update league' }, { status: 500 });
      }
      updated = row as Record<string, unknown>;
    }
    if (listingChange) {
      const orgName = (updated?.name as string | undefined) ?? loaded.org.name;
      const applied = await applyListing(supabase, { side: 'league', orgId: id, orgName, actorId: user.id, target: listingChange });
      if (applied instanceof NextResponse) return applied;
    }

    // Program 11: the org site reads the league's visibility — a flip must
    // not serve members-only content for another 300s (this PATCH never
    // revalidated; the name/place edits ride along now too).
    await revalidateOrgSiteForOrg(supabase, 'league', id);
    // The league directory (L3) and the sitemap follow a visibility flip.
    if (parsed.data.visibility !== undefined) revalidateTag('org-sitemap', { expire: 0 });

    return NextResponse.json({
      league: updated ?? (await supabase.from('leagues').select('*').eq('id', id).maybeSingle()).data,
      ...(listingChange ? { listing: listingChange } : {}),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUES] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
