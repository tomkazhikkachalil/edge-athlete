import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { isMissingTableError } from '@/lib/structure/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure?side=&orgId= — the console's ONE aggregate (0.5):
// seasons → divisions → entries, plus the org's teams. Admin-only v1. ───────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const side = searchParams.get('side');
    const orgId = searchParams.get('orgId');
    if ((side !== 'league' && side !== 'club') || !orgId || !UUID_RE.test(orgId)) {
      return NextResponse.json({ error: 'side and orgId are required' }, { status: 400 });
    }
    const col = side === 'league' ? 'league_id' : 'club_id';
    const supabase = getSupabaseAdmin();

    const { data: seasons, error } = await supabase
      .from('seasons')
      .select('id, label, starts_on, ends_on, sport_key, created_at')
      .eq(col, orgId)
      .order('created_at', { ascending: false });
    if (error) {
      // Pre-145 database: an empty console, not a broken one.
      if (isMissingTableError(error.code)) return NextResponse.json({ seasons: [], teams: [] });
      console.error('[ADMIN STRUCTURE] seasons error:', error);
      return NextResponse.json({ error: 'Failed to load structure' }, { status: 500 });
    }

    const seasonIds = (seasons ?? []).map(s => s.id);
    const [divisionsRes, teamsRes] = await Promise.all([
      seasonIds.length
        ? supabase
            .from('divisions')
            .select('id, season_id, sport_key, name, age_band, gender_stream, tier, capacity_estimate')
            .in('season_id', seasonIds)
            .order('name', { ascending: true })
        : Promise.resolve({ data: [] as never[] }),
      supabase
        .from('teams')
        .select('id, name, display_name, status, created_at')
        .eq(col, orgId)
        .order('name', { ascending: true }),
    ]);

    const divisions = divisionsRes.data ?? [];
    const divisionIds = divisions.map(d => d.id);
    const { data: entries } = divisionIds.length
      ? await supabase
          .from('team_entries')
          .select('id, team_id, division_id')
          .in('division_id', divisionIds)
      : { data: [] };

    const entriesByDivision = new Map<string, Array<{ id: string; team_id: string }>>();
    for (const e of entries ?? []) {
      if (!entriesByDivision.has(e.division_id)) entriesByDivision.set(e.division_id, []);
      entriesByDivision.get(e.division_id)!.push({ id: e.id, team_id: e.team_id });
    }
    const divisionsBySeason = new Map<string, unknown[]>();
    for (const d of divisions) {
      if (!divisionsBySeason.has(d.season_id)) divisionsBySeason.set(d.season_id, []);
      divisionsBySeason.get(d.season_id)!.push({ ...d, entries: entriesByDivision.get(d.id) ?? [] });
    }

    return NextResponse.json({
      seasons: (seasons ?? []).map(s => ({ ...s, divisions: divisionsBySeason.get(s.id) ?? [] })),
      teams: teamsRes.data ?? [],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
