import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubUpdateSchema, placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
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
    const members = redactPendingRoster([...memberRows], canManage, viewerId).sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    // 0.6b: derived sports (clubs have no cached sport — divisions only).
    const sports = await deriveOrgSports(supabase, { side: 'club', orgId: id }, null);

    return NextResponse.json({
      club,
      sports,
      // Phase 6b A1: the club page's "Public site" link — published only;
      // pre-155 or draft reads null (link hidden), never an error.
      site: await findPublishedSite(supabase, 'club', id),
      memberCount: count,
      members,
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
      console.error('[CLUBS] update error:', updateError);
      return NextResponse.json({ error: 'Failed to update club' }, { status: 500 });
    }

    return NextResponse.json({ club: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUBS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
