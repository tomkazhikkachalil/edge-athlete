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
 * The vercel.json entry currently calls this with ?dryRun=1 — review a run's
 * output in the Vercel logs, then drop the param to enable real deletion
 * (protected by the 48h grace window + full reference scan either way).
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
