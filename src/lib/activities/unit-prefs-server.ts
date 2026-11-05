import type { SupabaseClient } from '@supabase/supabase-js';
import type { UnitSystem } from './unit-prefs';

/**
 * The ONE writer of the account's unit system (293): one word onto the
 * ACCOUNT's own profile row. The caller (PATCH /api/settings/units) has
 * already run the zod enum — this stores exactly what it is given, like the
 * favourites and theme-prefs routes.
 */
export async function writeUnitSystem(
  client: SupabaseClient,
  profileId: string,
  sys: UnitSystem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from('profiles')
    .update({ unit_system: sys })
    .eq('id', profileId);
  if (error) {
    console.error('[units] writeUnitSystem failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
