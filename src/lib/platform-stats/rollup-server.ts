/**
 * The platform rollup (migration 267; flow changes item 2b, H1): ONE UTC day,
 * group by group, through `platform_rollup_day`. The nightly job
 * (`POST /api/cron/platform-rollup`, scheduled by pg_cron in 268) runs every
 * group for yesterday with a 240 s budget; the daily cron's last phase
 * re-asserts T-1 and T-2 inside 15 s (staging's only rollup — it schedules
 * nothing); the Overview's "today so far" is the partial run, cached a
 * minute. A group that fails or runs out of budget is named in the result;
 * the others still land. Pre-267 (no function) answers `supported: false`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportRouteError } from '@/lib/observability/report';
import { PARTIAL_GROUPS, ROLLUP_GROUPS, dayUTC, groupsForRun, type RollupGroup } from './metrics';

const NOT_LIVE_CODES = new Set(['42883', 'PGRST202', '42P01', 'PGRST205']);

export interface RollupRow {
  metric: string;
  dim: string;
  value: number;
}

export interface RollupResult {
  ok: boolean;
  supported: boolean;
  day: string;
  partial: boolean;
  ran: RollupGroup[];
  skipped: RollupGroup[];
  failed: { group: RollupGroup; error: string }[];
  rows: RollupRow[];
  elapsedMs: number;
}

export interface RollupOptions {
  partial?: boolean;
  only?: readonly RollupGroup[];
  /** Wall-clock budget; a group starts only while time remains. */
  budgetMs?: number;
  now?: () => number;
}

export async function runPlatformRollup(admin: SupabaseClient, day: string, opts: RollupOptions = {}): Promise<RollupResult> {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const partial = opts.partial === true;
  const budget = opts.budgetMs ?? 240_000;
  const plan = groupsForRun({ partial, only: opts.only });
  const result: RollupResult = { ok: true, supported: true, day, partial, ran: [], skipped: [], failed: [], rows: [], elapsedMs: 0 };
  for (const group of plan) {
    if (now() - t0 > budget) {
      result.skipped.push(group);
      continue;
    }
    const { data, error } = await admin.rpc('platform_rollup_day', { p_day: day, p_group: group, p_partial: partial });
    if (error) {
      if (NOT_LIVE_CODES.has(error.code)) {
        return { ...result, ok: false, supported: false, skipped: plan, elapsedMs: now() - t0 };
      }
      result.ok = false;
      result.failed.push({ group, error: error.message.slice(0, 300) });
      reportRouteError(`[platform-rollup] ${group} for ${day} failed:`, error.message);
      continue;
    }
    result.ran.push(group);
    for (const r of (data ?? []) as { metric: string; dim: string; value: number | string }[]) {
      result.rows.push({ metric: r.metric, dim: r.dim ?? '', value: Number(r.value) });
    }
  }
  if (result.skipped.length > 0) result.ok = false;
  result.elapsedMs = now() - t0;
  return result;
}

// ── "Today so far": the partial run, cached a minute per process ────────────
let todayCache: { day: string; at: number; result: RollupResult } | null = null;
const TODAY_TTL_MS = 60_000;

export async function computeToday(admin: SupabaseClient, now: Date = new Date()): Promise<RollupResult> {
  const day = dayUTC(now);
  if (todayCache && todayCache.day === day && now.getTime() - todayCache.at < TODAY_TTL_MS) return todayCache.result;
  const result = await runPlatformRollup(admin, day, { partial: true, only: PARTIAL_GROUPS, budgetMs: 20_000, now: () => Date.now() });
  todayCache = { day, at: now.getTime(), result };
  return result;
}

/** Test seam. */
export function resetTodayCache(): void {
  todayCache = null;
}

export { ROLLUP_GROUPS };
