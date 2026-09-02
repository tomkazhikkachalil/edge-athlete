import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { siteAssetPOST } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/assets — page-image upload (phase 3 R3) ─────────
// manage_org gates it; the shared 'upload' bucket meters it (pooled with
// avatar/cover/equipment on purpose).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const formData = await request.formData();
    // B3: a `document` part is a PDF for the documents module; `image`
    // stays the page-image/sponsor-logo shape.
    const document = formData.get('document') as File | null;
    const file = document ?? (formData.get('image') as File | null);
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    return await siteAssetPOST(admin, 'club', id, file, document ? 'document' : 'image');
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] club asset POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
