import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { CATALOG_ROW_COLUMNS, findOfficialSheet, type CatalogRow } from '@/lib/golf/course-catalog';
import { BACKFILL_WORK_BUDGET_MS, backfillRetryCutoff, parseBackfillParams } from '@/lib/golf/sheet-backfill';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * POST /api/admin/golf-sheet-backfill — one small batch of "find the official
 * scorecard" for catalog rows with no sheet, in one place.
 *   { countryCode: 'CA', regionCode?: 'ON', limit?: 1–25, dryRun?: boolean }
 * DRY RUN BY DEFAULT: search and pick only (one provider hit per course), so a
 * person can read the matches before a live batch (two hits per match) writes.
 * Rows asked within seven days are skipped; a live miss is stamped.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const params = parseBackfillParams(await request.json().catch(() => null));
    if (!params) return NextResponse.json({ error: 'countryCode is required' }, { status: 400, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    let q = admin
      .from('golf_courses')
      .select(CATALOG_ROW_COLUMNS)
      .eq('country_code', params.countryCode)
      .or('hole_data.is.null,hole_data.eq.[]')
      .or(`hydrated_at.is.null,hydrated_at.lt.${backfillRetryCutoff(Date.now())}`)
      .order('name', { ascending: true })
      .limit(params.limit);
    if (params.regionCode) q = q.eq('region_code', params.regionCode);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const started = Date.now();
    const results: Array<{ id: string; name: string; source: string; outcome: string; match: { id: string; name: string; city: string | null } | null; holes: number }> = [];
    let stopped: 'time' | 'budget' | null = null;
    for (const row of (data ?? []) as unknown as CatalogRow[]) {
      if (Date.now() - started > BACKFILL_WORK_BUDGET_MS) { stopped = 'time'; break; }
      const r = await findOfficialSheet(admin, row, { dryRun: params.dryRun, stampMiss: true });
      results.push({ id: row.id, name: row.name, source: row.external_source, outcome: r.outcome, match: r.match ?? null, holes: r.course.holes.length });
      if (r.outcome === 'budget_refused') { stopped = 'budget'; break; }
    }
    return NextResponse.json({ dryRun: params.dryRun, asked: results.length, matched: results.filter(r => r.match).length, stopped, results }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-sheet-backfill]', error);
    return NextResponse.json({ error: 'Backfill batch failed' }, { status: 500, headers: NO_STORE });
  }
}
