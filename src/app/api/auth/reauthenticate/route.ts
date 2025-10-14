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

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // Check if user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get email and password from request body
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Verify the email matches the current user
    if (email !== user.email) {
      return NextResponse.json({ error: 'Email does not match current user' }, { status: 400 });
    }

    // Attempt to sign in with the provided credentials
    // This verifies the password without creating a new session
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error('Re-authentication failed:', signInError);
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Password verified successfully
    return NextResponse.json({
      success: true,
      message: 'Re-authentication successful'
    });

  } catch (error) {
    console.error('Re-authentication error:', error);
    return NextResponse.json({
      error: 'Failed to re-authenticate'
    }, { status: 500 });
  }
}
