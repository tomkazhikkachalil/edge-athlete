import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { signPreviewToken } from '@/lib/org-sites/preview-token';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/preview — mint a draft-preview link ─────────────
// manage_org gates the mint; the signed short-lived token then carries
// the authorization into the session-free public segment.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq('club_id', id)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const token = signPreviewToken(site.id);
    return NextResponse.json({ url: `/org/${site.subdomain}/preview/${token}` });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PREVIEW] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
