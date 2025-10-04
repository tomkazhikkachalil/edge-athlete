import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET() {
  console.log('[SIMPLE FOLLOWERS API] Request received');

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
      return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    }

    console.log('[SIMPLE FOLLOWERS API] User:', user.id);

    // Try the simplest possible query first - just get all follows
    const { data: allFollows, error: allError } = await supabase
      .from('follows')
      .select('*')
      .limit(10);

    if (allError) {
      console.error('[SIMPLE FOLLOWERS API] Error getting all follows:', allError);
      return NextResponse.json({
        error: 'Database query failed',
        details: allError.message,
        code: allError.code,
        suggestion: 'The follows table might not exist or you need to run the SQL migration'
      }, { status: 500 });
    }

    console.log('[SIMPLE FOLLOWERS API] Total follows in table:', allFollows?.length);

    // Now try with status filter
    const { data: acceptedFollows, error: statusError } = await supabase
      .from('follows')
      .select('*')
      .eq('status', 'accepted')
      .limit(10);

    if (statusError) {
      console.error('[SIMPLE FOLLOWERS API] Error with status column:', statusError);
      return NextResponse.json({
        error: 'Status column not found',
        details: statusError.message,
        suggestion: 'Run implement-notifications-followers-only.sql to add status column',
        sqlFile: 'implement-notifications-followers-only.sql'
      }, { status: 500 });
    }

    console.log('[SIMPLE FOLLOWERS API] Accepted follows:', acceptedFollows?.length);

    // Success!
    return NextResponse.json({
      success: true,
      totalFollows: allFollows?.length || 0,
      acceptedFollows: acceptedFollows?.length || 0,
      message: 'API is working! You can now use the followers page.',
      data: {
        followers: acceptedFollows || []
      }
    });

  } catch (error) {
    console.error('[SIMPLE FOLLOWERS API] Exception:', error);
    return NextResponse.json({
      error: 'Server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
