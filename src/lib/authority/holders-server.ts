// ── Who holds authority — one read for many people (Authority PR 2) ─────────
// The backup rules count only people who can actually run something: not
// limited / suspended / banned, not departed (moderation/state.ts
// holdsAuthority). One query for a set of profile ids; a failed read answers
// "does not hold" (a guard must fail closed: a backup we cannot confirm is no
// backup).

import type { SupabaseClient } from '@supabase/supabase-js';
import { holdsAuthority } from '@/lib/moderation/state';

export async function readAuthorityHolders(admin: SupabaseClient, profileIds: string[], now: Date = new Date()): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await admin.from('profiles').select('id, moderation_state, moderation_until, departed_at').in('id', ids);
  if (error) {
    console.error('[authority] holder read failed:', error.message);
    for (const id of ids) out.set(id, false);
    return out;
  }
  for (const id of ids) out.set(id, false);
  for (const p of (data ?? []) as Array<{ id: string; moderation_state: string | null; moderation_until: string | null; departed_at: string | null }>) {
    out.set(p.id, holdsAuthority(p, now));
  }
  return out;
}
