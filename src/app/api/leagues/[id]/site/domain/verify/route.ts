import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { domainVerifyPOST } from '@/lib/org-sites/domain-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/domain/verify (phase 6b C1) — manager-gated, the
// org-domain bucket (a DNS lookup and/or a Vercel call per attempt).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-domain', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await domainVerifyPOST(admin, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG DOMAINS] verify error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
