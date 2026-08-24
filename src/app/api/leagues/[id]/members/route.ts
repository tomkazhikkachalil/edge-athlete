import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isMissingTableError } from '@/lib/leagues/validate';
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

    const { data: existing, error: checkError } = await supabase
      .from('league_members')
      .select('role')
      .eq('league_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (checkError) {
      console.error('[LEAGUE MEMBERS] membership check error:', checkError);
      return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
    }

    if (existing) {
      if (existing.role === 'owner') {
        return NextResponse.json({ error: "Owners can't leave their league" }, { status: 400 });
      }
      const { error: deleteError } = await supabase
        .from('league_members')
        .delete()
        .eq('league_id', id)
        .eq('profile_id', user.id);
      if (deleteError) {
        console.error('[LEAGUE MEMBERS] leave error:', deleteError);
        return NextResponse.json({ error: 'Failed to leave league' }, { status: 500 });
      }
      return NextResponse.json({ action: 'left' });
    }

    const { error: insertError } = await supabase
      .from('league_members')
      .insert({ league_id: id, profile_id: user.id });
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
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, owner_profile_id')
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

    const { data: callerRow } = await supabase
      .from('league_members')
      .select('role')
      .eq('league_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    const canManage =
      user.id === league.owner_profile_id ||
      callerRow?.role === 'owner' ||
      callerRow?.role === 'manager';
    if (!canManage) {
      return NextResponse.json({ error: 'Not authorized to manage members' }, { status: 403 });
    }

    const { data: target } = await supabase
      .from('league_members')
      .select('role')
      .eq('league_id', id)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (target.role !== 'member') {
      return NextResponse.json({ error: 'Only member rows can be removed' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('league_members')
      .delete()
      .eq('league_id', id)
      .eq('profile_id', profileId);
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
