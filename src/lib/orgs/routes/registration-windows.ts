// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/registration-windows ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { WindowCreateSchema } from '@/lib/registration/validate';
import {
  requireRegistrar,
  windowCreatePOST,
  windowDELETE,
  windowsGET,
} from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/registration-windows (phase 5 R2) ─────────────────────
// Open/close registration — registrar-gated. Opening/closing purges the
// org site (R5's public Register card reads windows).

async function gate(request: NextRequest, kind: OrgKind, params: { id: string }) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'registration', { userId: user.id });
  if (limited) return { limited };
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return { limited: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const verdict = await requireRegistrar(admin, user, kind, id);
  if (!verdict.ok) return { limited: verdict.response };
  return { user, admin, id };
}

export async function registrationWindowsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const ctx = await gate(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    return await windowsGET(ctx.admin, kind, ctx.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} windows GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function registrationWindowsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const ctx = await gate(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    const parsed = await parseBody(request, WindowCreateSchema);
    if (!parsed.success) return parsed.response;
    return await windowCreatePOST(ctx.admin, kind, ctx.id, parsed.data, ctx.user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} windows POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function registrationWindowsRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const ctx = await gate(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    const windowId = new URL(request.url).searchParams.get('windowId');
    if (!windowId || !UUID_RE.test(windowId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await windowDELETE(ctx.admin, kind, ctx.id, windowId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} windows DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
