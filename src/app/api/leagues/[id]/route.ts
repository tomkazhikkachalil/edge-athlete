import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueUpdateSchema, placeToLeagueColumns, isMissingTableError } from '@/lib/leagues/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { orgMemberPreview, redactPendingRoster } from '@/lib/orgs/members';
import type { OrgRole } from '@/lib/orgs/authz';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id] — the public league read + owner/manager edit ──────────
// Leagues are always public (their search documents carry visibility
// 'public'), so GET needs no viewer gate — optional auth only resolves the
// viewer's own membership role for the page's Join/Leave/manage affordances.

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
    // Owner first, then managers, then members by join date (SQL can't order
    // by this role ranking without a CASE PostgREST won't emit).
    const members = redactPendingRoster([...memberRows], canManage, viewerId).sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    return NextResponse.json({
      league,
      memberCount: count,
      members,
      viewerRole,
      viewerRoster,
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
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('leagues')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (updateError || !updated) {
      console.error('[LEAGUES] update error:', updateError);
      return NextResponse.json({ error: 'Failed to update league' }, { status: 500 });
    }

    return NextResponse.json({ league: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUES] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
