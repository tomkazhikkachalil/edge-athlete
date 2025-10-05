import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export async function requireAuth(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Create a Supabase server client that properly handles cookies
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
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
          set() {
            // Not used in API routes - cookies are set client-side
          },
          remove() {
            // Not used in API routes - cookies are removed client-side
          },
        },
      }
    );

    // Get the authenticated user
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      console.error('Auth failed:', error?.message || 'No user');
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);
    return user;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error('Auth error:', error);
    throw new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireAuth(request);

  // Create admin client to check role
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if user has admin role
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    throw new Response(
      JSON.stringify({ error: 'Admin access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return user;
}