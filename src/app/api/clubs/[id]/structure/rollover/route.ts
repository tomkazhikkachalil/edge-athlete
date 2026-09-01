import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RolloverSchema } from '@/lib/structure/validate';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { seasonRolloverPOST } from '@/lib/orgs/rollover-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/structure/rollover (phase 5.5) ────────────────────────
// The one-button clone-forward: new season + cloned divisions/programs +
// the SAME teams re-entered; the old season is archived and its open
// windows close. Thin wrapper; the rules live in orgs/rollover-server.ts.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, RolloverSchema);
    if (!parsed.success) return parsed.response;
    return await seasonRolloverPOST(admin, 'club', id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROLLOVER] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
