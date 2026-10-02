import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runPushSweep } from '@/lib/push/sweep-server';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 60;

// ── POST /api/push/sweep (mig 248) ──────────────────────────────────────────
// Called every minute by the `push-sweep` pg_cron job (production) and once a
// day by /api/cron/daily as a safety net. CRON_SECRET or 401 — fails closed
// when the secret is unset (the daily route's rule).
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runPushSweep(getSupabaseAdmin());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    reportRouteError('[PUSH] sweep failed:', error);
    return NextResponse.json({ ok: false, error: 'Sweep failed' }, { status: 500 });
  }
}
