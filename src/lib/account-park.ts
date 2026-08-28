import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 30-day soft delete (Family Console Wave 1e, migration 128).
 *
 * Deletion PARKS the account instead of destroying it: the profile is
 * stamped `deletion_requested_at` and forced private, and the existing
 * hard-delete engine runs only when the cron purge finds the stamp older
 * than 30 days. Restore clears the stamp (visibility STAYS private — the
 * owner reopens it deliberately; a restore must never silently re-publish).
 *
 * Honest limitation, by design: while parked, accepted followers can still
 * see previously-published content (the profile is private, not scrubbed).
 * Full disappearance happens at purge. Documented in the delete dialogs.
 */

export const PARK_WINDOW_DAYS = 30;

export function parkPurgeDate(parkedAtIso: string): Date {
  return new Date(new Date(parkedAtIso).getTime() + PARK_WINDOW_DAYS * 86_400_000);
}

export async function parkAccount(admin: SupabaseClient, profileId: string): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: new Date().toISOString(), visibility: 'private' })
    .eq('id', profileId);
  if (error) throw new Error(`park failed: ${error.message}`);
}

export async function restoreAccount(admin: SupabaseClient, profileId: string): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', profileId);
  if (error) throw new Error(`restore failed: ${error.message}`);
}

/**
 * Cron phase: hard-delete every account parked longer than the window.
 * Each account fails independently — one stuck deletion (e.g. a parked
 * guardian whose co-guardian left, so the zero-access constraint refuses
 * the cascade) must not block the rest; it stays parked and logs loudly.
 */
export async function runDeletionPurge(
  admin: SupabaseClient
): Promise<{ ok: boolean; purged: number; failed: number }> {
  const cutoff = new Date(Date.now() - PARK_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: expired, error } = await admin
    .from('profiles')
    .select('id')
    .not('deletion_requested_at', 'is', null)
    .lt('deletion_requested_at', cutoff)
    .limit(50); // bounded per run; the daily cadence drains any backlog
  if (error) {
    console.error('[deletion-purge] expired lookup failed:', error);
    return { ok: false, purged: 0, failed: 0 };
  }

  // Lazy: this module is imported by client components for PARK_WINDOW_DAYS/
  // parkPurgeDate — the deletion engine must not enter the client bundle.
  const { hardDeleteAccount } = await import('./account-deletion');

  let purged = 0;
  let failed = 0;
  for (const row of expired ?? []) {
    try {
      await hardDeleteAccount(admin, row.id);
      purged++;
    } catch (err) {
      failed++;
      console.error(`[deletion-purge] hard delete failed for ${row.id}:`, err);
    }
  }
  return { ok: failed === 0, purged, failed };
}
