import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { FormsPatchSchema } from '@/lib/org-sites/forms';
import { formsGET, formsPATCH } from '@/lib/org-sites/forms-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/forms — the site's inbox (program 2, D2) ────────
// manage_site gates it (the same as the pages); writes ride the
// org-site-pages bucket.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const state = request.nextUrl.searchParams.get('state') === 'archived' ? 'archived' : 'open';
    return await formsGET(admin, 'league', id, state);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SITE FORMS INBOX] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, FormsPatchSchema);
    if (!parsed.success) return parsed.response;
    return await formsPATCH(admin, 'league', id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SITE FORMS INBOX] league PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
