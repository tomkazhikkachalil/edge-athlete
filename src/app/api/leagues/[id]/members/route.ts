import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { LeagueMemberRoleSchema, isMissingTableError } from '@/lib/leagues/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { getMemberRole, insertOwnerRow, joinOrg, leaveOrg, removeMember, setMemberRole } from '@/lib/orgs/members';
import { parseBody } from '@/lib/validation';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/members — open join/leave + manager removal ────────────
// The follow-route template: the actor is ALWAYS the session user (never a
// body-supplied id), the route is a toggle, and the target's existence is
// checked before any insert (a bogus id must 404, not FK-500).

/** POST — toggle the session user's membership. Joined → left; not a member
 *  → joined (role 'member'). Owners can't leave their own league. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'league-join', { userId: user.id });
    if (limited) return limited;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, name, owner_profile_id')
      .eq('id', id)
      .maybeSingle();
    if (leagueError) {
      if (isMissingTableError(leagueError.code)) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 });
      }
      console.error('[LEAGUE MEMBERS] league fetch error:', leagueError);
      return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
    }
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const { role: existingRole, error: checkError } = await getMemberRole(
      supabase,
      { side: 'league', orgId: id },
      user.id
    );
    if (checkError) {
      console.error('[LEAGUE MEMBERS] membership check error:', checkError);
      return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
    }

    if (existingRole) {
      if (existingRole === 'owner') {
        return NextResponse.json({ error: "Owners can't leave their league" }, { status: 400 });
      }
      const { error: deleteError } = await leaveOrg(supabase, { side: 'league', orgId: id }, user.id);
      if (deleteError) {
        console.error('[LEAGUE MEMBERS] leave error:', deleteError);
        return NextResponse.json({ error: 'Failed to leave league' }, { status: 500 });
      }
      return NextResponse.json({ action: 'left' });
    }

    // DEVLOG 0.1 quirk closed (Sep 2026): a column-only owner joining
    // their own league gets an OWNER row, not a member row — the column
    // and the membership table must never disagree about who owns.
    const { error: insertError } =
      league.owner_profile_id === user.id
        ? await insertOwnerRow(supabase, { side: 'league', orgId: id }, user.id)
        : await joinOrg(supabase, { side: 'league', orgId: id }, user.id);
    if (insertError) {
      console.error('[LEAGUE MEMBERS] join error:', insertError);
      return NextResponse.json({ error: 'Failed to join league' }, { status: 500 });
    }

    // Best-effort owner notification — never fails the join.
    const { notifyLeagueJoin } = await import('@/lib/leagues/notify');
    await notifyLeagueJoin(supabase, {
      ownerProfileId: league.owner_profile_id,
      actorId: user.id,
      leagueId: league.id,
      leagueName: league.name,
    });

    return NextResponse.json({ action: 'joined' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE MEMBERS] POST error:', error);
    return NextResponse.json({ error: 'Failed to process membership' }, { status: 500 });
  }
}

/** PATCH ?profileId= {role} — the OWNER promotes a member to manager or
 *  demotes a manager back. Owner-only on purpose: managers must not mint or
 *  remove peers (the org-managed model). Owner rows stay untouchable HERE —
 *  owner-set changes live in /owners (0.8): transfer = promote + step down. */
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
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndRole(supabase, 'league', id, user.id);
    if (loaded.status === 'error') {
      console.error('[LEAGUE MEMBERS] league fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const league = loaded.org;
    if (!roleAllows(loaded.role, 'change_roles')) {
      return NextResponse.json({ error: 'Only the owner can change roles' }, { status: 403 });
    }

    const parsed = await parseBody(request, LeagueMemberRoleSchema);
    if (!parsed.success) return parsed.response;
    const { role } = parsed.data;

    const { role: targetRole } = await getMemberRole(supabase, { side: 'league', orgId: id }, profileId);
    if (!targetRole) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (targetRole === 'owner') {
      return NextResponse.json({ error: "The owner's role can't be changed" }, { status: 400 });
    }
    if (targetRole === role) {
      return NextResponse.json({ action: 'unchanged', role });
    }

    const { error: updateError } = await setMemberRole(supabase, { side: 'league', orgId: id }, profileId, role);
    if (updateError) {
      console.error('[LEAGUE MEMBERS] role update error:', updateError);
      return NextResponse.json({ error: 'Failed to change role' }, { status: 500 });
    }

    // Best-effort — never fails the role change.
    const { notifyLeagueRole } = await import('@/lib/leagues/notify');
    await notifyLeagueRole(supabase, {
      profileId,
      leagueId: league.id,
      leagueName: league.name,
      role,
    });

    return NextResponse.json({ action: 'role_changed', role });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE MEMBERS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?profileId= — owner/manager removes a member. Only plain 'member'
 *  rows are removable in v1 (owner/manager rows are not). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndRole(supabase, 'league', id, user.id);
    if (loaded.status === 'error') {
      console.error('[LEAGUE MEMBERS] league fetch error:', loaded.error);
      return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    if (!roleAllows(loaded.role, 'manage_members')) {
      return NextResponse.json({ error: 'Not authorized to manage members' }, { status: 403 });
    }

    const { role: targetRole } = await getMemberRole(supabase, { side: 'league', orgId: id }, profileId);
    if (!targetRole) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (targetRole !== 'member') {
      return NextResponse.json({ error: 'Only member rows can be removed' }, { status: 400 });
    }

    const { error: deleteError } = await removeMember(supabase, { side: 'league', orgId: id }, profileId);
    if (deleteError) {
      console.error('[LEAGUE MEMBERS] remove error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ action: 'removed' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE MEMBERS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
