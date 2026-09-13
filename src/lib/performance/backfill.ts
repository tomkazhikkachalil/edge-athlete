import { isUuid } from '@/lib/uuid';

/**
 * The performance backfill's pure half — data foundation, F5 (Sep 13 2026).
 *
 * The write hooks (F4) project every NEW fact; the rows that predate them
 * are walked by `POST /api/admin/performance-backfill` (F5), one SOURCE
 * per call, keyset-paged on (created_at, id) — never OFFSET (a moving
 * table under an offset skips or repeats rows) — and idempotent by
 * `natural_key`. This file owns the cursor and the page maths so both
 * are unit-tested; the I/O lives in `backfill-server.ts`.
 *
 * Run order (the doc's rule): golf_rounds → posts → contest_stat_lines →
 * contest_results LAST so the league overlays win over the rounds' plain
 * rows.
 */

export const BACKFILL_SOURCES = ['golf_rounds', 'posts', 'contest_stat_lines', 'contest_results'] as const;
export type BackfillSource = (typeof BACKFILL_SOURCES)[number];
export const isBackfillSource = (v: unknown): v is BackfillSource =>
  typeof v === 'string' && (BACKFILL_SOURCES as readonly string[]).includes(v);

/** Rows per page and pages per request — a request stays well inside the
 *  route's `maxDuration`; the caller continues from `nextCursor`. */
export const PAGE_SIZE = 500;
export const MAX_PAGES = 10;

export interface Cursor {
  /** The last row's created_at (ISO). */
  t: string;
  /** The last row's id — the tie-breaker for equal timestamps. */
  id: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Opaque to the caller: base64url of the JSON pair. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** `null` for anything that is not a cursor this module wrote (a tampered
 *  or truncated value) — the route answers 400, never queries with it. */
export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { t, id } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || !ISO_RE.test(t) || !Number.isFinite(Date.parse(t))) return null;
    if (typeof id !== 'string' || !isUuid(id)) return null;
    return { t, id };
  } catch {
    return null;
  }
}

/** The PostgREST `or` filter for "strictly after the cursor" in
 *  (created_at, id) order. Both values were validated by `decodeCursor`
 *  (an ISO timestamp and a uuid) — nothing user-shaped reaches the
 *  string. */
export function keysetAfter(c: Cursor): string {
  return `created_at.gt.${c.t},and(created_at.eq.${c.t},id.gt.${c.id})`;
}

/** The cursor a page hands on — its LAST row — or `null` when the page
 *  was short (the walk is complete). */
export function cursorAfterPage<T extends { created_at: string; id: string }>(rows: readonly T[], pageSize = PAGE_SIZE): Cursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { t: last.created_at, id: last.id };
}

export interface BackfillSummary {
  dryRun: boolean;
  source: BackfillSource;
  /** Origin rows read. */
  scanned: number;
  /** Rows that projected to a performance row. */
  mapped: number;
  /** Rows the mapper declined, by reason. */
  skipped: Record<string, number>;
  /** Rows written (0 on a dry run). */
  upserted: number;
  /** The page budget ran out before the walk completed. */
  truncated: boolean;
  /** Continue from here; `null` when the walk is complete. */
  nextCursor: string | null;
}

export function emptySummary(source: BackfillSource, dryRun: boolean): BackfillSummary {
  return { dryRun, source, scanned: 0, mapped: 0, skipped: {}, upserted: 0, truncated: false, nextCursor: null };
}

export function countSkip(summary: BackfillSummary, reason: string): void {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}
