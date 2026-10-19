import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { listContacts } from '@/lib/contacts/admin-server';
import { CONTACT_SOURCES, type ContactSource } from '@/lib/contacts/rules';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/admin/contacts — the contact list, one page (266, flow changes
 * item 1). Owner-only (`requireAdmin`). `?source=notify_signup|inquiry`,
 * `?consent=1|0`, `?q=` (name or address), `?page=`. Pre-266 answers
 * `{ supported: false }`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const sp = request.nextUrl.searchParams;
    const sourceRaw = sp.get('source');
    const source = sourceRaw && (CONTACT_SOURCES as readonly string[]).includes(sourceRaw) ? (sourceRaw as ContactSource) : null;
    const consentRaw = sp.get('consent');
    const consent = consentRaw === '1' ? true : consentRaw === '0' ? false : null;
    const q = (sp.get('q') ?? '').slice(0, 120);
    const page = Number.parseInt(sp.get('page') ?? '1', 10) || 1;
    const result = await listContacts(getSupabaseAdmin(), { source, consent, q, page });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/contacts]', error);
    return NextResponse.json({ error: 'Could not load the contacts' }, { status: 500, headers: NO_STORE });
  }
}
