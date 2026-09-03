import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubUpdateSchema, placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { canViewPending, readApproval } from '@/lib/orgs/approval';
import { readClubAccess } from '@/lib/orgs/access';
import { viewerJoinRequest } from '@/lib/orgs/join-requests-server';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { isAdminEmail } from '@/lib/auth-server';
import { orgMemberPreview, redactPendingRoster } from '@/lib/orgs/members';
import { viewerRegistrationSummary } from '@/lib/orgs/registration-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { deriveOrgSports } from '@/lib/orgs/sports';
import type { OrgRole } from '@/lib/orgs/authz';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { findPublishedSite } from '@/lib/org-sites/revalidate';

// ── /api/clubs/[id] — the public club read + owner/manager edit ─────────────
// Mirror of /api/leagues/[id], minus the sport COLUMN (117 decision:
// multi-sport facilities). Sport identity arrives derived (0.6b): the
// `sports` payload key is the distinct division sports, empty for a
// structureless club. Clubs are always public; optional auth only resolves
// the viewer's membership role.

const MEMBER_PREVIEW = 12;
const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, member: 2 };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const supabase = getSupabaseAdmin();

    const { data: club, error } = await supabase
      .from('clubs')
      .select('id, name, description, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location, created_at, operates_teams, operates_competitions')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error.code)) {
        return NextResponse.json({ error: 'Club not found' }, { status: 404 });
      }
      console.error('[CLUBS] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (!club) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }

    const { count, members: memberRows, viewerRole, viewerRoster } = await orgMemberPreview(
      supabase,
      { side: 'club', orgId: id },
      viewerId,
      MEMBER_PREVIEW
    );

    // Pending roster offers are private to managers and the invitee.
    const canManage =
      roleAllows((viewerRole as OrgRole | null) ?? null, 'manage_members') ||
      (!!viewerId && viewerId === club.owner_profile_id);

    // Phase 7 C4: a PENDING club (provisioned at request time, awaiting
    // approval — 174) is visible to its managers and an admin only;
    // everyone else gets the same 404 as a missing club.
    const approval = await readApproval(supabase, 'club', id);
    const access = await readClubAccess(supabase, id);
    if (
      approval.pending &&
      !canViewPending({ canManage, isAdmin: isAdminEmail(user?.email, process.env.ADMIN_EMAILS) })
    ) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const members = redactPendingRoster([...memberRows], canManage, viewerId).sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    // 0.6b: derived sports (clubs have no cached sport — divisions only).
    const sports = await deriveOrgSports(supabase, { side: 'club', orgId: id }, null);

    // Phase 9 V4: a private club's member list is for members.
    const privateOutsider = access.visibility === 'private' && !viewerRole && viewerId !== club.owner_profile_id;

    return NextResponse.json({
      club,
      // C4: awaiting approval (managers/admins only ever see this true).
      pending: approval.pending,
      // C5: the sport the club leads with (174) — shapes the console.
      primarySport: approval.primarySport,
      // Phase 9 V1: the membership settings (176; pre-176 ⇒ public / open).
      visibility: access.visibility,
      joinPolicy: access.joinPolicy,
      // V2: the viewer's own queued request (approval clubs).
      viewerRequestPending: !!(await viewerJoinRequest(supabase, 'club', id, viewerId)),
      sports,
      // Phase 6b A1: the club page's "Public site" link — published only;
      // pre-155 or draft reads null (link hidden), never an error.
      site: await findPublishedSite(supabase, 'club', id),
      memberCount: count,
      members: privateOutsider ? [] : members,
      viewerRole,
      viewerRoster,
      // Phase 5 R3: the Register banner's data — flag-off/pre-162 reads
      // as closed/none (surface hidden), never an error.
      viewerRegistration: await viewerRegistrationSummary(
        supabase,
        'club',
        id,
        viewerId,
        FEATURE_FLAGS.FEATURE_ORG_REGISTRATION
      ),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUBS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH — owner or manager edits name/description/place. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const loaded = await getOrgAndRole(supabase, 'club', id, user.id);
    if (loaded.status === 'error') {
      console.error('[CLUBS] PATCH fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    if (!roleAllows(loaded.role, 'manage_org')) {
      return NextResponse.json({ error: 'Not authorized to edit this club' }, { status: 403 });
    }

    const parsed = await parseBody(request, ClubUpdateSchema);
    if (!parsed.success) return parsed.response;

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.place !== undefined) {
      Object.assign(updates, placeToClubColumns(parsed.data.place));
    }
    // Phase 9 V1: the membership settings (176).
    if (parsed.data.visibility !== undefined) updates.visibility = parsed.data.visibility;
    if (parsed.data.joinPolicy !== undefined) updates.join_policy = parsed.data.joinPolicy;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('clubs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (updateError || !updated) {
      if (updateError?.code === 'PGRST204' && /visibility|join_policy/.test(updateError.message ?? '')) {
        return NextResponse.json({ error: 'Membership settings are not available yet' }, { status: 503 });
      }
      console.error('[CLUBS] update error:', updateError);
      return NextResponse.json({ error: 'Failed to update club' }, { status: 500 });
    }

    // Phase 9 V1: the org site reads the club's visibility — a flip must not
    // serve members-only content for another 300s (this PATCH never
    // revalidated; the name/place edits ride along now too).
    await revalidateOrgSiteForOrg(supabase, 'club', id);
    // V6: the club directory shows "Private club" — a flip purges it too.
    if (parsed.data.visibility !== undefined) revalidateTag('org-sitemap', { expire: 0 });

    return NextResponse.json({ club: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUBS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
