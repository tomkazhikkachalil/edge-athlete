import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The ONE writer of favourite sports (285): the whole sanitized, sorted list
 * onto the ACCOUNT's own profile row. The caller (PATCH /api/settings/
 * favourite-sports) has already run sanitizeFavouriteSports — this stores
 * exactly what it is given, like the theme-prefs route.
 */
export async function writeFavouriteSports(
  client: SupabaseClient,
  profileId: string,
  sports: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from('profiles')
    .update({ favourite_sports: sports })
    .eq('id', profileId);
  if (error) {
    console.error('[sports] writeFavouriteSports failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
