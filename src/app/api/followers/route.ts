import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { notifyGuardians, notifyUser, profileFirstName } from '@/lib/guardian-notify';

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
    // Bounded pages (were unbounded — a large account would ship its entire
    // follower list in one response). Defaults generous for MVP scale.
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Privacy gate: another user's followers/following lists are only
    // visible if their profile is visible to the viewer. Without this, any
    // authenticated user could enumerate a private profile's social graph.
    if (profileId !== user.id && (type === 'followers' || type === 'following')) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (!canView) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }


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
            school,
            visibility
          )
        `)
        .eq('following_id', profileId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

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

      // includeStatus=true (self only) also returns PENDING outgoing requests
      // with a status field, so clients can render "Requested" instead of
      // conflating pending with not-following.
      const includeStatus = searchParams.get('includeStatus') === 'true' && profileId === user.id;

      let followingQuery = supabaseAdmin
        .from('follows')
        .select(`
          id,
          status,
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
            school,
            visibility
          )
        `)
        .eq('follower_id', profileId);

      followingQuery = includeStatus
        ? followingQuery.in('status', ['accepted', 'pending'])
        : followingQuery.eq('status', 'accepted');

      const { data: following, error } = await followingQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ following: following || [] });
    }

    if (type === 'requests') {
      // Own requests, or a managed athlete's (Round G): the role matrix
      // gates the non-self path — a guardian holds manage_privacy on their
      // supervised athlete, everyone else 403s. The child's own view is
      // untouched ("either can approve" keeps the child in control too).
      if (profileId !== user.id) {
        await requireProfileRole(request, profileId, 'manage_privacy');
      }

      const supabaseAdmin = getSupabaseAdmin();

      // First get the follow requests
      const { data: followRequests, error: followError } = await supabaseAdmin
        .from('follows')
        .select('id, message, created_at, follower_id')
        .eq('following_id', profileId)
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
    if (error instanceof Response) return error;
    console.error('[FOLLOWERS API] Catch error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch followers',
      details: 'Database setup required. See CLAUDE.md for instructions',
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

    // Round G ("either can approve"): a guardian may act on their managed
    // athlete's requests by passing profileId. The role matrix gates it
    // (owner passes for self, guardian for the child, everyone else 403s);
    // every query below stays anchored to the RESOLVED profile so a caller
    // can never act on a request that isn't theirs to decide.
    let actingFor = user.id;
    if (typeof body.profileId === 'string' && body.profileId && body.profileId !== user.id) {
      await requireProfileRole(request, body.profileId, 'manage_privacy');
      actingFor = body.profileId;
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (action === 'accept') {
      // Accept a follow request — return the row so the cross-notify below
      // knows who the requester was.
      const { data: acceptedRows, error } = await supabaseAdmin
        .from('follows')
        .update({ status: 'accepted' })
        .eq('id', followId)
        .eq('following_id', actingFor)
        .eq('status', 'pending')
        .select('follower_id');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Cross-notify the party who didn't act (the DB trigger already tells
      // the REQUESTER their request was accepted). Best-effort.
      const followerId = acceptedRows?.[0]?.follower_id;
      if (followerId) {
        const { data: target } = await supabaseAdmin
          .from('profiles')
          .select('supervision_state')
          .eq('id', actingFor)
          .maybeSingle();
        if (target?.supervision_state === 'supervised') {
          const [childName, followerName] = await Promise.all([
            profileFirstName(supabaseAdmin, actingFor),
            profileFirstName(supabaseAdmin, followerId),
          ]);
          if (actingFor === user.id) {
            // The child accepted → tell the guardians.
            await notifyGuardians(supabaseAdmin, actingFor, {
              type: 'follow_update',
              title: `${childName} accepted a fan request from ${followerName}`,
              actionUrl: `/app/guardian/athlete/${actingFor}`,
              actorId: followerId,
            }, user.id);
          } else {
            // A guardian accepted → tell the child.
            await notifyUser(supabaseAdmin, actingFor, {
              type: 'follow_update',
              title: `Your guardian approved ${followerName}'s fan request`,
              actionUrl: `/app/followers`,
              actorId: followerId,
            });
          }
        }
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
        .eq('following_id', actingFor)
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
    if (error instanceof Response) return error;
    console.error('Follow action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process follow action' },
      { status: 500 }
    );
  }
}
