import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    // The follower is ALWAYS the session user — never trust a body-supplied
    // followerId (that let anyone forge follows/unfollows as any user).
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const { followingId, message, action, fanId } = body;
    const followerId = user.id;

    // Remove one of YOUR OWN fans: the session user is the followed side,
    // deleting someone else's follow of them. Session-anchored — a caller can
    // only ever remove followers from their own list.
    if (action === 'remove_fan') {
      if (!fanId || typeof fanId !== 'string') {
        return NextResponse.json({ error: 'fanId is required' }, { status: 400 });
      }
      const { error: removeError } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', fanId)
        .eq('following_id', user.id);

      if (removeError) {
        console.error('[FOLLOW API] Remove fan error:', removeError);
        return NextResponse.json({ error: 'Failed to remove fan' }, { status: 500 });
      }
      return NextResponse.json({ action: 'removed_fan', message: 'Fan removed successfully' });
    }

    if (!followingId) {
      return NextResponse.json({ error: 'Following ID is required' }, { status: 400 });
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
      return NextResponse.json({
        error: 'Failed to check follow status',
        details: checkError.message
      }, { status: 500 });
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
      // Check if target profile is private
      const { data: targetProfile, error: profileError } = await supabase
        .from('profiles')
        .select('visibility')
        .eq('id', followingId)
        .single();

      if (profileError) {
        console.error('[FOLLOW API] Profile fetch error:', profileError);
      }

      const isPrivate = targetProfile?.visibility === 'private';

      // Follow: Create the follow relationship with pending status for private profiles
      const insertData = {
        follower_id: followerId,
        following_id: followingId,
        status: isPrivate ? 'pending' : 'accepted',
        message: message || null
      };


      const { data: insertedFollow, error: insertError } = await supabase
        .from('follows')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('[FOLLOW API] Insert error:', insertError);
        console.error('[FOLLOW API] Insert error details:', JSON.stringify(insertError, null, 2));
        return NextResponse.json({
          error: 'Failed to follow user',
          details: insertError.message,
          code: insertError.code,
          hint: insertError.hint
        }, { status: 500 });
      }

      if (!insertedFollow) {
        console.error('[FOLLOW API] Insert succeeded but no data returned');
        // Still return success since the insert worked
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