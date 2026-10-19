import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { emailString, optionalText, parseBody } from '@/lib/validation';
import { reportRouteError } from '@/lib/observability/report';
import { CONTACT_LIMITS, CONTACT_SOURCES, CONTACT_USER_TYPES } from '@/lib/contacts/rules';
import { ContactsNotLive, recordContact } from '@/lib/contacts/contacts-server';

/**
 * POST /api/contacts — a notification sign-up or an inquiry from anyone
 * (flow changes program, item 1 — Oct 19 2026). PUBLIC by design (the
 * coming-soon page is signed out), so the abuse posture is the guest
 * ticket's: a honeypot (a bot's "success": nothing stored), the `contacts`
 * IP bucket (5 / hour), bounded text. An inquiry needs a message; a sign-up
 * does not. The row and the mail are `recordContact`'s; a repeat address is
 * still a 201 (the person is told it worked). Pre-266: 503 by name.
 */
const HONEYPOT_FIELD = 'website';

const Body = z.object({
  email: emailString,
  source: z.enum(CONTACT_SOURCES),
  name: optionalText(CONTACT_LIMITS.name),
  message: optionalText(CONTACT_LIMITS.message),
  marketingConsent: z.boolean().optional(),
  consentText: optionalText(CONTACT_LIMITS.consentText),
  userType: z.enum(CONTACT_USER_TYPES).optional(),
  [HONEYPOT_FIELD]: z.string().optional(),
});

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const b = parsed.data;
    if (typeof b[HONEYPOT_FIELD] === 'string' && b[HONEYPOT_FIELD].trim() !== '') {
      return NextResponse.json({ ok: true, source: b.source, email: b.email }, { status: 201, headers: NO_STORE });
    }
    if (b.source === 'inquiry' && !b.message) {
      return NextResponse.json({ error: 'Write a short message with your inquiry.' }, { status: 400, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'contacts');
    if (limited) return limited;

    const consent = b.marketingConsent === true;
    const { row } = await recordContact({
      email: b.email,
      name: b.name ?? null,
      source: b.source,
      message: b.message ?? null,
      marketingConsent: consent,
      // The words agreed to travel only when the form showed a checkbox.
      consentText: b.consentText ?? null,
      userType: b.userType ?? null,
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json({ ok: true, source: row.source, email: row.email }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ContactsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    reportRouteError('[POST /api/contacts]', error);
    return NextResponse.json({ error: 'Could not send that right now. Please try again.' }, { status: 500, headers: NO_STORE });
  }
}
