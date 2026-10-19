import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, emailString } from '@/lib/validation';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { ContactsNotLive, recordContact } from '@/lib/contacts/contacts-server';

/**
 * POST /api/waitlist — since Oct 19 2026 a thin ADAPTER over the contact
 * list (migration 266, `POST /api/contacts`): the landing page's
 * Club / League / Fan / Guest popup still posts here until A2 moves it. A
 * sign-up here is a `notify_signup` contact with no consent asked. The
 * 027 `waitlist` table stops growing; its rows were copied into `contacts`.
 */
const WaitlistSchema = z.object({
  email: emailString,
  userType: z
    .string()
    .transform(s => s.trim().toLowerCase())
    .pipe(z.enum(['club', 'league', 'fan', 'guest'])),
});

export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, 'waitlist');
    if (limited) return limited;

    const parsed = await parseBody(request, WaitlistSchema);
    if (!parsed.success) return parsed.response;
    const { email, userType } = parsed.data;

    await recordContact({
      email,
      name: null,
      source: 'notify_signup',
      message: null,
      marketingConsent: false,
      consentText: null,
      userType,
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json({ message: 'Successfully added to waitlist', email, userType }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ContactsNotLive) return NextResponse.json({ error: error.message }, { status: 503 });
    reportRouteError('Waitlist API error:', error);
    return NextResponse.json({ error: 'Could not join the waitlist right now. Please try again.' }, { status: 500 });
  }
}
