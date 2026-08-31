import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { TeamCreateSchema, TeamPatchSchema } from '@/lib/structure/validate';
import { teamCreatePOST, teamDELETE, teamPATCH } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/teams — thin wrapper over structure-server ─────────
// Teams PERSIST: the console's remove is PATCH status='archived'; DELETE
// stays ADMIN-ONLY for mistake-cleanup (the manager twins don't expose it).

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, TeamCreateSchema);
    if (!parsed.success) return parsed.response;
    const { side, orgId } = parsed.data;
    return await teamCreatePOST(getSupabaseAdmin(), { side, orgId }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { id, status } — archive/unarchive. */
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, TeamPatchSchema);
    if (!parsed.success) return parsed.response;
    return await teamPATCH(getSupabaseAdmin(), parsed.data, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — admin mistake-cleanup only; entries cascade. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    return await teamDELETE(getSupabaseAdmin(), id, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
