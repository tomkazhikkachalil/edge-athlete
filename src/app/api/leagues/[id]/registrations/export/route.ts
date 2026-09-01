import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { registrationsExportGET, requireRegistrar } from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/registrations/export (PR #492) ────────────────────────
// The registrar CSV download — the ICS attachment-download model. Same
// gate as the JSON list (manage_registration). MEDICAL NOTES ARE NEVER
// IN THIS FILE: a download spreads beyond the gated screen, so the
// console list remains the only medical-notes surface.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireRegistrar(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    const seasonId = new URL(request.url).searchParams.get('seasonId');
    return await registrationsExportGET(
      admin,
      'league',
      id,
      seasonId && UUID_RE.test(seasonId) ? seasonId : null
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
