import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { readTicketForUser, readerScope } from '@/lib/tickets/server';
import { reportRouteError } from '@/lib/observability/report';

/** GET /api/tickets/[id] — one of my (or my supervised athlete's) tickets with its visible thread. Any other ticket is a 404, never a 403. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const user = await requireAuth(request);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const admin = getSupabaseAdmin();
    const scope = await readerScope(admin, user.id);
    const result = await readTicketForUser(admin, id, scope);
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/tickets/[id]]', error);
    return NextResponse.json({ error: 'Could not load the request' }, { status: 500, headers });
  }
}
