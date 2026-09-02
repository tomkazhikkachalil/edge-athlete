import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { statLinesImportPOST } from '@/lib/orgs/stat-lines-import';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import type { CompRow } from '@/lib/orgs/stat-lines-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/stat-lines-import (6c I2) ──
// Per-athlete stat lines by CSV paste (dry-run default). Owner authority
// only — the core re-checks; rows resolve to a game + side + roster
// athlete and write through the same gate as the per-game panel, with
// provenance 'imported' (visibly labeled, never display-upgraded).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    const { data: comp } = await admin
      .from('competitions')
      .select('id, name, sport_key, format, status, league_id, club_id')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp || comp.league_id !== id) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      csv?: unknown;
      timezone?: unknown;
      dryRun?: unknown;
    };
    if (typeof body.csv !== 'string' || body.csv.length === 0 || body.csv.length > 100_000) {
      return NextResponse.json({ error: 'csv text is required (max 100KB)' }, { status: 400 });
    }
    return await statLinesImportPOST(
      admin,
      comp as CompRow,
      { side: 'league', orgId: id },
      user.id,
      {
        csv: body.csv,
        timezone: typeof body.timezone === 'string' && body.timezone.length <= 64 ? body.timezone : 'UTC',
        dryRun: body.dryRun !== false,
      }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STAT-LINES-IMPORT] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
