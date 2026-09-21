import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { boundedText, parseBody } from '@/lib/validation';
import { pasteUserReply, TicketsNotLive } from '@/lib/tickets/server';
import { TICKET_LIMITS } from '@/lib/tickets/types';

/** POST /api/admin/tickets/[id]/paste-reply { body } — the user's EMAILED reply, pasted by an admin (Spec 4; decided: no inbound parsing in v1). Same status effect as an in-app reply; an internal note records who pasted. */
const Body = z.object({ body: boundedText(TICKET_LIMITS.reply) });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const outcome = await pasteUserReply(getSupabaseAdmin(), id, user.id, parsed.data.body);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, status: outcome.status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[POST /api/admin/tickets/[id]/paste-reply]', error);
    return NextResponse.json({ error: 'Could not paste the reply' }, { status: 500, headers: NO_STORE });
  }
}
