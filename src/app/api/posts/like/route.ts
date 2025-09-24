import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, profileId } = body;
    
    if (!postId || !profileId) {
      return NextResponse.json({ error: 'Post ID and Profile ID are required' }, { status: 400 });
    }
    
    // Check if the user already liked this post
    const { data: existingLike, error: checkError } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('profile_id', profileId)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected if not liked yet
      return NextResponse.json({ error: 'Failed to check like status' }, { status: 500 });
    }
    
    if (existingLike) {
      // Unlike: Remove the like
      const { error: deleteError } = await supabase
        .from('post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('profile_id', profileId);
      
      if (deleteError) {
        return NextResponse.json({ error: 'Failed to unlike post' }, { status: 500 });
      }
      
      return NextResponse.json({ 
        action: 'unliked',
        message: 'Post unliked successfully' 
      });
    } else {
      // Like: Add the like
      const { error: insertError } = await supabase
        .from('post_likes')
        .insert({
          post_id: postId,
          profile_id: profileId
        });
      
      if (insertError) {
        return NextResponse.json({ error: 'Failed to like post' }, { status: 500 });
      }
      
      return NextResponse.json({ 
        action: 'liked',
        message: 'Post liked successfully' 
      });
    }
    
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}