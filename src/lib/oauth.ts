'use client';

import { supabase } from './supabase';

// OAuth sign-in is fire-and-navigate: the page unloads immediately and the
// session arrives later via auth.tsx's onAuthStateChange. No React state to
// hold, so this lives outside the auth context on purpose.

export type OAuthProvider = 'google' | 'apple';

// Providers stay hidden until their Supabase config exists — a visible
// button that errors is worse than no button. Build-time flags: set
// NEXT_PUBLIC_OAUTH_GOOGLE=1 / NEXT_PUBLIC_OAUTH_APPLE=1 in Vercel +
// redeploy once the provider is enabled in the Supabase dashboard.
export const googleOAuthEnabled = process.env.NEXT_PUBLIC_OAUTH_GOOGLE === '1';
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
