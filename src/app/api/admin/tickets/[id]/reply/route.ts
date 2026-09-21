import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { boundedText, parseBody } from '@/lib/validation';
import { replyToUser, TicketsNotLive } from '@/lib/tickets/server';
import { TICKET_LIMITS } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/admin/tickets/[id]/reply { body, waitOnUser? } — a reply the user
 * sees: on the history, a bell, the "waiting on you" email (SMTP-guarded).
 * `waitOnUser` (default true) moves an open ticket to waiting_on_user; a
 * closed ticket must be reopened first (409).
 */
const Body = z.object({ body: boundedText(TICKET_LIMITS.reply), waitOnUser: z.boolean().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const outcome = await replyToUser(getSupabaseAdmin(), id, user.id, parsed.data.body, parsed.data.waitOnUser ?? true);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers });
    return NextResponse.json({ ok: true, status: outcome.status }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers });
    reportRouteError('[POST /api/admin/tickets/[id]/reply]', error);
    return NextResponse.json({ error: 'Could not send the reply' }, { status: 500, headers });
  }
}
