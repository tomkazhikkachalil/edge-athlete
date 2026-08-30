import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ClubMemberRoleSchema, isMissingTableError } from '@/lib/clubs/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { joinOrg, leaveOrg, removeMember, setMemberRole } from '@/lib/orgs/members';
import { parseBody } from '@/lib/validation';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/members — open join/leave + roles + removal ─────────────
// Mirror of /api/leagues/[id]/members: actor is ALWAYS the session user,
// join is a toggle, role changes are OWNER-only, only 'member' rows are
// removable.

/** POST — toggle the session user's membership. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'club-join', { userId: user.id });
    if (limited) return limited;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, name, owner_profile_id')
      .eq('id', id)
      .maybeSingle();
    if (clubError) {
      if (isMissingTableError(clubError.code)) {
        return NextResponse.json({ error: 'Club not found' }, { status: 404 });
      }
      console.error('[CLUB MEMBERS] club fetch error:', clubError);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (!club) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }

    const { data: existing, error: checkError } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (checkError) {
      console.error('[CLUB MEMBERS] membership check error:', checkError);
      return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
    }

    if (existing) {
      if (existing.role === 'owner') {
        return NextResponse.json({ error: "Owners can't leave their club" }, { status: 400 });
      }
      const { error: deleteError } = await leaveOrg(supabase, { side: 'club', orgId: id }, user.id);
      if (deleteError) {
        console.error('[CLUB MEMBERS] leave error:', deleteError);
        return NextResponse.json({ error: 'Failed to leave club' }, { status: 500 });
      }
      return NextResponse.json({ action: 'left' });
    }

    const { error: insertError } = await joinOrg(supabase, { side: 'club', orgId: id }, user.id);
    if (insertError) {
      console.error('[CLUB MEMBERS] join error:', insertError);
      return NextResponse.json({ error: 'Failed to join club' }, { status: 500 });
    }

    const { notifyClubJoin } = await import('@/lib/clubs/notify');
    await notifyClubJoin(supabase, {
      ownerProfileId: club.owner_profile_id,
      actorId: user.id,
      clubId: club.id,
      clubName: club.name,
    });

    return NextResponse.json({ action: 'joined' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB MEMBERS] POST error:', error);
    return NextResponse.json({ error: 'Failed to process membership' }, { status: 500 });
  }
}

/** PATCH ?profileId= {role} — the OWNER promotes/demotes. Owner row is
 *  untouchable; 'owner' is not in the schema (leagues precedent). */
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
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndRole(supabase, 'club', id, user.id);
    if (loaded.status === 'error') {
      console.error('[CLUB MEMBERS] club fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const club = loaded.org;
    if (!roleAllows(loaded.role, 'change_roles')) {
      return NextResponse.json({ error: 'Only the owner can change roles' }, { status: 403 });
    }

    const parsed = await parseBody(request, ClubMemberRoleSchema);
    if (!parsed.success) return parsed.response;
    const { role } = parsed.data;

    const { data: target } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', id)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (target.role === 'owner') {
      return NextResponse.json({ error: "The owner's role can't be changed" }, { status: 400 });
    }
    if (target.role === role) {
      return NextResponse.json({ action: 'unchanged', role });
    }

    const { error: updateError } = await setMemberRole(supabase, { side: 'club', orgId: id }, profileId, role);
    if (updateError) {
      console.error('[CLUB MEMBERS] role update error:', updateError);
      return NextResponse.json({ error: 'Failed to change role' }, { status: 500 });
    }

    const { notifyClubRole } = await import('@/lib/clubs/notify');
    await notifyClubRole(supabase, {
      profileId,
      clubId: club.id,
      clubName: club.name,
      role,
    });

    return NextResponse.json({ action: 'role_changed', role });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB MEMBERS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?profileId= — owner/manager removes a plain member. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndRole(supabase, 'club', id, user.id);
    if (loaded.status === 'error') {
      console.error('[CLUB MEMBERS] club fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load club' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    if (!roleAllows(loaded.role, 'manage_members')) {
      return NextResponse.json({ error: 'Not authorized to manage members' }, { status: 403 });
    }

    const { data: target } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', id)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (target.role !== 'member') {
      return NextResponse.json({ error: 'Only member rows can be removed' }, { status: 400 });
    }

    const { error: deleteError } = await removeMember(supabase, { side: 'club', orgId: id }, profileId);
    if (deleteError) {
      console.error('[CLUB MEMBERS] remove error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ action: 'removed' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB MEMBERS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
