/**
 * The jobs registry (migration 267): every cron writes its last run through
 * this one helper so the Overview can say when each job ran and whether it
 * finished. Pre-267 (no table) the record is a no-op — a job never fails
 * because the registry is missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportRouteError } from '@/lib/observability/report';

const NOT_LIVE_CODES = new Set(['42P01', 'PGRST205']);

export type JobName =
  | 'daily'
  | 'storage-sweep'
  | 'media-jobs'
  | 'golf-map-sweep'
  | 'reminders'
  | 'urgent-emails'
  | 'notification-digest'
  | 'platform-rollup'
  | 'health-sample';

/** Runs `fn`, records started / finished / ok / duration / summary, and returns `fn`'s result (or rethrows). */
export async function recordJobRun<T extends { ok?: boolean } | Record<string, unknown>>(
  admin: SupabaseClient,
  job: JobName,
  fn: () => Promise<T>,
  opts: { ok?: (result: T) => boolean } = {}
): Promise<T> {
  const started = new Date();
  await write(admin, { job, last_started_at: started.toISOString(), last_finished_at: null, ok: null, duration_ms: null, summary: null });
  try {
    const result = await fn();
    const finished = new Date();
    const ok = opts.ok ? opts.ok(result) : defaultOk(result);
    await write(admin, { job, last_started_at: started.toISOString(), last_finished_at: finished.toISOString(), ok, duration_ms: finished.getTime() - started.getTime(), summary: trim(result) });
    return result;
  } catch (err) {
    const finished = new Date();
    await write(admin, { job, last_started_at: started.toISOString(), last_finished_at: finished.toISOString(), ok: false, duration_ms: finished.getTime() - started.getTime(), summary: { error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) } });
    throw err;
  }
}

/** A phased job is ok when no phase reports ok:false. */
export function defaultOk(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  if ((result as { ok?: boolean }).ok === false) return false;
  return !Object.values(result as Record<string, unknown>).some(v => v && typeof v === 'object' && (v as { ok?: boolean }).ok === false);
}

/** The summary kept small: strings cut, arrays capped — the row is a status line, not a log. */
export function trim(value: unknown, depth = 0): unknown {
  if (depth > 3) return '…';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = trim(v, depth + 1);
    return out;
  }
  return value;
}

async function write(admin: SupabaseClient, row: { job: JobName; last_started_at: string; last_finished_at: string | null; ok: boolean | null; duration_ms: number | null; summary: unknown }): Promise<void> {
  const { error } = await admin.from('platform_jobs').upsert(row, { onConflict: 'job' });
  if (error && !NOT_LIVE_CODES.has(error.code)) reportRouteError(`[platform_jobs] ${row.job} write failed:`, error.message);
}

/** For a route that already built its own phased summary (the daily cron): one write at the end. */
export async function recordJobSummary(admin: SupabaseClient, job: JobName, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const finished = new Date();
  await write(admin, { job, last_started_at: startedAt.toISOString(), last_finished_at: finished.toISOString(), ok: defaultOk(summary), duration_ms: finished.getTime() - startedAt.getTime(), summary: trim(summary) });
}
