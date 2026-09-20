import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { boundedText, parseBody } from '@/lib/validation';
import { appendUserReply, readerScope, TicketsNotLive } from '@/lib/tickets/server';
import { TICKET_LIMITS } from '@/lib/tickets/types';

/**
 * POST /api/tickets/[id]/reply { body } — the user's side of the thread.
 * The reply decides the status (src/lib/tickets/transitions.ts): it answers
 * waiting_on_user, reopens a resolved ticket ONCE (the appeal) and is refused
 * on a closed one (409 with the reason in words).
 */
const Body = z.object({ body: boundedText(TICKET_LIMITS.reply) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const user = await requireAuth(request);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const limited = await enforceRateLimit(request, 'ticket-reply', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;

    const admin = getSupabaseAdmin();
    const scope = await readerScope(admin, user.id);
    const outcome = await appendUserReply(admin, id, user.id, scope, parsed.data.body);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers });
    return NextResponse.json({ ok: true, status: outcome.status, appeal: outcome.appeal }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers });
    console.error('[POST /api/tickets/[id]/reply]', error);
    return NextResponse.json({ error: 'Could not send your reply' }, { status: 500, headers });
  }
}
