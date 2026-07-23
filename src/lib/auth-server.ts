import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase admin client (service role) on demand.
 * MUST be called inside request handlers, never at module scope,
 * to avoid build failures when env vars aren't available during static analysis.
 */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return user;
  } catch (err) {
    if (err instanceof Response) {
      throw err;
    }
    throw new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireAuth(request);

  // Admin = email on the ADMIN_EMAILS allowlist (comma-separated env var,
  // server-only). The old implementation checked a profiles.role column
  // that does not exist — it 403'd for everyone. An env allowlist is the
  // right size for the MVP; a real roles system can replace it later.
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
    throw new Response(
      JSON.stringify({ error: 'Admin access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return user;
}