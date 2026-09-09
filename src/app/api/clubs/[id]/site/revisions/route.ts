import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RevisionActionSchema } from '@/lib/org-sites/validate';
import { revisionsGET, revisionsPOST } from '@/lib/org-sites/revisions-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/revisions — draft / publish / history (Site Builder
// phase 2, mig 180). GET lists the revisions + the draft's state; POST is one
// action union: publish (promote the draft, optional label), discard,
// restore {revisionId} (into the draft), label {revisionId, label}. All
// `manage_site` — the Website section's staff already write live content
// today (Tom, Sep 9 2026); taking the site live/offline stays `manage_org`
// on the site route. Pre-180: GET answers `supported: false`, POST 409.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await revisionsGET(admin, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE REVISIONS] club GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-revisions', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const parsed = await parseBody(request, RevisionActionSchema);
    if (!parsed.success) return parsed.response;
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await revisionsPOST(admin, 'club', id, user.id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE REVISIONS] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
