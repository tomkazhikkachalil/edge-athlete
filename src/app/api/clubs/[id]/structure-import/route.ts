import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { structureImportPOST } from '@/lib/orgs/structure-import';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/structure-import — the league twin's mirror ─────────────
// See leagues/[id]/structure-import/route.ts.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    const body = (await request.json().catch(() => ({}))) as {
      seasonId?: unknown;
      csv?: unknown;
      dryRun?: unknown;
    };
    if (typeof body.seasonId !== 'string' || !UUID_RE.test(body.seasonId)) {
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
    }
    if (typeof body.csv !== 'string' || body.csv.length === 0 || body.csv.length > 100_000) {
      return NextResponse.json({ error: 'csv text is required (max 100KB)' }, { status: 400 });
    }
    const { data: org } = await admin.from('clubs').select('sport_key').eq('id', id).maybeSingle();
    return await structureImportPOST(admin, 'club', id, (org?.sport_key as string | null) ?? null, {
      seasonId: body.seasonId,
      csv: body.csv,
      dryRun: body.dryRun !== false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STRUCTURE-IMPORT] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
