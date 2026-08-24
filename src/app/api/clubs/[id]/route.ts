import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubUpdateSchema, placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id] — the public club read + owner/manager edit ─────────────
// Mirror of /api/leagues/[id], minus sport. Clubs are always public;
// optional auth only resolves the viewer's membership role.

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
      .select('id, name, description, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location, created_at')
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

    const [countRes, membersRes, viewerRes] = await Promise.all([
      supabase
        .from('club_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('club_id', id),
      supabase
        .from('club_members')
        .select('profile_id, role, joined_at, profile:profile_id (id, handle, first_name, last_name, full_name, avatar_url)')
        .eq('club_id', id)
        .order('joined_at', { ascending: true })
        .limit(MEMBER_PREVIEW),
      viewerId
        ? supabase
            .from('club_members')
            .select('role')
            .eq('club_id', id)
            .eq('profile_id', viewerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const members = (membersRes.data ?? []).sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    return NextResponse.json({
      club,
      memberCount: countRes.count ?? 0,
      members,
      viewerRole: viewerRes.data?.role ?? null,
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

    const { data: club, error } = await supabase
      .from('clubs')
      .select('id, owner_profile_id')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error.code)) {
        return NextResponse.json({ error: 'Club not found' }, { status: 404 });
      }
      console.error('[CLUBS] PATCH fetch error:', error);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (!club) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    const canEdit =
      user.id === club.owner_profile_id ||
      membership?.role === 'owner' ||
      membership?.role === 'manager';
    if (!canEdit) {
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
