import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Get all follows for this user
    const { data: allFollows, error: allError } = await supabase
      .from('follows')
      .select('*')
      .or(`follower_id.eq.${userId},following_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (allError) {
      return NextResponse.json({ error: allError.message }, { status: 500 });
    }

    // Get pending requests where user is being followed
    const { data: pendingRequests, error: pendingError } = await supabase
      .from('follows')
      .select('*')
      .eq('following_id', userId)
      .eq('status', 'pending');

    if (pendingError) {
      return NextResponse.json({ error: pendingError.message }, { status: 500 });
    }

    return NextResponse.json({
      userId,
      allFollows: allFollows || [],
      pendingRequests: pendingRequests || [],
      counts: {
        total: allFollows?.length || 0,
        pending: pendingRequests?.length || 0,
        asFollower: allFollows?.filter(f => f.follower_id === userId).length || 0,
        asFollowing: allFollows?.filter(f => f.following_id === userId).length || 0
      }
    });

  } catch (error) {
    console.error('Debug follow requests error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch debug data'
    }, { status: 500 });
  }
}
