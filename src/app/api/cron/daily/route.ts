import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runNotificationDigest } from '@/lib/digest-server';
import { runTransferSweep } from '@/lib/transfers';
import { extendRecurringSeries } from '@/lib/calendar/series-server';
import { runReminderSweep } from '@/lib/calendar/reminders-server';
import { runRoundSweep } from '@/lib/golf/round-sweep';
import { runGolfLeagueSync } from '@/lib/competitions/golf-league-server';
import { runDeletionPurge } from '@/lib/account-park';
import { runPendingNudge } from '@/lib/guardian-nudge';
import { runRiskSweep } from '@/lib/risk-sweep';
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
//   4. Quiet golf rounds: advanceRoundStatus only fires on a score write, so
//      an abandoned live round stays 'active' forever and never mirrors into
//      golf_rounds — its scores silently miss trends and handicap. This
//      re-evaluates them.
//   5. Soft-delete purge: hard-delete accounts whose 30-day park expired
//      (migration 128).
//   6. 48h approval nudge: re-bell guardians once per overdue pending
//      post/comment (approval_nudged_at stamp, mig 129), one notification
//      per child per run. Never auto-publishes. No-op while the guardian
//      flag is off — a nudge into a dark console is noise, and the safety
//      behavior (held content stays held) doesn't depend on it.
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
    summary.recurrence = await extendRecurringSeries(admin);
  } catch (e) {
    console.error('[DAILY] recurrence phase failed:', e);
    summary.recurrence = { ok: false };
  }
  // Idempotent reminder safety net: the SAME strict sweep pg_cron runs
  // every 10 minutes (reminded_at dedups). Deliberately NOT a widened
  // variant — that would fire early and pre-empt the precise reminders.
  try {
    summary.reminders = await runReminderSweep(admin);
  } catch (e) {
    console.error('[DAILY] reminders phase failed:', e);
    summary.reminders = { ok: false };
  }

  try {
    summary.rounds = await runRoundSweep(admin);
  } catch (e) {
    console.error('[DAILY] round sweep phase failed:', e);
    summary.rounds = { ok: false };
  }

  // Phase 6c G2: golf league rounds fill themselves from members' posted
  // rounds — AFTER the round sweep (which mirrors abandoned rounds first).
  // Open windows (+3 days grace) re-sync; windows closed >3 days complete.
  try {
    summary.golfLeague = await runGolfLeagueSync(admin);
  } catch (e) {
    console.error('[DAILY] golf league phase failed:', e);
    summary.golfLeague = { ok: false };
  }

  // 5. Soft-delete purge (Wave 1e, migration 128): hard-delete accounts
  // parked longer than the 30-day window. NOT flag-gated — deletion rails
  // are safety behavior, and a parked account must purge on schedule.
  try {
    summary.deletionPurge = await runDeletionPurge(admin);
  } catch (e) {
    console.error('[DAILY] deletion purge phase failed:', e);
    summary.deletionPurge = { ok: false };
  }

  // 6. 48h approval nudge (Wave 2, mig 129): "nudge, never auto-publish".
  try {
    summary.pendingNudge = FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES
      ? await runPendingNudge(admin)
      : { skipped: 'flag off' };
  } catch (e) {
    console.error('[DAILY] pending nudge phase failed:', e);
    summary.pendingNudge = { ok: false };
  }

  // 7. Risk-signal sweep (Wave 7, mig 137): heuristic metadata-only guardian
  //    signals; day-anchored dedup makes re-runs silent.
  try {
    summary.riskSweep = FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES
      ? await runRiskSweep(admin)
      : { skipped: 'flag off' };
  } catch (e) {
    console.error('[DAILY] risk sweep phase failed:', e);
    summary.riskSweep = { ok: false };
  }

  console.log('[DAILY]', JSON.stringify(summary));
  return NextResponse.json(summary);
}
