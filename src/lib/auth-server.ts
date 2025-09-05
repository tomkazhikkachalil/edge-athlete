import { NextRequest } from 'next/server';
import { supabase } from './supabase';

export async function requireAuth(request: NextRequest) {
  try {
    // Get the session token from cookies
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) {
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse cookies to get supabase session
    const cookies = Object.fromEntries(
      cookieHeader.split('; ').map(cookie => {
        const [key, value] = cookie.split('=');
        return [key, decodeURIComponent(value)];
      })
    );

    const accessToken = cookies['sb-access-token'];

    if (!accessToken) {
      throw new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the session with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      throw new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return user;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireAuth(request);
  
  // Check if user has admin role
  const { data: profile } = await supabase
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