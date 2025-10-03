import { NextRequest, NextResponse } from 'next/server';
import { canViewProfile } from '@/lib/privacy';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Get current user from session
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
