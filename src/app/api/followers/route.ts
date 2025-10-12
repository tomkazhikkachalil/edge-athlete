import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

export async function GET(request: NextRequest) {

  try {
    // Use requireAuth helper for consistent authentication
    let user;
    try {
      user = await requireAuth(request);
    } catch (authError) {
      if (authError instanceof Response) {
        return authError;
      }
      return NextResponse.json({ error: 'Unauthorized', message: 'Please log in' }, { status: 401 });
    }


    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'followers'; // 'followers', 'following', 'requests'
    const profileId = searchParams.get('profileId') || user.id;


    if (type === 'followers') {
      // Get list of followers - use admin client to bypass RLS for profile data
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data: followers, error } = await supabaseAdmin
        .from('follows')
        .select(`
          id,
          created_at,
          follower:follower_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url,
            handle,
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

      return NextResponse.json({ followers: followers || [] });
    }

    if (type === 'following') {
      // Get list of people this user follows - use admin client to bypass RLS
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data: following, error } = await supabaseAdmin
        .from('follows')
        .select(`
          id,
          created_at,
          following:following_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url,
            handle,
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


      // Use service role client to bypass RLS and read follow requests + profiles
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

      // First get the follow requests
      const { data: followRequests, error: followError } = await supabaseAdmin
        .from('follows')
        .select('id, message, created_at, follower_id')
        .eq('following_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (followError) {
        console.error('[FOLLOWERS API] Error fetching follow requests:', followError);
        return NextResponse.json({ error: followError.message }, { status: 500 });
      }


      if (!followRequests || followRequests.length === 0) {
        return NextResponse.json({ requests: [] });
      }

      // Then get the follower profiles
      const followerIds = followRequests.map(r => r.follower_id);

      const { data: profiles, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
        .in('id', followerIds);

      if (profileError) {
        console.error('[FOLLOWERS API] Error fetching profiles:', profileError);
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      // Combine the data
      const requests = followRequests.map(req => {
        const follower = profiles?.find(p => p.id === req.follower_id);
        return {
          id: req.id,
          message: req.message,
          created_at: req.created_at,
          follower: follower || {
            id: req.follower_id,
            first_name: 'Unknown',
            middle_name: null,
            last_name: 'User',
            full_name: 'unknown_user',
            avatar_url: null
          }
        };
      });

      return NextResponse.json({ requests });
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
    // Use requireAuth helper for consistent authentication
    let user;
    try {
      user = await requireAuth(request);
    } catch (authError) {
      if (authError instanceof Response) {
        return authError;
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }


    const body = await request.json();
    const { action, followId } = body;

    // Use admin client for database operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (action === 'accept') {
      // Accept a follow request
      const { error } = await supabaseAdmin
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
      // Reject a follow request (completely delete it from the system)
      // This allows the same person to send a new follow request in the future

      const { data: deletedRows, error } = await supabaseAdmin
        .from('follows')
        .delete()
        .eq('id', followId)
        .eq('following_id', user.id) // Ensure user owns this request
        .eq('status', 'pending')
        .select(); // Return deleted rows for verification

      if (error) {
        console.error('[FOLLOWERS API] Error deleting follow request:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!deletedRows || deletedRows.length === 0) {
        console.warn('[FOLLOWERS API] No rows deleted - request may not exist or already processed');
        return NextResponse.json({
          error: 'Follow request not found or already processed'
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: 'Follow request rejected and removed. User can send a new request in the future.',
        deletedCount: deletedRows.length
      });
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
