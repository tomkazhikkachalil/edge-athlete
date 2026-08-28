// Shared safety-patch semantics (Wave 4) — the ONE code path that changes a
// supervised child's safety posture, extracted from the athlete PATCH so
// apply-to-all and the age-preset decision can't drift from it: supervised
// gate, consent gate only on visibility→public, changed-only best-effort
// audit rows (091 — the three live field names, zero audit DDL).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdPresets } from './household-policy';

export type SafetyPatch = Partial<HouseholdPresets>;

export type ApplyResult =
  | { ok: true; changed: string[] } // [] = already matching (no audit rows)
  | { ok: false; reason: 'not_supervised' | 'consent_required' | 'update_failed' };

export async function applySafetyPatch(
  admin: SupabaseClient,
  /** The acting guardian (audit attribution); null = system. */
  actorId: string | null,
  profileId: string,
  patch: SafetyPatch
): Promise<ApplyResult> {
  const update = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
  if (Object.keys(update).length === 0) return { ok: true, changed: [] };

  const { data: child } = await admin
    .from('profiles')
    .select('supervision_state, visibility, messaging_permission, comment_moderation')
    .eq('id', profileId)
    .maybeSingle();
  if (!child || child.supervision_state !== 'supervised') {
    return { ok: false, reason: 'not_supervised' };
  }

  // Going public requires approved consent — same promise the publish gate
  // enforces (posts/route.ts): nothing is visible until consent approves.
  if (update.visibility === 'public') {
    const { getConsentState } = await import('./consent');
    const consent = await getConsentState(admin, profileId);
    if (consent !== 'approved') {
      return { ok: false, reason: 'consent_required' };
    }
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (updateError) {
    console.error('[safety-settings] update failed:', updateError);
    return { ok: false, reason: 'update_failed' };
  }

  // Audit trail (091): who changed the safety posture, old → new. One row
  // per CHANGED field; best-effort (an insert failure must never fail the
  // change itself).
  const auditRows = Object.entries(update)
    .filter(([field, value]) => (child as Record<string, unknown>)[field] !== value)
    .map(([field, value]) => ({
      profile_id: profileId,
      actor_id: actorId,
      field,
      old_value: ((child as Record<string, unknown>)[field] as string | null) ?? null,
      new_value: value,
    }));
  if (auditRows.length > 0) {
    const { error: auditError } = await admin.from('safety_settings_audit').insert(auditRows);
    if (auditError) console.error('[safety-settings] audit insert failed:', auditError);
  }

  return { ok: true, changed: auditRows.map(r => r.field) };
}
