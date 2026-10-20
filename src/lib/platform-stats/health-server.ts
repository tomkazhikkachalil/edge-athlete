/**
 * The health probe and its sampler (migration 267; H3). `probeDatabase` is
 * the ONE probe — /api/health and the 5-minute sampler share it (an index
 * HEAD for one primary-key row, never a count). `recordHealthSample` writes
 * one row and prunes past 14 days; pre-267 it is a no-op success.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const NOT_LIVE_CODES = new Set(['42P01', 'PGRST205']);
export const HEALTH_RETENTION_DAYS = 14;

export async function probeDatabase(admin: SupabaseClient): Promise<{ ok: boolean; dbMs: number }> {
  const t0 = Date.now();
  try {
    const { error } = await admin.from('profiles').select('id', { head: true }).limit(1);
    return { ok: !error, dbMs: Date.now() - t0 };
  } catch {
    return { ok: false, dbMs: Date.now() - t0 };
  }
}

export async function recordHealthSample(admin: SupabaseClient, now: Date = new Date()): Promise<{ ok: boolean; supported: boolean; dbMs: number; pruned: number }> {
  const probe = await probeDatabase(admin);
  const { error } = await admin.from('platform_health_samples').insert({ at: now.toISOString(), db_ms: Math.max(0, Math.round(probe.dbMs)), ok: probe.ok });
  if (error) {
    if (NOT_LIVE_CODES.has(error.code)) return { ok: probe.ok, supported: false, dbMs: probe.dbMs, pruned: 0 };
    throw new Error(`health sample write failed: ${error.message}`);
  }
  const cutoff = new Date(now.getTime() - HEALTH_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: pruned } = await admin.from('platform_health_samples').delete().lt('at', cutoff).select('at');
  return { ok: probe.ok, supported: true, dbMs: probe.dbMs, pruned: pruned?.length ?? 0 };
}
