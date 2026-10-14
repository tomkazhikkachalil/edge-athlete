import type { SupabaseClient } from '@supabase/supabase-js';
import type { SportKey } from './SportRegistry';
import { SPORT_REGISTRY } from './SportRegistry';

/**
 * "Playing it adds it" (Oct 14 2026): the ONE writer that puts a sport on a
 * person's list — an empty `sport_settings` row (076's shape; onboarding and
 * the Edit Profile picker write the same row). Idempotent (the UNIQUE on
 * profile_id × sport_key; duplicates ignored), never throws, never fails the
 * caller's write — a post lands whether or not its sport could be declared.
 * Called from POST /api/posts after a PUBLISHED non-general post, and by the
 * pins writer for each pinned key.
 */
export async function declareSport(client: SupabaseClient, profileId: string, key: SportKey): Promise<void> {
  if (!SPORT_REGISTRY[key]) return;
  try {
    const { error } = await client
      .from('sport_settings')
      .upsert({ profile_id: profileId, sport_key: key }, { onConflict: 'profile_id,sport_key', ignoreDuplicates: true });
    if (error) console.error('[sports] declareSport failed:', key, error.message);
  } catch (e) {
    console.error('[sports] declareSport threw:', key, e instanceof Error ? e.message : e);
  }
}
