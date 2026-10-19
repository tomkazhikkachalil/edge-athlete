import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { emailString, parseBody } from '@/lib/validation';
import { notifyInboxAddress, sendContactMail } from '@/lib/contacts/contacts-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/admin/contacts/test-mail — "Send a test email" on the inbox
 * card (266): a sample sign-up mailed to `to` (or the effective inbox when
 * omitted), so Tom sees the pipe works before trusting it. Answers honestly:
 * `{ sent: false, reason }` when SMTP is unset, no address is known, or the
 * provider refused — never a 500 for a mail that did not go.
 */
const Body = z.object({ to: emailString.optional() });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const admin = getSupabaseAdmin();
    const to = parsed.data.to ?? (await notifyInboxAddress(admin)).value;
    if (!to) return NextResponse.json({ sent: false, reason: 'no_address' }, { headers: NO_STORE });
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return NextResponse.json({ sent: false, reason: 'smtp_unset', to }, { headers: NO_STORE });
    const sent = await sendContactMail(
      {
        id: 'test',
        email: user.email ?? 'test@example.com',
        name: 'Test contact',
        source: 'notify_signup',
        message: 'This is a test from the admin console — the real mails look like this.',
        marketing_consent: false,
        consent_text: null,
        user_type: null,
        created_at: new Date().toISOString(),
      },
      admin,
      to
    );
    return NextResponse.json({ sent, to, reason: sent ? null : 'provider_refused' }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/contacts/test-mail]', error);
    return NextResponse.json({ error: 'Could not send the test' }, { status: 500, headers: NO_STORE });
  }
}
