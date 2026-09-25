import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { searchRecovery } from '@/lib/authority/recovery-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/admin/recovery/search?q= — Authority PR 4: find the club, league
 * or event a support ticket is about (EA-1042, an id, a pasted link, a custom
 * domain, a name). Owner-only today (intent 'recover_authority').
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    await requireModerator(request, { intent: 'recover_authority' });
    const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 300);
    const result = await searchRecovery(getSupabaseAdmin(), q);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/recovery/search]', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500, headers: NO_STORE });
  }
}
