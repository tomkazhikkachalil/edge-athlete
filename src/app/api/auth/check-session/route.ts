import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, error } = await getServerAuth(request);

    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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
