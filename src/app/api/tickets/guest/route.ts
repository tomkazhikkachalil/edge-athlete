import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { boundedText, emailString, optionalText, parseBody } from '@/lib/validation';
import { createTicket, TicketsNotLive } from '@/lib/tickets/server';
import { formatTicketNumber } from '@/lib/tickets/number';
import { HELP_CATEGORIES, TICKET_LIMITS } from '@/lib/tickets/types';

/**
 * POST /api/tickets/guest — the Help Center's SIGNED-OUT request (Support &
 * Reporting, Spec 3): a Help ticket with `guest_email` as the recipient of
 * the created / reply / resolved mails. PUBLIC by design — no session — so
 * the abuse posture is the site forms': a honeypot (a bot's "success":
 * nothing stored), the `contact` IP bucket, and Help only (a report or a
 * suggestion needs an account). Pre-222: 503 by name.
 */
const HONEYPOT_FIELD = 'website';

const Body = z.object({
  email: emailString,
  reason: z.enum(HELP_CATEGORIES),
  subject: optionalText(TICKET_LIMITS.subject),
  description: boundedText(TICKET_LIMITS.description),
  [HONEYPOT_FIELD]: z.string().optional(),
});

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const b = parsed.data;
    // The honeypot: answer as if it worked; store nothing.
    if (typeof b[HONEYPOT_FIELD] === 'string' && b[HONEYPOT_FIELD].trim() !== '') {
      return NextResponse.json({ ok: true, number: 'EA-0000' }, { status: 201, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'contact');
    if (limited) return limited;

    const ticket = await createTicket(getSupabaseAdmin(), {
      type: 'help',
      reason: b.reason,
      subject: b.subject ?? null,
      description: b.description,
      submitter: null,
      guestEmail: b.email,
    });
    return NextResponse.json({ ok: true, number: formatTicketNumber(ticket.number) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[POST /api/tickets/guest]', error);
    return NextResponse.json({ error: 'Could not send your request. Please try again.' }, { status: 500, headers: NO_STORE });
  }
}
