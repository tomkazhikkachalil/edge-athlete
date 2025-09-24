import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { followerId, followingId } = body;
    
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
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected if not following yet
      console.error('Check follow error:', checkError);
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
      // Follow: Create the follow relationship
      const { error: insertError } = await supabase
        .from('follows')
        .insert({
          follower_id: followerId,
          following_id: followingId
        });
      
      if (insertError) {
        console.error('Follow error:', insertError);
        return NextResponse.json({ error: 'Failed to follow user' }, { status: 500 });
      }
      
      return NextResponse.json({ 
        action: 'followed',
        message: 'User followed successfully' 
      });
    }
    
  } catch (error) {
    console.error('Follow API error:', error);
    return NextResponse.json({ error: 'Failed to process follow request' }, { status: 500 });
  }
}