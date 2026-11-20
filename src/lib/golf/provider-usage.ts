/**
 * One provider's daily usage, as the admin readout shows it (Nov 20 2026).
 * Zero imports: the rule about the window lives here so a test can pin it.
 *
 * The counter (`rate_limits`, migration 094) is a FIXED 24-hour window that
 * starts at the key's first hit, not at midnight. A row older than that is
 * stale until the next hit resets it, so it reads as nothing used. A refused
 * hit still counts, so a count can sit above the limit: that is shown as the
 * limit reached, never as more than the limit.
 */
export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ProviderUsageRow {
  source: string;
  limit: number;
  /** Calls allowed through in the current window (never above the limit). */
  used: number;
  /** Hits refused in the current window because the limit was reached. */
  refused: number;
  /** When the current window ends, or null when no window is open. */
  resetsAt: string | null;
  state: 'idle' | 'open' | 'reached';
}

export function usageRow(source: string, limit: number, counter: { count: number; window_start: string } | null | undefined, nowMs: number): ProviderUsageRow {
  const started = counter ? Date.parse(counter.window_start) : NaN;
  const live = !!counter && Number.isFinite(started) && nowMs - started < BUDGET_WINDOW_MS;
  if (!live) return { source, limit, used: 0, refused: 0, resetsAt: null, state: 'idle' };
  const count = Math.max(0, Math.floor(counter!.count));
  const used = Math.min(count, limit);
  return {
    source,
    limit,
    used,
    refused: Math.max(0, count - limit),
    resetsAt: new Date(started + BUDGET_WINDOW_MS).toISOString(),
    state: count >= limit ? 'reached' : 'open',
  };
}
