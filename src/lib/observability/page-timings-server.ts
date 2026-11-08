import type { SupabaseClient } from '@supabase/supabase-js';
import { TIMINGS_RETENTION_DAYS, summarizeByBuild, type BuildSummary, type TimingRow } from './page-timings-rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** How many rows the admin card reads at most (the last two weeks, newest first); the RPC comes when this is the bottleneck. */
export const TIMINGS_READ_LIMIT = 5000;
export const TIMINGS_READ_DAYS = 14;

/** The admin console's Page timings card: p75 per build per device, the last ten builds. */
export async function readPageTimingsSummary(admin: Admin, now = new Date()): Promise<{ ok: true; builds: BuildSummary[]; rows: number } | { ok: false; error: string }> {
  const since = new Date(now.getTime() - TIMINGS_READ_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('page_timings')
    .select('build, route, metric, value, rating, device, navigation, signed_in, received_at')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(TIMINGS_READ_LIMIT);
  if (error) {
    return { ok: false, error: error.code === '42P01' || error.code === 'PGRST205' ? 'migration 305 has not run here' : error.message };
  }
  const rows = ((data ?? []) as Array<TimingRow & { received_at: string; value: number | string }>).map((r) => ({ ...r, value: Number(r.value) }));
  return { ok: true, builds: summarizeByBuild(rows), rows: rows.length };
}

/** The daily prune: rows older than the retention go (bounded — a day's worth at a time, the counters are not kept because there are none). */
export async function runPageTimingsPrune(admin: Admin, now = new Date()): Promise<{ ok: boolean; pruned: number }> {
  const cutoff = new Date(now.getTime() - TIMINGS_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin.from('page_timings').delete().lt('received_at', cutoff).select('id');
  if (error?.code === '42P01' || error?.code === 'PGRST205') return { ok: true, pruned: 0 }; // pre-305
  if (error) {
    console.error('[page-timings] prune error:', error);
    return { ok: false, pruned: 0 };
  }
  return { ok: true, pruned: data?.length ?? 0 };
}
