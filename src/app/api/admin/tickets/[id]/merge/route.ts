import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { mergeTicket, TicketsNotLive } from '@/lib/tickets/server';
import { parseTicketNumber } from '@/lib/tickets/number';

/** POST /api/admin/tickets/[id]/merge { into: 'EA-1042' } — merge THIS ticket (a duplicate) into another of the same type (Spec 4: "similar suggestions are merged by an admin and the count is kept on the ticket"). */
const Body = z.object({ into: z.string().trim().min(1).max(20) });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const n = parseTicketNumber(parsed.data.into);
    if (n === null) return NextResponse.json({ error: 'Give a ticket number like EA-1042.' }, { status: 400, headers: NO_STORE });
    const outcome = await mergeTicket(getSupabaseAdmin(), id, n, user.id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, into: outcome.into }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[POST /api/admin/tickets/[id]/merge]', error);
    return NextResponse.json({ error: 'Could not merge' }, { status: 500, headers: NO_STORE });
  }
}
