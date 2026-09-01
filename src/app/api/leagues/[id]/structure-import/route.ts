import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { structureImportPOST } from '@/lib/orgs/structure-import';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/structure-import (phase 6 R5) ─────────────────────────
// Divisions + teams + entries by CSV paste, dry-run-first, idempotent by
// constraint. Manager-gated; the roster-import sibling.

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
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
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
    const { data: org } = await admin.from('leagues').select('sport_key').eq('id', id).maybeSingle();
    return await structureImportPOST(admin, 'league', id, (org?.sport_key as string | null) ?? null, {
      seasonId: body.seasonId,
      csv: body.csv,
      dryRun: body.dryRun !== false, // dry-run is the DEFAULT — commit is explicit
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STRUCTURE-IMPORT] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
