import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { offeringsGET } from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/offerings (phase 5 R2) ────────────────────────────────
// What can be registered for right now — seasons, divisions, programs
// and per-offering window open-ness. Viewer-independent org data with no
// personal fields; the wizard reads it signed-in (R5's public card reads
// the same core through the cached org-site readers instead).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    return await offeringsGET(getSupabaseAdmin(), 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league offerings GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
