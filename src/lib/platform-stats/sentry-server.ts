/**
 * Sentry's error counts for the Overview (H3). A READ-ONLY token of its own
 * (`SENTRY_STATS_TOKEN`: org:read + project:read — the build's source-map
 * token stays a build secret) plus `SENTRY_ORG` and `SENTRY_PROJECT_ID`.
 * Unset → `configured: false` and no request is made. The nightly rollup
 * rewrites the last 14 days into platform_stats_daily (`errors.sentry` —
 * Sentry's counts settle late); the page's "last 24 h" is cached 5 minutes.
 * A 429 keeps the last value and says it is stale. `stats_v2` has no
 * environment filter: the numbers are every environment on the DSN.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSentryStats, sentryStatsUrl, type SentryDay } from './sentry';
import { reportRouteError } from '@/lib/observability/report';

const TIMEOUT_MS = 8_000;

export function sentryStatsConfig(env: Record<string, string | undefined> = process.env): { org: string; projectId: string; token: string } | null {
  const org = env.SENTRY_ORG?.trim();
  const projectId = env.SENTRY_PROJECT_ID?.trim();
  const token = env.SENTRY_STATS_TOKEN?.trim();
  return org && projectId && token ? { org, projectId, token } : null;
}

export async function fetchSentryDaily(days: number): Promise<{ ok: boolean; rows: SentryDay[]; status: number | null }> {
  const cfg = sentryStatsConfig();
  if (!cfg) return { ok: false, rows: [], status: null };
  try {
    const res = await fetch(sentryStatsUrl(cfg.org, cfg.projectId, days), {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, rows: [], status: res.status };
    return { ok: true, rows: parseSentryStats(await res.json()), status: res.status };
  } catch (err) {
    reportRouteError('[sentry-stats] fetch failed:', err);
    return { ok: false, rows: [], status: null };
  }
}

/** The nightly write: the last 14 days of `errors.sentry`, upserted (the past settles). */
export async function syncSentryErrors(admin: SupabaseClient, today: string): Promise<{ configured: boolean; ok: boolean; days: number; status: number | null }> {
  if (!sentryStatsConfig()) return { configured: false, ok: true, days: 0, status: null };
  const { ok, rows, status } = await fetchSentryDaily(14);
  if (!ok) return { configured: true, ok: false, days: 0, status };
  const upserts = rows.filter(r => r.day < today).map(r => ({ day: r.day, metric: 'errors.sentry', dim: '', value: r.count, updated_at: new Date().toISOString() }));
  if (upserts.length > 0) {
    const { error } = await admin.from('platform_stats_daily').upsert(upserts, { onConflict: 'day,metric,dim' });
    if (error) return { configured: true, ok: false, days: 0, status };
  }
  return { configured: true, ok: true, days: upserts.length, status };
}

// ── "Last 24 h": cached 5 minutes per process; a refusal keeps the last value ──
let cache: { at: number; value: { configured: boolean; count: number | null; stale: boolean; status: number | null } } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

export async function sentryLast24h(now = Date.now()): Promise<{ configured: boolean; count: number | null; stale: boolean; status: number | null }> {
  if (!sentryStatsConfig()) return { configured: false, count: null, stale: false, status: null };
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const { ok, rows, status } = await fetchSentryDaily(2);
  if (ok) {
    const count = rows.reduce((s, r) => s + r.count, 0);
    cache = { at: now, value: { configured: true, count, stale: false, status } };
  } else {
    cache = { at: now, value: { configured: true, count: cache?.value.count ?? null, stale: true, status } };
  }
  return cache.value;
}

/** Test seam. */
export function resetSentryCache(): void {
  cache = null;
}
