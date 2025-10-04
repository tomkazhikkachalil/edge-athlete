import { NextRequest, NextResponse } from 'next/server';
import { canViewProfile } from '@/lib/privacy';
import { createServerClient } from '@supabase/ssr';

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
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Get current user from session
    const supabase = createSupabaseClient(request);

    const { data: { user } } = await supabase.auth.getUser();
    const currentUserId = user?.id || null;

    // Check privacy access using server-side function
    const privacyCheck = await canViewProfile(profileId, currentUserId);

    return NextResponse.json(privacyCheck);

  } catch (error) {
    console.error('Privacy check error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Privacy check failed',
      canView: false,
      limitedAccess: true
    }, { status: 500 });
  }
}
