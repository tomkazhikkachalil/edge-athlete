import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  console.log('[FOLLOWERS API] GET request received');

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log('[FOLLOWERS API] Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message
    });

    if (!user) {
      console.log('[FOLLOWERS API] No user found - returning 401');
      return NextResponse.json({ error: 'Unauthorized', message: 'Please log in' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'followers'; // 'followers', 'following', 'requests'
    const profileId = searchParams.get('profileId') || user.id;

    console.log('[FOLLOWERS API] Request params:', { type, profileId });

    if (type === 'followers') {
      // Get list of followers
      const { data: followers, error } = await supabase
        .from('follows')
        .select(`
          id,
          created_at,
          follower:follower_id (
            id,
            full_name,
            first_name,
            last_name,
            avatar_url,
            sport,
            school
          )
        `)
        .eq('following_id', profileId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[FOLLOWERS API] Error fetching followers:', error);
        return NextResponse.json({
          error: error.message || 'Database error',
          details: error.details || 'Failed to fetch followers',
          code: error.code,
          hint: error.hint || 'Check database setup'
        }, { status: 500 });
      }

      console.log('[FOLLOWERS API] Returning followers:', followers?.length || 0);
      return NextResponse.json({ followers: followers || [] });
    }

    if (type === 'following') {
      // Get list of people this user follows
      const { data: following, error } = await supabase
        .from('follows')
        .select(`
          id,
          created_at,
          following:following_id (
            id,
            full_name,
            first_name,
            last_name,
            avatar_url,
            sport,
            school
          )
        `)
        .eq('follower_id', profileId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ following: following || [] });
    }

    if (type === 'requests') {
      // Get pending follow requests (only for own profile)
      if (profileId !== user.id) {
        return NextResponse.json({ error: 'Cannot view other users requests' }, { status: 403 });
      }

      const { data: requests, error } = await supabase
        .from('follows')
        .select(`
          id,
          message,
          created_at,
          follower:follower_id (
            id,
            full_name,
            first_name,
            last_name,
            avatar_url,
            sport,
            school
          )
        `)
        .eq('following_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ requests: requests || [] });
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });

  } catch (error) {
    console.error('[FOLLOWERS API] Catch error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch followers',
      details: 'Database setup required. See QUICK_FIX_GUIDE.md for step-by-step instructions',
      setup: 'Run the SQL commands in QUICK_FIX_GUIDE.md via Supabase SQL Editor'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, followId } = body;

    if (action === 'accept') {
      // Accept a follow request
      const { error } = await supabase
        .from('follows')
        .update({ status: 'accepted' })
        .eq('id', followId)
        .eq('following_id', user.id) // Ensure user owns this request
        .eq('status', 'pending');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Follow request accepted' });
    }

    if (action === 'reject') {
      // Reject a follow request (delete it)
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('id', followId)
        .eq('following_id', user.id) // Ensure user owns this request
        .eq('status', 'pending');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Follow request rejected' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Follow action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process follow action' },
      { status: 500 }
    );
  }
}
