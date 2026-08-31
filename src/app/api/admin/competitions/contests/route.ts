import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ContestCreateSchema, ContestPatchSchema } from '@/lib/competitions/validate';
import { contestCreatePOST, contestDELETE, contestPATCH } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/competitions/contests — thin wrappers, scope null ────────────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, ContestCreateSchema);
    if (!parsed.success) return parsed.response;
    return await contestCreatePOST(getSupabaseAdmin(), parsed.data, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] contests POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, ContestPatchSchema);
    if (!parsed.success) return parsed.response;
    return await contestPATCH(getSupabaseAdmin(), parsed.data, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] contests PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    return await contestDELETE(getSupabaseAdmin(), id, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] contests DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
