// ── recordAuthority — THE one writer of authority_audit (migration 240) ─────
// Called AFTER the origin write succeeded, and awaited (the performance
// writer's rule). It never throws and never fails the user's action: a
// missing table (before 240 runs — 42P01) warns once and skips; a value the
// CHECK refuses (23514) is logged naming 240. A shape error from the builder
// is a programming error and is logged loudly, never thrown into a route.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAuthorityRow, type AuthorityInput } from './audit';

let warnedMissing = false;

export async function recordAuthority(admin: SupabaseClient, input: AuthorityInput): Promise<void> {
  let row;
  try {
    row = buildAuthorityRow(input);
  } catch (e) {
    console.error('[authority-audit] refused to build a row:', e instanceof Error ? e.message : e, input.action);
    return;
  }
  try {
    const { error } = await admin.from('authority_audit').insert(row);
    if (!error) return;
    if (error.code === '42P01') {
      if (!warnedMissing) console.warn('[authority-audit] authority_audit is missing — run migration 240');
      warnedMissing = true;
      return;
    }
    if (error.code === '23514') {
      console.error(`[authority-audit] the database refused "${row.action}" — is migration 240 current?`, error.message);
      return;
    }
    console.error('[authority-audit] insert failed:', error.message);
  } catch (e) {
    console.error('[authority-audit] insert threw:', e instanceof Error ? e.message : e);
  }
}
