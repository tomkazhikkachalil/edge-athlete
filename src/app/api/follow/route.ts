import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { followerId, followingId, message } = body;

    console.log('[FOLLOW API] Request:', { followerId, followingId, hasMessage: !!message });

    if (!followerId || !followingId) {
      return NextResponse.json({ error: 'Follower ID and Following ID are required' }, { status: 400 });
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

    console.log('[FOLLOW API] Existing follow:', existingFollow ? 'found' : 'not found');

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
      console.log('[FOLLOW API] Target profile visibility:', { isPrivate, visibility: targetProfile?.visibility });

      // Follow: Create the follow relationship with pending status for private profiles
      const insertData = {
        follower_id: followerId,
        following_id: followingId,
        status: isPrivate ? 'pending' : 'accepted',
        message: message || null
      };

      console.log('[FOLLOW API] Inserting follow:', insertData);

      const { error: insertError, data: insertedFollow } = await supabase
        .from('follows')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('[FOLLOW API] Insert error:', insertError);
        return NextResponse.json({
          error: 'Failed to follow user',
          details: insertError.message,
          code: insertError.code
        }, { status: 500 });
      }

      console.log('[FOLLOW API] Follow created successfully:', insertedFollow);

      return NextResponse.json({
        action: 'followed',
        message: isPrivate ? 'Follow request sent' : 'User followed successfully',
        isPending: isPrivate
      });
    }

  } catch (error) {
    console.error('Follow API error:', error);
    return NextResponse.json({ error: 'Failed to process follow request' }, { status: 500 });
  }
}