import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody, emailString, boundedText } from '@/lib/validation';
import { createTicket, readSubmitter, TicketsNotLive } from '@/lib/tickets/server';
import { formatTicketNumber } from '@/lib/tickets/number';
import { reportRouteError } from '@/lib/observability/report';

const ContactSchema = z.object({
  name: boundedText(100),
  email: emailString,
  message: boundedText(5000),
});

/**
 * POST /api/contact — since Spec 3 a thin ADAPTER over the ticket system:
 * a contact-form message is a Help ticket (`other`), filed by the session
 * when there is one and as a GUEST (`guest_email`) when there is not. The
 * 096 `contact_messages` table stops growing; its rows stay. No auth
 * required; the `contact` IP bucket stands. The visitor's name rides the
 * subject so the console shows who wrote.
 */
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const limited = await enforceRateLimit(request, 'contact');
    if (limited) return limited;
    const parsed = await parseBody(request, ContactSchema);
    if (!parsed.success) return parsed.response;
    const { name, email, message } = parsed.data;

    const admin = getSupabaseAdmin();
    const { user } = await getServerAuth(request);
    const submitter = user ? await readSubmitter(admin, user.id) : null;
    const ticket = await createTicket(admin, {
      type: 'help',
      reason: 'other',
      subject: `Contact form — ${name}`,
      description: message,
      submitter,
      guestEmail: submitter ? null : email,
    });
    return NextResponse.json({ success: true, number: formatTicketNumber(ticket.number), message: 'Thanks — we got your message and will reply by email.' }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers });
    reportRouteError('Contact form error:', error);
    return NextResponse.json({ error: 'Could not send your message. Please try again.' }, { status: 500, headers });
  }
}
