import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runReminderSweep } from '@/lib/calendar/reminders-server';
import { FEATURE_FLAGS } from '@/lib/features';

export const maxDuration = 60;

// ── GET /api/cron/reminders ───────────────────────────────────────────────────
// Invoked every 10 minutes by Supabase pg_cron (migration 059) — Vercel
// Hobby crons only run daily, hence the external trigger. Flag off returns
// 200 {skipped} so the pg_cron job's logs stay green pre-launch. The same
// sweep also runs once daily inside /api/cron/daily as an idempotent
// safety net (reminded_at dedups; it can never double-fire).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ skipped: 'flag off' });
  }
  try {
    const summary = await runReminderSweep(getSupabaseAdmin());
    if (summary.due > 0) console.log('[REMINDERS]', JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error('[REMINDERS] sweep failed:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
