import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { defaultJobDeps, mediaJobsEnabled, runMediaJobsTick } from '@/lib/media/process-server';
import { reportRouteError } from '@/lib/observability/report';

// The transcode of a 3-minute clip needs minutes on one vCPU: the function's ceiling.
export const maxDuration = 300;

// ── POST /api/cron/media-jobs ─────────────────────────────────────────────────
// One tick of the media worker (video posters PR 7; migration 262 schedules
// it every minute on production through pg_cron; staging has no schedule).
// pg_net's client gives up at ten seconds, so the tick ANSWERS AT ONCE
// (202) and does its work through `waitUntil` — the function stays alive
// to its ceiling whatever the caller does. Without CRON_SECRET it answers
// 401; with `MEDIA_JOBS=0` it answers 200 and does nothing.
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!mediaJobsEnabled()) return NextResponse.json({ ok: true, disabled: true });
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('media_jobs').select('id', { head: true, count: 'exact' }).limit(1);
  if (error) {
    const missing = error.code === 'PGRST205' || error.code === '42P01';
    return NextResponse.json({ ok: false, error: missing ? 'migration 261 has not run here' : error.message }, { status: missing ? 409 : 500 });
  }
  waitUntil(
    runMediaJobsTick(admin, defaultJobDeps(admin)).then(
      summary => { if (summary.claimed > 0 || !summary.ok) console.log('[media-jobs] tick', JSON.stringify(summary)); },
      err => reportRouteError('[media-jobs] tick failed:', err)
    )
  );
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
