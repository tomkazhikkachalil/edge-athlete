import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { boundedText, optionalText, parseBody } from '@/lib/validation';
import { createTicket, readMyTickets, readSubmitter, readerScope, TicketsNotLive } from '@/lib/tickets/server';
import { TICKET_LIMITS, TICKET_TYPES, isReasonForType } from '@/lib/tickets/types';
import { formatTicketNumber } from '@/lib/tickets/number';

/**
 * /api/tickets — a user's own tickets (Support & Reporting, Spec 1).
 *
 *   POST { type, reason, subject?, description, contact_ok? } → { id, number, severity }
 *     Spec 1 files `help`, `suggestion`, and a `report` with no target (the
 *     Help Center's "report an incident" — subtype 'incident'). Spec 2 adds
 *     the targeted report shapes with their snapshots. A supervised profile
 *     may file; its guardians hear.
 *   GET → { supported, tickets } — My requests: the caller's own tickets plus
 *     their supervised athletes' (a guardian reads the child's).
 *
 * Pre-222: GET answers supported:false; POST answers 503 by name.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const CreateBody = z
  .object({
    type: z.enum(TICKET_TYPES),
    reason: boundedText(64),
    subject: optionalText(TICKET_LIMITS.subject),
    description: boundedText(TICKET_LIMITS.description),
    contact_ok: z.boolean().optional(),
  })
  .refine(b => isReasonForType(b.type, b.reason), { path: ['reason'], message: 'Pick a reason from the list.' });

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'ticket-create', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, CreateBody);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const submitter = await readSubmitter(admin, user.id);
    const ticket = await createTicket(admin, {
      type: body.type,
      subtype: body.type === 'report' ? 'incident' : null,
      reason: body.reason,
      subject: body.subject ?? null,
      description: body.description,
      contact_ok: body.contact_ok,
      submitter,
    });
    return NextResponse.json({ id: ticket.id, number: formatTicketNumber(ticket.number), severity: ticket.severity }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[POST /api/tickets]', error);
    return NextResponse.json({ error: 'Could not send your request. Please try again.' }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const scope = await readerScope(admin, user.id);
    const result = await readMyTickets(admin, scope);
    return NextResponse.json({ supported: result.supported, tickets: result.items }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GET /api/tickets]', error);
    return NextResponse.json({ error: 'Could not load your requests' }, { status: 500, headers: NO_STORE });
  }
}
