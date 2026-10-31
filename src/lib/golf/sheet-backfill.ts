// ── The official-sheet backfill's rules (Oct 31 2026) — pure, zero imports ──
// Tom: fill missing scorecards in batches, proven small before any big
// rollout. Each batch is capped, dry-run unless asked otherwise, scoped to a
// place, and skips rows asked within the retry window so batches move on.

export const BACKFILL_MAX_LIMIT = 25;
export const BACKFILL_DEFAULT_LIMIT = 10;
export const BACKFILL_RETRY_DAYS = 7;
export const BACKFILL_WORK_BUDGET_MS = 50_000;

export interface BackfillParams {
  dryRun: boolean;
  limit: number;
  countryCode: string;
  regionCode: string | null;
}

/** Any body → safe params. Live only on an explicit `dryRun: false`; a place is required. */
export function parseBackfillParams(body: unknown): BackfillParams | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = (v: unknown) => (typeof v === 'string' && /^[A-Za-z]{2,3}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
  const countryCode = code(b.countryCode);
  if (!countryCode) return null;
  const raw = typeof b.limit === 'number' && Number.isFinite(b.limit) ? Math.floor(b.limit) : BACKFILL_DEFAULT_LIMIT;
  return {
    dryRun: b.dryRun !== false,
    limit: Math.min(Math.max(raw, 1), BACKFILL_MAX_LIMIT),
    countryCode,
    regionCode: code(b.regionCode),
  };
}

export function backfillRetryCutoff(now: number): string {
  return new Date(now - BACKFILL_RETRY_DAYS * 86_400_000).toISOString();
}
