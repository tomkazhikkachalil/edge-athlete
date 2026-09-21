import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { boundedText, parseBody } from '@/lib/validation';
import { appendAdminNote, TicketsNotLive } from '@/lib/tickets/server';
import { TICKET_LIMITS } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/** POST /api/admin/tickets/[id]/notes { body } — an INTERNAL note: on the history, never shown to the user. Counts as the first response. */
const Body = z.object({ body: boundedText(TICKET_LIMITS.note) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const ok = await appendAdminNote(getSupabaseAdmin(), id, user.id, parsed.data.body);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers });
    reportRouteError('[POST /api/admin/tickets/[id]/notes]', error);
    return NextResponse.json({ error: 'Could not add the note' }, { status: 500, headers });
  }
}
