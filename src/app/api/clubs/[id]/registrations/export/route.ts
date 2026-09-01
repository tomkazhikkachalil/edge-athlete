import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { registrationsExportGET, requireRegistrar } from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/registrations/export — the league twin's mirror ─────────
// See leagues/[id]/registrations/export/route.ts: registrar CSV download,
// manage_registration gate, MEDICAL NOTES NEVER IN THIS FILE.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireRegistrar(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    const seasonId = new URL(request.url).searchParams.get('seasonId');
    return await registrationsExportGET(
      admin,
      'club',
      id,
      seasonId && UUID_RE.test(seasonId) ? seasonId : null
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] club export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
