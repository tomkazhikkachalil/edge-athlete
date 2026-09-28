import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runReminderSweep } from '@/lib/calendar/reminders-server';
import { runScheduledNewsSweep } from '@/lib/org-sites/news-notify-server';
import { reportRouteError } from '@/lib/observability/report';

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
  try {
    const admin = getSupabaseAdmin();
    const summary = await runReminderSweep(admin);
    if (summary.due > 0) console.log('[REMINDERS]', JSON.stringify(summary));
    // A1 (Sep 28 2026): a scheduled news post with "Notify members" bells
    // when its time comes (the claim makes a repeat run a no-op).
    const news = await runScheduledNewsSweep(admin);
    if (news.sent > 0) console.log('[NEWS NOTIFY]', JSON.stringify(news));
    return NextResponse.json({ ok: true, ...summary, news });
  } catch (error) {
    reportRouteError('[REMINDERS] sweep failed:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
