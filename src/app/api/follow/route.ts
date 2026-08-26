import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth, requireProfileRole } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';

export async function POST(request: NextRequest) {
  try {
    // The follower is ALWAYS the session user — never trust a body-supplied
    // followerId (that let anyone forge follows/unfollows as any user).
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'follow', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const { followingId, message, action, fanId } = body;
    const followerId = user.id;

    // Remove a fan. Default: the session user is the followed side, deleting
    // someone else's follow of them. Round G: a guardian may pass
    // targetProfileId to remove a follower from their MANAGED athlete's list
    // — server-authoritative via the role matrix (owner passes too, so the
    // self case is the same gate).
    if (action === 'remove_fan') {
      if (!isUuid(fanId)) {
        return NextResponse.json({ error: 'Invalid fan ID' }, { status: 400 });
      }
      let removeFrom = user.id;
      const targetProfileId = body.targetProfileId;
      if (targetProfileId !== undefined && targetProfileId !== null && !isUuid(targetProfileId)) {
        return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
      }
      if (typeof targetProfileId === 'string' && targetProfileId && targetProfileId !== user.id) {
        await requireProfileRole(request, targetProfileId, 'manage_privacy');
        removeFrom = targetProfileId;
      }
      const { error: removeError } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', fanId)
        .eq('following_id', removeFrom);

      if (removeError) {
        console.error('[FOLLOW API] Remove fan error:', removeError);
        return NextResponse.json({ error: 'Failed to remove fan' }, { status: 500 });
      }
      return NextResponse.json({ action: 'removed_fan', message: 'Fan removed successfully' });
    }

    if (!followingId) {
      return NextResponse.json({ error: 'Following ID is required' }, { status: 400 });
    }
    if (!isUuid(followingId)) {
      // A raw non-UUID would reach Postgres as a 22P02 and surface as a 500.
      return NextResponse.json({ error: 'Invalid following ID' }, { status: 400 });
    }

    if (followerId === followingId) {
      return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });
    }

    // Check if the user already follows this person
    const { data: existingFollow, error: checkError } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle(); // Use maybeSingle instead of single to avoid error when not found

    if (checkError) {
      console.error('[FOLLOW API] Check follow error:', checkError);
      return NextResponse.json({ error: 'Failed to check follow status' }, { status: 500 });
    }


    if (existingFollow) {
      // Unfollow: Remove the follow relationship
      const { error: deleteError } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('following_id', followingId);

      if (deleteError) {
        console.error('Unfollow error:', deleteError);
        return NextResponse.json({ error: 'Failed to unfollow user' }, { status: 500 });
      }

      return NextResponse.json({
        action: 'unfollowed',
        message: 'User unfollowed successfully'
      });
    } else {
      // Check the target exists (a bogus id used to surface as an FK-500)
      // and whether it's private
      const { data: targetProfile, error: profileError } = await supabase
        .from('profiles')
        .select('visibility, supervision_state')
        .eq('id', followingId)
        .maybeSingle();

      if (profileError) {
        console.error('[FOLLOW API] Profile fetch error:', profileError);
      }
      if (!targetProfile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }

      const isPrivate = targetProfile.visibility === 'private';

      // Follow: Create the follow relationship with pending status for private profiles
      const insertData = {
        follower_id: followerId,
        following_id: followingId,
        status: isPrivate ? 'pending' : 'accepted',
        message: typeof message === 'string' ? message.slice(0, 200) : null // server-side cap (client caps at 200)
      };


      const { data: insertedFollow, error: insertError } = await supabase
        .from('follows')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('[FOLLOW API] Insert error:', insertError);
        console.error('[FOLLOW API] Insert error details:', JSON.stringify(insertError, null, 2));
        return NextResponse.json({ error: 'Failed to follow user' }, { status: 500 });
      }

      if (!insertedFollow) {
        console.error('[FOLLOW API] Insert succeeded but no data returned');
        // Still return success since the insert worked
      }

      // Round G: a pending request at a SUPERVISED profile also bells the
      // guardians ("either can approve"). The DB trigger already notifies
      // the child; this is the guardian half. Best-effort, never fails the
      // follow.
      if (isPrivate && targetProfile.supervision_state === 'supervised') {
        const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
        const [childName, followerName] = await Promise.all([
          profileFirstName(supabase, followingId),
          profileFirstName(supabase, followerId),
        ]);
        await notifyGuardians(supabase, followingId, {
          type: 'follow_request_guardian',
          title: `${followerName} wants to become ${childName}'s fan`,
          message: 'You or your athlete can approve or decline this request.',
          actionUrl: `/app/guardian/athlete/${followingId}`,
          actorId: followerId,
        });
      }

      return NextResponse.json({
        action: 'followed',
        message: isPrivate ? 'Follow request sent' : 'User followed successfully',
        isPending: isPrivate
      });
    }

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Follow API error:', error);
    return NextResponse.json({ error: 'Failed to process follow request' }, { status: 500 });
  }
}