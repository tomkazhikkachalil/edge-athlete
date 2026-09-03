import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { listMemberPhotoCandidates } from '@/lib/org-sites/member-photos-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/photo-candidates — the manager's browse list
// (M2, program 10): photos on PUBLIC golf round posts by members who
// opted in, with the current picks marked. Manager-gated, private cache;
// thumbnails ride the signed proxy. The site gate re-decides at read.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    const { data: site } = await admin.from('org_sites').select('id').eq('club_id', id).maybeSingle();
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    const out = await listMemberPhotoCandidates(admin, 'club', id, site.id as string);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[MEMBER PHOTOS] candidates GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
