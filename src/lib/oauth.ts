'use client';

import { supabase } from './supabase';

// OAuth sign-in is fire-and-navigate: the page unloads immediately and the
// session arrives later via auth.tsx's onAuthStateChange. No React state to
// hold, so this lives outside the auth context on purpose.

export type OAuthProvider = 'google' | 'apple';

// Apple stays hidden until the Apple Developer config exists in Supabase.
// Build-time flag: set NEXT_PUBLIC_OAUTH_APPLE=1 in Vercel + redeploy.
export const appleOAuthEnabled = process.env.NEXT_PUBLIC_OAUTH_APPLE === '1';

export async function signInWithProvider(
  provider: OAuthProvider
): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // location.origin (not NEXT_PUBLIC_APP_URL) so localhost, previews,
      // and prod all round-trip to their own /auth/callback — each origin
      // must be in Supabase's redirect allow-list.
      redirectTo: `${window.location.origin}/auth/callback`,
      ...(provider === 'apple' ? { scopes: 'name email' } : {}),
    },
  });
  return { error: error ?? null };
}
