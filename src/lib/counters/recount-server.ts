import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The accuracy rule for the three cached counters (migration 277, Oct 26
 * 2026 — Convention 32): `posts.likes_count`, `posts.comments_count`
 * (published only) and `post_comments.likes_count` are kept by triggers that
 * add or subtract ONE per write; this nightly step asks `counters_recount()`
 * to correct every row whose stored number differs from a direct count and
 * reports how many it touched per target (zero on a healthy night). The ONE
 * caller is /api/cron/daily. Server-only; service_role.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface CounterRecountSummary {
  ok: boolean;
  /** rows corrected, by target — `posts.likes_count` and so on */
  fixed: Record<string, number>;
}

const TAG = '[counters]';

export async function runCounterRecount(admin: Admin): Promise<CounterRecountSummary> {
  const { data, error } = await admin.rpc('counters_recount');
  if (error) {
    // PGRST202 = the function is not there yet (a deploy ahead of 277 on that database): nothing to do, not a failure.
    if (error.code === 'PGRST202') return { ok: true, fixed: {} };
    console.error(`${TAG} recount failed:`, error.message);
    return { ok: false, fixed: {} };
  }
  const fixed: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ target: string; fixed: number }>) fixed[row.target] = Number(row.fixed) || 0;
  const total = Object.values(fixed).reduce((s, n) => s + n, 0);
  if (total > 0) console.warn(`${TAG} nightly recount corrected ${total} row(s):`, fixed);
  return { ok: true, fixed };
}
