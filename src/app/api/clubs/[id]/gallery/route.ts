import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { orgGalleryGET } from '@/lib/org-sites/app-gallery-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/gallery — the in-app Photos bubble (Org Pages R4) ──
// Anonymous-tolerant for a public org (the public site shows the same
// items to everyone); a private org answers members only. The gates and
// the handler live in org-sites/app-gallery-server.ts.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'org-gallery');
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const { user } = await getServerAuth(request); // optional session
    return await orgGalleryGET(getSupabaseAdmin(), 'club', id, user?.id ?? null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG GALLERY] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
