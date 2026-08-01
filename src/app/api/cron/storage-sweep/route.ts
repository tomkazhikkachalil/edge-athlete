import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runStorageSweep } from '@/lib/storage-sweep-server';

// Full-bucket walk + full-table reference scan can exceed the default limit.
export const maxDuration = 60;

/**
 * GET /api/cron/storage-sweep — weekly orphaned-upload cleanup.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Fail-closed
 * when CRON_SECRET is unset (same pattern as notification-digest).
 *
 * THIS DELETES FOR REAL. The vercel.json entry calls it with no `dryRun` param
 * (Aug 1 2026, after a reviewed manual run). Add `?dryRun=1` back to return to
 * report-only. What stands between this and data loss:
 *   - the 48h grace window (uploads land before the row referencing them)
 *   - a full reference scan over URL_SOURCE_COLUMNS; if any part of that scan
 *     fails the sweep throws and deletes NOTHING, which is the intended
 *     failure mode — an incomplete reference set makes live files look orphaned
 *   - SWEEP_BUCKETS, which excludes consent-evidence
 * Adding a column that stores a storage URL means adding it to
 * URL_SOURCE_COLUMNS in the same change, or this will delete those files.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  try {
    const summary = await runStorageSweep(getSupabaseAdmin(), dryRun);
    console.log('[SWEEP-CRON]', JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error('[SWEEP-CRON] error:', error);
    return NextResponse.json({ error: 'Storage sweep failed' }, { status: 500 });
  }
}
