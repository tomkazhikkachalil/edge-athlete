import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { respondChallenge } from '@/lib/play/challenges-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/challenges/[id] { action: accept | decline | cancel } — the
 * challengee answers a pending challenge, the challenger calls one off (the
 * Play program, 244). Not yours = the 404 an unknown id gets. The bell's
 * Accept / Decline reaches the same writer through the notification action
 * route.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'No such challenge.' }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return NextResponse.json({ error: 'action must be accept, decline or cancel' }, { status: 400 });
    const out = await respondChallenge(getSupabaseAdmin(), id, user.id, action);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ status: out.status }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('POST challenge action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
