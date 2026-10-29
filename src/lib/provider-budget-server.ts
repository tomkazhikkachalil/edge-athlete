import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ONE daily fixed-window hit against `rate_limit_hit` (mig 094) for a
 * third-party provider's day budget. Fail CLOSED: an RPC error means "no" —
 * protect the budget, serve local. Lifted from the golf course catalog
 * (Oct 29 2026) so a non-golf provider (the weather) has an owner that is
 * not golf; `consumeProviderBudget` there still prefixes its keys with
 * `golf-provider:` and reads its own table of budgets.
 */
export async function hitDailyBudget(admin: SupabaseClient, key: string, max: number): Promise<boolean> {
  try {
    const { data, error } = await admin
      .rpc('rate_limit_hit', { p_key: key, p_max: max, p_window_seconds: 86400 })
      .single();
    if (error) return false;
    return (data as { allowed: boolean }).allowed === true;
  } catch {
    return false;
  }
}
