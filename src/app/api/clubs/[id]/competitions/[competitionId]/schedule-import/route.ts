import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { scheduleIcsImportPOST, scheduleImportPOST } from '@/lib/orgs/schedule-import';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions/[competitionId]/schedule-import ────────────
// Phase 6 R6: schedule + historical results by CSV paste (dry-run
// default). Contests, not bare events — the calendar mirror derives
// events from contests, and rows are standings-eligible. Scores present
// mint contest_results with provenance 'imported' (visibly labeled).

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
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const { data: comp } = await admin
      .from('competitions')
      .select('id, format, status, club_id')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp || comp.club_id !== id) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      csv?: unknown;
      ics?: unknown;
      timezone?: unknown;
      dryRun?: unknown;
    };
    // I1: exactly one of csv | ics (both ≤100KB).
    const csv = typeof body.csv === 'string' && body.csv.length > 0 ? body.csv : null;
    const ics = typeof body.ics === 'string' && body.ics.length > 0 ? body.ics : null;
    if ((!csv && !ics) || (csv && ics) || (csv ?? ics ?? '').length > 100_000) {
      return NextResponse.json({ error: 'csv or ics text is required (one of them, max 100KB)' }, { status: 400 });
    }
    const competition = { id: comp.id as string, format: comp.format as string, status: comp.status as string };
    const opts = {
      timezone: typeof body.timezone === 'string' && body.timezone.length <= 64 ? body.timezone : 'UTC',
      dryRun: body.dryRun !== false,
    };
    const scope = { side: 'club' as const, orgId: id };
    return ics
      ? await scheduleIcsImportPOST(admin, competition, user.id, { ics, ...opts }, scope)
      : await scheduleImportPOST(admin, competition, user.id, { csv: csv as string, ...opts }, scope);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SCHEDULE-IMPORT] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
