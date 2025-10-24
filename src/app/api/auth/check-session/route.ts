import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication (Next.js 15 pattern)
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the session to check its age
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ needsReauth: true });
    }

    // Check if session is older than 10 minutes (600 seconds)
    const sessionAge = Date.now() / 1000 - (session.user.last_sign_in_at ? new Date(session.user.last_sign_in_at).getTime() / 1000 : 0);
    const needsReauth = sessionAge > 600; // 10 minutes

    return NextResponse.json({
      needsReauth,
      sessionAge: Math.floor(sessionAge)
    });

  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({
      error: 'Failed to check session',
      needsReauth: true // Default to requiring re-auth on error for safety
    }, { status: 500 });
  }
}
