// ── One handler for both kinds: /api/{leagues,clubs}/[id]/site/news/recap ──
// Sports-team website program, R1 (Sep 28 2026): one-click recap drafts.
//   GET  — the finished games of the last 30 days, each with its recap if
//          one exists (the newsroom's "From results").
//   POST {contestId} — the recap DRAFT for that game (a second click opens
//          the same draft: 243's source_ref UNIQUE). Never publishes.
// manage_site gates both (the newsroom's gate); writes ride the
// org-site-pages bucket, like creating a post.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { createRecap, recapCandidates } from '@/lib/org-sites/recap-server';

const RecapCreateSchema = z.object({ contestId: z.uuid() }).strict();

export async function siteNewsRecapRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, params.id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const out = await recapCandidates(admin, kind, params.id);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE RECAP] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteNewsRecapRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, params.id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, RecapCreateSchema);
    if (!parsed.success) return parsed.response;
    const out = await createRecap(admin, { side: kind, orgId: params.id, contestId: parsed.data.contestId, actorId: user.id });
    if (!out.ok) return NextResponse.json({ error: out.error, ...(out.reason ? { reason: out.reason } : {}) }, { status: out.status });
    return NextResponse.json({ post: out.post, existing: out.existing });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE RECAP] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
