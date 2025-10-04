import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET() {
  console.log('========================================');
  console.log('[TEST FOLLOWERS API] Starting test...');

  try {
    // Test 1: Environment variables
    console.log('[TEST] Step 1: Checking environment variables');
    console.log('[TEST] SUPABASE_URL exists:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('[TEST] SUPABASE_ANON_KEY exists:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    // Test 2: Create Supabase client
    console.log('[TEST] Step 2: Creating Supabase client');
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
    console.log('[TEST] Supabase client created successfully');

    // Test 3: Check authentication
    console.log('[TEST] Step 3: Checking authentication');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('[TEST] Auth result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      authError: authError?.message
    });

    if (!user) {
      return NextResponse.json({
        success: false,
        step: 'authentication',
        message: 'No user found - you are not logged in',
        authError: authError?.message
      });
    }

    // Test 4: Check follows table exists
    console.log('[TEST] Step 4: Checking follows table');
    const { error: followsError } = await supabase
      .from('follows')
      .select('id')
      .limit(1);

    console.log('[TEST] Follows table check:', {
      success: !followsError,
      error: followsError?.message,
      errorCode: followsError?.code,
      errorDetails: followsError?.details
    });

    if (followsError) {
      return NextResponse.json({
        success: false,
        step: 'follows_table',
        message: 'Follows table query failed',
        error: followsError.message,
        code: followsError.code,
        details: followsError.details,
        hint: followsError.hint
      });
    }

    // Test 5: Check follows table has status column
    console.log('[TEST] Step 5: Testing status column query');
    const { error: statusError } = await supabase
      .from('follows')
      .select('id, status')
      .limit(1);

    console.log('[TEST] Status column check:', {
      success: !statusError,
      error: statusError?.message
    });

    if (statusError) {
      return NextResponse.json({
        success: false,
        step: 'status_column',
        message: 'Status column missing - run implement-notifications-followers-only.sql',
        error: statusError.message,
        fix: 'Run the SQL migration in implement-notifications-followers-only.sql'
      });
    }

    // Test 6: Try the actual followers query
    console.log('[TEST] Step 6: Testing actual followers query');
    const { data: followers, error: followersError } = await supabase
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
      .eq('following_id', user.id)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false });

    console.log('[TEST] Followers query result:', {
      success: !followersError,
      count: followers?.length || 0,
      error: followersError?.message
    });

    if (followersError) {
      return NextResponse.json({
        success: false,
        step: 'followers_query',
        message: 'Followers query failed',
        error: followersError.message,
        code: followersError.code,
        details: followersError.details
      });
    }

    // All tests passed!
    console.log('[TEST] ✅ All tests passed!');
    return NextResponse.json({
      success: true,
      message: 'All tests passed! API is working correctly.',
      user: {
        id: user.id,
        email: user.email
      },
      followersCount: followers?.length || 0
    });

  } catch (error) {
    console.error('[TEST] Caught exception:', error);
    return NextResponse.json({
      success: false,
      step: 'exception',
      message: 'Exception thrown',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
