/**
 * The rollups' reader (Round 3, Sep 2026): `athlete_performances` for one
 * profile × sport, newest first, disputed rows excluded, capped at
 * ROLLUP_ROW_CAP (a season is ~100 events; the cap is a guard, and the
 * result says `truncated` when it bites). For a viewer who is NOT the
 * owner, a `post`-origin row counts only while its post is PUBLIC and
 * PUBLISHED — the fact table carries no visibility snapshot by design, so
 * the origin is re-checked in ≤ 200-id chunks (the scout search's rule).
 * Org-entered and live-round rows are the org's / the round's record and
 * stay. Pre-194 (no table) answers `supported: false`.
 *
 * One game is counted once (Nov 14 2026, `same-game.ts`): a self-posted game
 * that is the same game as an official line — the same contest, or the same
 * date in a sport with two sides — leaves the rollups; the official line is
 * the one that counts. Applied AFTER the visibility filter, so what a viewer
 * may not see never decides what they are shown.
 *
 * Verified film (a club's or league's fully tagged, dated game) is not in
 * the table — nothing about film is stored. The route reads it for this
 * viewer and hands it in (`film`); it joins the rule between the official
 * line and the post, and a counted film game is one more event.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { gameHasSides } from '@/lib/videos/game-rules';
import { computeRollups, ROLLUP_ROW_CAP, type RollupRow, type Rollups } from './rollups';
import { distinctSet, readDistinctPairs } from './game-distinct-server';
import { countGames, gameKey, type CountableGame } from './same-game';

const IN_CHUNK = 200;

export async function readRollups(
  admin: SupabaseClient,
  profileId: string,
  sportKey: string,
  opts: { viewerIsOwner: boolean; trendLength?: number; film?: ReadonlyArray<{ videoId: string; date: string; contestId: string | null; stats: Record<string, number> }> }
): Promise<{ supported: boolean; rollups: Rollups | null }> {
  const schema = getStatSchema(sportKey);
  if (!schema) return { supported: true, rollups: null };

  const { data, error } = await admin
    .from('athlete_performances')
    .select('id, occurred_on, metrics, provenance, source, source_id, source_table, contest_id')
    .eq('profile_id', profileId)
    .eq('sport_key', sportKey)
    .neq('dispute_status', 'disputed')
    .order('occurred_on', { ascending: false })
    .limit(ROLLUP_ROW_CAP + 1);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { supported: false, rollups: null };
    throw new Error(`rollups read failed: ${error.message}`);
  }
  let rows = (data ?? []) as Array<RollupRow & { id: string; source: string; source_id: string; source_table: string; contest_id: string | null }>;
  const truncated = rows.length > ROLLUP_ROW_CAP;
  if (truncated) rows = rows.slice(0, ROLLUP_ROW_CAP);

  if (!opts.viewerIsOwner) {
    const postIds = [...new Set(rows.filter(r => r.source === 'post').map(r => r.source_id))];
    const visible = new Set<string>();
    for (let i = 0; i < postIds.length; i += IN_CHUNK) {
      const { data: posts } = await admin
        .from('posts')
        .select('id')
        .in('id', postIds.slice(i, i + IN_CHUNK))
        .eq('visibility', 'public')
        .eq('status', 'published');
      for (const p of posts ?? []) visible.add(p.id as string);
    }
    rows = rows.filter(r => r.source !== 'post' || visible.has(r.source_id));
  }

  const film = opts.film ?? [];
  const filmId = gameKey.film;
  // The pairs the athlete said are two different games (309) — the same names the season totals use.
  const distinct = distinctSet(await readDistinctPairs(admin, profileId, sportKey));
  const counted = countGames(
    [...rows.map(rollupGame), ...film.map(f => ({ id: filmId(f.videoId), source: 'film' as const, date: f.date, contestId: f.contestId }))],
    { matchByDate: gameHasSides(sportKey), distinct }
  );
  const events: RollupRow[] = [
    ...rows.filter(r => counted.get(rollupGame(r).id)?.counted !== false),
    // A club's or league's film is the club's record of the game.
    ...film.filter(f => counted.get(filmId(f.videoId))?.counted !== false).map(f => ({ occurred_on: f.date, metrics: f.stats, provenance: 'club_recorded' })),
  ];

  return { supported: true, rollups: computeRollups(schema, events, { truncated, trendLength: opts.trendLength }) };
}

/** A fact row as the same-game rule reads it: an org's contest line is official, everything else is the athlete's own. */
export function rollupGame(r: { id: string; occurred_on: string; source_table: string; source_id: string; contest_id: string | null }): CountableGame {
  const official = r.source_table === 'contest_stat_lines';
  // Named as the season totals name them (`official:<contest>`, `post:<post>`), so one "different games" pair holds for both readers.
  const id = official ? (r.contest_id ? gameKey.official(r.contest_id) : r.id) : r.source_table === 'posts' ? gameKey.post(r.source_id) : r.id;
  return { id, source: official ? 'official' : 'post', date: r.occurred_on ? r.occurred_on.slice(0, 10) : null, contestId: r.contest_id };
}
