import type { SupabaseClient } from '@supabase/supabase-js';
import { providerBreakerSnapshot, providerBudgetLimit, providerBudgetSources } from '@/lib/golf/course-catalog';
import { usageRow, type ProviderUsageRow } from '@/lib/golf/provider-usage';

export interface ProviderUsage {
  providers: ProviderUsageRow[];
  /** Hosts THIS server instance is skipping after a failure, and until when. */
  skipped: Array<{ host: string; until: string }>;
  readAt: string;
}

/** The admin readout (Nov 20 2026): every golf provider's daily counter beside
 *  the limit in force, and the hosts the answering instance is skipping. One
 *  read of `rate_limits`; nothing is written. */
export async function readProviderUsage(admin: SupabaseClient, nowMs: number = Date.now()): Promise<ProviderUsage> {
  const { data, error } = await admin.from('rate_limits').select('key, count, window_start').like('key', 'golf-provider:%');
  if (error) throw new Error(error.message);
  const counters = new Map<string, { count: number; window_start: string }>();
  for (const r of data ?? []) counters.set((r.key as string).slice('golf-provider:'.length), { count: r.count as number, window_start: r.window_start as string });
  // Every source with a limit of its own, then any counter with no named limit.
  const sources = [...new Set([...providerBudgetSources(), ...counters.keys()])];
  return {
    providers: sources.map(s => usageRow(s, providerBudgetLimit(s), counters.get(s), nowMs)),
    skipped: Object.entries(providerBreakerSnapshot()).map(([host, until]) => ({ host, until: new Date(until).toISOString() })),
    readAt: new Date(nowMs).toISOString(),
  };
}
