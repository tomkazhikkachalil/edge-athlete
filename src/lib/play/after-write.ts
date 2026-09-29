import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformanceRow } from '@/lib/performance/types';
import { awardBadgesAfterWrite } from './badges-server';

/**
 * The ONE post-write hook of the performance fact table — the Play program
 * (244). `upsertPerformances` calls it after every successful upsert, so
 * every sport and every writer (a round, a stat line, an event's mirror, an
 * org's line, a league overlay) reaches it without a hook of its own.
 *
 *  • 'notify' — a live write: badges earned now bell the athlete.
 *  • 'silent' — the backfill: history earns badges without bells.
 *
 * Never throws; awaited (serverless kills fire-and-forget).
 */
export type AfterWriteMode = 'notify' | 'silent';

export async function afterPerformanceWrite(admin: SupabaseClient, rows: readonly PerformanceRow[], mode: AfterWriteMode): Promise<void> {
  if (rows.length === 0) return;
  await awardBadgesAfterWrite(admin, rows, { notify: mode === 'notify' });
}
