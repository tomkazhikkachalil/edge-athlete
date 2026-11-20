import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { readProviderUsage } from '@/lib/golf/provider-usage-server';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * GET /api/admin/golf-providers — each golf provider's calls today against
 * its daily limit, and the hosts this server instance is skipping after a
 * failure. Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await readProviderUsage(getSupabaseAdmin()), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-providers]', error);
    return NextResponse.json({ error: 'Could not read provider usage' }, { status: 500, headers: NO_STORE });
  }
}
