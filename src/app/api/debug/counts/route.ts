import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    // Get all posts with their stored counts
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, caption, likes_count, comments_count')
      .order('created_at', { ascending: false })
      .limit(10);

    if (postsError) {
      return NextResponse.json({ error: postsError.message }, { status: 500 });
    }

    // For each post, count actual likes and comments
    const verification = await Promise.all(
      (posts || []).map(async (post) => {
        // Count actual likes
        const { count: actualLikes } = await supabase
          .from('post_likes')
          .select('*', { count: 'exact', head: true })
          .eq('post_id', post.id);

        // Count actual comments
        const { count: actualComments } = await supabase
          .from('post_comments')
          .select('*', { count: 'exact', head: true })
          .eq('post_id', post.id);

        return {
          post_id: post.id,
          caption: post.caption?.substring(0, 50) || 'No caption',
          stored_likes: post.likes_count,
          actual_likes: actualLikes || 0,
          likes_match: post.likes_count === (actualLikes || 0),
          stored_comments: post.comments_count,
          actual_comments: actualComments || 0,
          comments_match: post.comments_count === (actualComments || 0),
        };
      })
    );

    return NextResponse.json({
      message: 'Count verification',
      posts: verification,
      summary: {
        total_posts_checked: verification.length,
        likes_mismatches: verification.filter(v => !v.likes_match).length,
        comments_mismatches: verification.filter(v => !v.comments_match).length,
      }
    });

  } catch (error) {
    console.error('Debug counts error:', error);
    return NextResponse.json({ error: 'Failed to verify counts' }, { status: 500 });
  }
}
