import { NextRequest, NextResponse } from 'next/server';
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

// ── /api/leagues/[id]/registration-windows (phase 5 R2) ─────────────────────
// Open/close registration — registrar-gated. Opening/closing purges the
// org site (R5's public Register card reads windows).

async function gate(request: NextRequest, params: Promise<{ id: string }>) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'registration', { userId: user.id });
  if (limited) return { limited };
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return { limited: NextResponse.json({ error: 'League not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const verdict = await requireRegistrar(admin, user, 'league', id);
  if (!verdict.ok) return { limited: verdict.response };
  return { user, admin, id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await gate(request, params);
    if ('limited' in ctx) return ctx.limited;
    return await windowsGET(ctx.admin, 'league', ctx.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league windows GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await gate(request, params);
    if ('limited' in ctx) return ctx.limited;
    const parsed = await parseBody(request, WindowCreateSchema);
    if (!parsed.success) return parsed.response;
    return await windowCreatePOST(ctx.admin, 'league', ctx.id, parsed.data, ctx.user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league windows POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await gate(request, params);
    if ('limited' in ctx) return ctx.limited;
    const windowId = new URL(request.url).searchParams.get('windowId');
    if (!windowId || !UUID_RE.test(windowId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await windowDELETE(ctx.admin, 'league', ctx.id, windowId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league windows DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
