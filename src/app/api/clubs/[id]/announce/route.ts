import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { OrgAnnounceSchema } from '@/lib/orgs/announce';
import { orgAnnouncePOST } from '@/lib/orgs/announce-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/announce (phase 6e S6) — announce to members ────────────
// A manager's notice bells every member (guardians of supervised members
// too) and can mirror to the site's notice band. Manager-gated; the
// org-announce bucket (a few a day — this is a megaphone, not a chat).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-announce', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_membership' });
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, OrgAnnounceSchema);
    if (!parsed.success) return parsed.response;
    return await orgAnnouncePOST(admin, 'club', id, parsed.data, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ANNOUNCE] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
