import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runNotificationDigest } from '@/lib/digest-server';
import { runTransferSweep } from '@/lib/transfers';
import { extendRecurringSeries } from '@/lib/calendar/series-server';
import { FEATURE_FLAGS } from '@/lib/features';

export const maxDuration = 60;

// ── GET /api/cron/daily ───────────────────────────────────────────────────────
// The combined daily job (Vercel Hobby allows 2 crons; weekly storage-sweep
// holds the other slot). Phases run independently — one phase's failure
// never blocks the other:
//   1. Notification digest (extracted to lib/digest-server; logic unchanged).
//   2. Guardian transfer sweep: flag newly age-eligible supervised profiles,
//      expire stalled transfers (14d), execute past-cooling-off transfers
//      (idempotent journal; resumes stuck ones). No-op while the guardian
//      feature flag is off.
//   3. Calendar recurrence horizon: extend never-ending series whose
//      materialized window has fallen inside ~6 months. No-op while the
//      calendar flag is off.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (request.headers.get('origin') ?? `https://${request.headers.get('host')}`);

  const summary: Record<string, unknown> = { ok: true };
  try {
    summary.digest = await runNotificationDigest(admin, appUrl);
  } catch (e) {
    console.error('[DAILY] digest phase failed:', e);
    summary.digest = { ok: false };
  }
  try {
    summary.transfers = FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES
      ? await runTransferSweep(admin, appUrl)
      : { skipped: 'flag off' };
  } catch (e) {
    console.error('[DAILY] transfer phase failed:', e);
    summary.transfers = { ok: false };
  }
  try {
    summary.recurrence = FEATURE_FLAGS.FEATURE_CALENDAR
      ? await extendRecurringSeries(admin)
      : { skipped: 'flag off' };
  } catch (e) {
    console.error('[DAILY] recurrence phase failed:', e);
    summary.recurrence = { ok: false };
  }

  console.log('[DAILY]', JSON.stringify(summary));
  return NextResponse.json(summary);
}
