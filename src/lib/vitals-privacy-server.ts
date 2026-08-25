import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_VITALS_PRIVACY, parseVitalsPrivacy, type VitalsPrivacy } from './vitals-privacy';

/**
 * Server-side privacy read, in its OWN query on purpose: folding
 * `vitals_privacy` into a route's main profile select would fail the whole
 * select (42703) on any deploy that precedes migration 122, taking the
 * vitals tab down with it. A dedicated query degrades to all-visible —
 * exactly today's behavior — so merge order is not strict (the 121
 * precedent). Fail-open is correct here: this gates optional extra privacy
 * on top of profile visibility, which the calling routes enforce first.
 */
export async function fetchVitalsPrivacy(
  admin: SupabaseClient,
  profileId: string
): Promise<VitalsPrivacy> {
  const { data, error } = await admin
    .from('profiles')
    .select('vitals_privacy')
    .eq('id', profileId)
    .single();
  if (error) return { ...DEFAULT_VITALS_PRIVACY };
  return parseVitalsPrivacy((data as { vitals_privacy?: unknown } | null)?.vitals_privacy);
}
