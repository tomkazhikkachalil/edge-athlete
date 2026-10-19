import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { emailString, parseBody } from '@/lib/validation';
import { notifyInboxAddress, resetNotifyInboxCache, writeNotifyInboxAddress } from '@/lib/contacts/contacts-server';
import { APP_SETTING_KEYS } from '@/lib/contacts/rules';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/admin/settings — the server-only settings the admin console edits
 * (266). Owner-only. GET answers the notify inbox: its effective value and
 * where it came from (`setting` | `env` | `none`). PUT writes ONE listed
 * key; `notify_inbox_email` must be an address or null (null = back to the
 * env fallback). A key not listed is refused by name.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const Body = z.object({
  key: z.enum(APP_SETTING_KEYS),
  value: emailString.nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    resetNotifyInboxCache();
    const inbox = await notifyInboxAddress(getSupabaseAdmin());
    return NextResponse.json({ notifyInbox: inbox, smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/settings]', error);
    return NextResponse.json({ error: 'Could not load the settings' }, { status: 500, headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const admin = getSupabaseAdmin();
    await writeNotifyInboxAddress(admin, parsed.data.value, user.id);
    const inbox = await notifyInboxAddress(admin);
    return NextResponse.json({ notifyInbox: inbox }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[PUT /api/admin/settings]', error);
    return NextResponse.json({ error: 'Could not save the setting' }, { status: 500, headers: NO_STORE });
  }
}
