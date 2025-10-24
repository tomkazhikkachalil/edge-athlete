import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: postId } = await params;

    const { data: post, error } = await supabase
      .from('posts')
      .select(`
        *,
        profile:profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        media:post_media (
          id,
          media_url,
          media_type,
          thumbnail_url,
          display_order
        ),
        likes:post_likes (
          profile_id
        ),
        saved_posts (
          profile_id
        ),
        golf_round:round_id (
          id,
          date,
          course,
          course_location,
          tee,
          holes,
          par,
          gross_score,
          total_putts,
          fir_percentage,
          gir_percentage,
          weather,
          temperature,
          wind,
          course_rating,
          slope_rating,
          golf_holes (
            hole_number,
            par,
            strokes,
            putts,
            distance_yards,
            fairway_hit,
            green_in_regulation
          )
        )
      `)
      .eq('id', postId)
      .single();

    if (error || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json({ post });
  } catch (error) {
    console.error('Error fetching post:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
