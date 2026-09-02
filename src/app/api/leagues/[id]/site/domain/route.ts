import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { domainDELETE, domainGET, domainPOST } from '@/lib/org-sites/domain-server';
import { DomainClaimSchema } from '@/lib/org-sites/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/domain — the custom-domain claim (phase 6b C1) ────
// Manager-gated; GET = status + DNS instructions, POST = claim/replace,
// DELETE = remove. The cores live in org-sites/domain-server.ts.

async function gate(request: NextRequest, params: Promise<{ id: string }>, limit: boolean) {
  const user = await requireAuth(request);
  if (limit) {
    const limited = await enforceRateLimit(request, 'org-domain', { userId: user.id });
    if (limited) return { response: limited };
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return { response: NextResponse.json({ error: 'League not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managed = await requireOrgManager(admin, user, 'league', id);
  if (!managed.ok) return { response: managed.response };
  return { admin, id };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params, false);
    if ('response' in g) return g.response;
    return await domainGET(g.admin, 'league', g.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG DOMAINS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params, true);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, DomainClaimSchema);
    if (!parsed.success) return parsed.response;
    return await domainPOST(g.admin, 'league', g.id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG DOMAINS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params, true);
    if ('response' in g) return g.response;
    return await domainDELETE(g.admin, 'league', g.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG DOMAINS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
