import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { readPageTimingsSummary } from '@/lib/observability/page-timings-server';

// GET /api/admin/page-timings — the console's Page timings card (migration 305): p75 of
// each browser timing metric per build per device class for the last ten builds.
// The console cookie is the gate (requireAdmin); the answer is viewer-
// independent but about the platform, so it is never cached.
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const summary = await readPageTimingsSummary(getSupabaseAdmin());
    return NextResponse.json(summary, { status: summary.ok ? 200 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
