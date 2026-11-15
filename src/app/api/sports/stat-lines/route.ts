import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getStatSchema, isStatLineData, formatResult, computeProfileTile, type StatLineData } from '@/lib/sports/stat-schemas';
import { fetchOfficialStatLines } from '@/lib/sports/server/official-stats';
import { distinctSet, readDistinctPairs } from '@/lib/performance/game-distinct-server';
import { countGames, gameKey } from '@/lib/performance/same-game';
import { gameHasSides } from '@/lib/videos/game-rules';
import { verifiedFilmGames } from '@/lib/videos/video-tagged-server';
import { profileManages } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

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
    let viewer: User | null = null;
    try {
      viewer = await requireAuth(request);
    } catch {
      viewer = null;
    }
    const viewerId: string | null = viewer?.id ?? null;

    const supabase = getSupabaseAdmin();

    // Profile-visibility gate FIRST. The post-level `visibility='public'`
    // filter below is NOT sufficient: posts default to public even on a
    // PRIVATE profile, so without this a private athlete's stat lines leaked
    // to anyone. Mirror the owner-||-public-||-accepted-follower block that
    // training/workouts/golf-stats use (canViewProfile can't be used directly —
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
      reportRouteError('[stat-lines] query error:', error);
      return NextResponse.json({ error: 'Failed to fetch stat lines' }, { status: 500 });
    }

    let lines: Array<{ postId: string; createdAt: string; line: StatLineData }> = [];
    for (const p of posts || []) {
      if (isStatLineData(p.stats_data)) {
        lines.push({ postId: p.id, createdAt: p.created_at, line: p.stats_data });
      }
    }

    // Phase 4: org-entered lines from PUBLIC competitions (the profile gate
    // above already ran; the reader degrades to [] pre-157) — and verified
    // film (Nov 14 2026): a club's or league's fully tagged, dated game this
    // viewer may open. Nothing about film is stored. The two reads do not
    // wait on each other.
    const [officialRows, actsFor] = await Promise.all([
      fetchOfficialStatLines(supabase, profileId),
      viewer ? profileManages(viewer.id, profileId) : Promise.resolve(false),
    ]);
    const officialAll = officialRows.filter(l => l.sportKey === sport);
    const filmAll = await verifiedFilmGames(supabase, profileId, schema.sport_key, viewer, actsFor);

    // Years present in the (unfiltered) data — powers the profile-page year
    // selector. Entry date preferred; post date as fallback (string-sliced,
    // never new Date().getFullYear(), to stay timezone-safe).
    const lineDate = (l: { createdAt: string; line: StatLineData }): string =>
      (l.line.date || l.createdAt).slice(0, 10);
    const lineYear = (l: { createdAt: string; line: StatLineData }): number =>
      parseInt(lineDate(l).slice(0, 4), 10);
    const years = Array.from(new Set([
      ...lines.map(lineYear),
      ...officialAll.map(l => (l.date ? parseInt(l.date.slice(0, 4), 10) : NaN)),
      ...filmAll.map(f => parseInt(f.date.slice(0, 4), 10)),
    ].filter(Number.isFinite))).sort((a, b) => b - a);

    // Optional ?year= filter — totals/highlights/activity scope to that year
    const yearParam = searchParams.get('year');
    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (!Number.isFinite(year) || year < 1900 || year > 2200) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
      }
      lines = lines.filter(l => lineYear(l) === year);
    }
    const officialInYear = yearParam
      ? officialAll.filter(l => l.date && l.date.slice(0, 4) === yearParam)
      : officialAll;
    const filmInYear = yearParam ? filmAll.filter(f => f.date.slice(0, 4) === yearParam) : filmAll;

    // One game, counted once (Nov 14 2026, same-game.ts): official line >
    // verified film > the athlete's own post. The same game is the same
    // contest, or the same date in a sport with two sides. The loser stays
    // listed, marked. A disputed line is unconfirmed: it neither counts nor
    // beats anything until resolved.
    const postGameId = gameKey.post;
    const officialGameId = gameKey.official;
    const filmGameId = gameKey.film;
    // "These are two different games" (309): the athlete's own word on a same-date pair.
    const pairs = await readDistinctPairs(supabase, profileId, schema.sport_key);
    const confirmed = officialInYear.filter(l => !l.disputed);
    const counted = countGames(
      [
        ...confirmed.map(l => ({ id: officialGameId(l.contestId), source: 'official' as const, date: l.date ? l.date.slice(0, 10) : null, contestId: l.contestId, opponent: l.opponentName })),
        ...filmInYear.map(f => ({ id: filmGameId(f.videoId), source: 'film' as const, date: f.date, contestId: f.contestId })),
        ...lines.map(l => ({ id: postGameId(l.postId), source: 'post' as const, date: lineDate(l), opponent: l.line.opponent ?? null })),
      ],
      { matchByDate: gameHasSides(schema.sport_key), distinct: distinctSet(pairs) }
    );
    const isCounted = (id: string) => counted.get(id)?.counted !== false;
    // What beat a game, for its row: the official line's page, or the film's video.
    const winnerOf = new Map<string, { source: 'official' | 'film'; href: string }>([
      ...confirmed.map(l => [officialGameId(l.contestId), { source: 'official' as const, href: l.href }] as const),
      ...filmInYear.map(f => [filmGameId(f.videoId), { source: 'film' as const, href: `/videos/${f.videoId}` }] as const),
    ]);
    // `key` names the winner; `canSplit` says the two were joined by the DATE alone, so the athlete may say they are two games.
    const sameAsOf = (id: string) => {
      const verdict = counted.get(id);
      const winner = verdict && !verdict.counted && verdict.beatenBy ? winnerOf.get(verdict.beatenBy) : null;
      return winner && verdict?.beatenBy ? { ...winner, key: verdict.beatenBy, canSplit: verdict.reason === 'same_date' } : null;
    };
    // A game the athlete already split from another: the other one's name, so the row can offer to take it back.
    const splitFromOf = (id: string): string | null => {
      const pair = pairs.find(p => p.a === id || p.b === id);
      return pair ? (pair.a === id ? pair.b : pair.a) : null;
    };

    // The season's lines: every counted game, whichever way it arrived.
    const statLines: StatLineData[] = [
      ...lines.filter(l => isCounted(postGameId(l.postId))).map(l => l.line),
      ...confirmed.filter(l => isCounted(officialGameId(l.contestId))).map(l => ({ type: 'stat_line' as const, sport_key: schema.sport_key, stats: l.stats })),
      ...filmInYear.filter(f => isCounted(filmGameId(f.videoId))).map(f => ({ type: 'stat_line' as const, sport_key: schema.sport_key, stats: f.stats })),
    ];
    const entryCount = statLines.length;

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

    // Activity rows (newest first) matching the registry's activity_columns.
    // A row that is the same game as an official line says so, with the link.
    const recentActivity = lines.slice(0, 25).map(l => {
      return {
        id: l.postId,
        date: lineDate(l),
        opponent: l.line.opponent || '—',
        result: formatResult(l.line) || '—',
        keyStat: schema.headline(l.line.stats) || '—',
        key: postGameId(l.postId),
        counted: isCounted(postGameId(l.postId)),
        sameAs: sameAsOf(postGameId(l.postId)),
        splitFrom: splitFromOf(postGameId(l.postId)),
      };
    });

    // The official log: labeled apart from the self-posted rows; each row
    // says whether it is in the totals (a disputed line is not).
    const official = officialInYear
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
        // R5: an open dispute — the log's Unconfirmed marker.
        disputed: l.disputed,
        counted: !l.disputed,
      }));

    // The verified film of the season: which games are in the totals, and what took the place of the others.
    const film = filmInYear.map(f => ({ videoId: f.videoId, key: filmGameId(f.videoId), counted: isCounted(filmGameId(f.videoId)), sameAs: sameAsOf(filmGameId(f.videoId)), splitFrom: splitFromOf(filmGameId(f.videoId)) }));

    return NextResponse.json({
      sport,
      entryCount,
      totals,
      highlights,
      recentActivity,
      years,
      official,
      film,
      // The athlete or their guardian: may say two same-date games are different games.
      canEdit: isOwner || actsFor,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    reportRouteError('[stat-lines] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
