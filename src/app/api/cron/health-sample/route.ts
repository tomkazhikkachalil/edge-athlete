import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { recordHealthSample } from '@/lib/platform-stats/health-server';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 15;

/**
 * /api/cron/health-sample — the 5-minute probe (migration 267; H3),
 * scheduled by pg_cron on production (268). One index HEAD, one row,
 * a prune past 14 days. The Overview's uptime counts a MISSING sample as
 * down, so this route stays tiny and never retries. CRON_SECRET or 401;
 * POST (pg_net's shape) and GET (a hand check) alike. Not recorded in
 * platform_jobs — 288 writes a day would only be noise there; the samples
 * table IS its record.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await recordHealthSample(getSupabaseAdmin());
    return NextResponse.json(result, { status: result.supported ? 200 : 409 });
  } catch (error) {
    reportRouteError('[health-sample] failed:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}
