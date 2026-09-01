import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { siteLogoDELETE, siteLogoPOST } from '@/lib/org-sites/logo-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/logo — org site logo (phase 3 R3) ───────────────
// manage_org gates it; the shared core clones the cover-upload recipe.

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
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;

    const formData = await request.formData();
    const file = formData.get('logo') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    return await siteLogoPOST(admin, 'league', id, file);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE LOGO] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await siteLogoDELETE(admin, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE LOGO] league DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
