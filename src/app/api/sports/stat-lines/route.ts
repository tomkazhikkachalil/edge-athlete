import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getStatSchema, isStatLineData, formatResult, computeProfileTile, type StatLineData } from '@/lib/sports/stat-schemas';
import { fetchOfficialStatLines } from '@/lib/sports/server/official-stats';

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

    // Profile-visibility gate FIRST. The post-level `visibility='public'`
    // filter below is NOT sufficient: posts default to public even on a
    // PRIVATE profile, so without this a private athlete's stat lines leaked
    // to anyone. Mirror the owner-||-public-||-accepted-follower block that
    // vitals/workouts/golf-stats use (canViewProfile can't be used directly —
    // it rejects anonymous viewers of public profiles).
    const isOwner = viewerId === profileId;
    if (!isOwner) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (!prof) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      if (prof.visibility !== 'public') {
        if (!viewerId) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', viewerId)
          .eq('following_id', profileId)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!follow) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
      }
    }

    let query = supabase
      .from('posts')
      .select('id, created_at, stats_data, visibility')
      .eq('profile_id', profileId)
      .eq('sport_key', sport)
      .not('stats_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    // Even a permitted viewer of a public/followed profile sees only that
    // profile's PUBLIC stat-line posts (per-post privacy still applies).
    if (!isOwner) {
      query = query.eq('visibility', 'public');
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('[stat-lines] query error:', error);
      return NextResponse.json({ error: 'Failed to fetch stat lines' }, { status: 500 });
    }

    let lines: Array<{ postId: string; createdAt: string; line: StatLineData }> = [];
    for (const p of posts || []) {
      if (isStatLineData(p.stats_data)) {
        lines.push({ postId: p.id, createdAt: p.created_at, line: p.stats_data });
      }
    }

    // Years present in the (unfiltered) data — powers the profile-page year
    // selector. Entry date preferred; post date as fallback (string-sliced,
    // never new Date().getFullYear(), to stay timezone-safe).
    const lineYear = (l: { createdAt: string; line: StatLineData }): number =>
      parseInt((l.line.date || l.createdAt).slice(0, 4), 10);
    const years = Array.from(new Set(lines.map(lineYear).filter(Number.isFinite)))
      .sort((a, b) => b - a);

    // Optional ?year= filter — totals/highlights/activity scope to that year
    const yearParam = searchParams.get('year');
    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (!Number.isFinite(year) || year < 1900 || year > 2200) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
      }
      lines = lines.filter(l => lineYear(l) === year);
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

    // Phase 4: org-entered lines from PUBLIC competitions — a distinct
    // "official" section, never merged into the self-posted rows (no
    // cross-source game dedup exists; the two are labeled apart). The
    // profile gate above already ran; the reader degrades to [] pre-157.
    const officialAll = (await fetchOfficialStatLines(supabase, profileId)).filter(
      l => l.sportKey === sport
    );
    const official = (yearParam
      ? officialAll.filter(l => l.date && l.date.slice(0, 4) === yearParam)
      : officialAll
    )
      .slice(0, 25)
      .map(l => ({
        contestId: l.contestId,
        date: l.date ? l.date.slice(0, 10) : null,
        competitionName: l.competitionName,
        teamName: l.teamName,
        opponent: l.opponentName,
        keyStat: schema.headline(l.stats) || '—',
        provenance: l.provenance,
        href: l.href,
      }));

    return NextResponse.json({
      sport,
      entryCount,
      totals,
      highlights,
      recentActivity,
      years,
      official,
    });
  } catch (e) {
    console.error('[stat-lines] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
