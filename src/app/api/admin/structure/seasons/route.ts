import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { SeasonCreateSchema } from '@/lib/structure/validate';
import { seasonCreatePOST, seasonDELETE } from '@/lib/orgs/structure-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/seasons — thin wrapper over structure-server ───────
// (Sport gate stays in the route — the 113 convention; validate.ts is
// registry-free.)

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, SeasonCreateSchema);
    if (!parsed.success) return parsed.response;
    const { side, orgId, sportKey } = parsed.data;
    if (sportKey && !isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }
    return await seasonCreatePOST(getSupabaseAdmin(), { side, orgId }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] seasons POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — divisions and their entries CASCADE; teams persist. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    return await seasonDELETE(getSupabaseAdmin(), id, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] seasons DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
