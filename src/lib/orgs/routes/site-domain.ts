// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/domain ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { domainDELETE, domainGET, domainPOST } from '@/lib/org-sites/domain-server';
import { DomainClaimSchema } from '@/lib/org-sites/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { recordAuthority } from '@/lib/authority/audit-server';

// ── /api/{leagues,clubs}/[id]/site/domain — the custom-domain claim (phase 6b C1) ────
// Manager-gated; GET = status + DNS instructions, POST = claim/replace,
// DELETE = remove. The cores live in org-sites/domain-server.ts.

async function gate(request: NextRequest, kind: OrgKind, params: { id: string }, limit: boolean) {
  const user = await requireAuth(request);
  if (limit) {
    const limited = await enforceRateLimit(request, 'org-domain', { userId: user.id });
    if (limited) return { response: limited };
  }
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return { response: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managed = await requireOrgManager(admin, user, kind, id);
  if (!managed.ok) return { response: managed.response };
  return { admin, id, userId: user.id };
}

export async function siteDomainRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const g = await gate(request, kind, params, false);
    if ('response' in g) return g.response;
    return await domainGET(g.admin, kind, g.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG DOMAINS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteDomainRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const g = await gate(request, kind, params, true);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, DomainClaimSchema);
    if (!parsed.success) return parsed.response;
    const res = await domainPOST(g.admin, kind, g.id, parsed.data);
    if (res.ok) {
      await recordAuthority(g.admin, {
        subject: { type: 'org', id: g.id },
        actor: { kind: 'member', profileId: g.userId },
        action: 'domain_added',
        detail: { domain: parsed.data.domain },
      });
    }
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG DOMAINS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteDomainRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const g = await gate(request, kind, params, true);
    if ('response' in g) return g.response;
    const res = await domainDELETE(g.admin, kind, g.id);
    if (res.ok) {
      await recordAuthority(g.admin, {
        subject: { type: 'org', id: g.id },
        actor: { kind: 'member', profileId: g.userId },
        action: 'domain_removed',
      });
    }
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG DOMAINS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
