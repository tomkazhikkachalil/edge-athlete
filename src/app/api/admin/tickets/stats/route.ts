import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { readStats } from '@/lib/tickets/server';

/** GET /api/admin/tickets/stats — open by type / severity, overdue, resolved in the last 90 days and the median hours to resolve. */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    await requireModerator(request, { intent: 'work_queue' });
    return NextResponse.json(await readStats(getSupabaseAdmin()), { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GET /api/admin/tickets/stats]', error);
    return NextResponse.json({ error: 'Could not load the stats' }, { status: 500, headers });
  }
}
