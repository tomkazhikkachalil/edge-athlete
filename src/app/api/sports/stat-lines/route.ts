import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getStatSchema, isStatLineData, formatResult, computeProfileTile, type StatLineData } from '@/lib/sports/stat-schemas';

/**
 * GET /api/sports/stat-lines?profileId=...&sport=ice_hockey
 *
 * Generic per-sport stats for stat-line sports (posts.stats_data with
 * type='stat_line'). Powers profile highlight tiles and the activity table
 * via StatLinePostAdapter — the sport-agnostic sibling of /api/golf/stats.
 *
 * Same access model as /api/golf/stats: admin client + RLS-equivalent
 * visibility check (posts are filtered to public unless the requester is
 * the owner — mirrored from the posts RLS policy).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const sport = searchParams.get('sport');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }
    const schema = sport ? getStatSchema(sport) : null;
    if (!schema) {
      return NextResponse.json({ error: 'Unknown or unsupported sport' }, { status: 400 });
    }

    // Identify the viewer (optional — anonymous viewers see public data only)
    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('posts')
      .select('id, created_at, stats_data, visibility')
      .eq('profile_id', profileId)
      .eq('sport_key', sport)
      .not('stats_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    // Owners see everything; everyone else sees public posts only.
    if (viewerId !== profileId) {
      query = query.eq('visibility', 'public');
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('[stat-lines] query error:', error);
      return NextResponse.json({ error: 'Failed to fetch stat lines' }, { status: 500 });
    }

    const lines: Array<{ postId: string; createdAt: string; line: StatLineData }> = [];
    for (const p of posts || []) {
      if (isStatLineData(p.stats_data)) {
        lines.push({ postId: p.id, createdAt: p.created_at, line: p.stats_data });
      }
    }

    const statLines = lines.map(l => l.line);
    const entryCount = lines.length;

    // Aggregate field totals (kept for API consumers / debugging)
    const totals: Record<string, number> = {};
    for (const line of statLines) {
      for (const f of schema.fields) {
        const v = line.stats[f.key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          totals[f.key] = (totals[f.key] ?? 0) + v;
        }
      }
    }

    // Profile highlight tiles — computed correctly per stat type (count / sum
    // / per-entry average) from the schema's profileTiles definition. No
    // fragile label-matching; averages like PPG aggregate correctly.
    const highlights = entryCount === 0
      ? schema.profileTiles.map(t => ({ label: t.label, value: null }))
      : schema.profileTiles.map(t => ({
          label: t.label,
          value: computeProfileTile(t, statLines),
        }));

    // Activity rows (newest first) matching the registry's activity_columns
    const recentActivity = lines.slice(0, 25).map(({ postId, createdAt, line }) => ({
      id: postId,
      date: line.date || createdAt.slice(0, 10),
      opponent: line.opponent || '—',
      result: formatResult(line) || '—',
      keyStat: schema.headline(line.stats) || '—',
    }));

    return NextResponse.json({
      sport,
      entryCount,
      totals,
      highlights,
      recentActivity,
    });
  } catch (e) {
    console.error('[stat-lines] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
